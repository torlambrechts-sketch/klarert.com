import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { AutomationEvent, Effect } from '@/engine/automations';
import { resolveFieldType } from '@/engine/fields/resolve';
import '@/engine/fields/registry';
import { keyBetween } from '@/engine/ordering';
import { sheetCtx, type SheetData } from '@/engine/sheet-data';
import type { Condition, Ctx, Field, Group, Item, Json } from '@/engine/types';
import { kindOf } from '@/engine/values';
import { checkCreate, checkWrite, defaultValues, planValues } from '@/engine/writes';
import type { Database } from '@/lib/database.types';
import { env } from '@/lib/env';
import {
  fetchAttached,
  fetchDirectory,
  fetchItemsById,
  fetchRelated,
  fetchSheetMeta,
  type Db,
} from '@/lib/sheet-query';
import { toItem } from '@/lib/sheet-rows';
import { fromDbError } from '@/server/result';
import { newId, sha256, uniqueConflicts } from '@/server/sheet-context';
import type { AutomationRow, EffectResult, RunnerStore, RunRecord, World } from './runner';

// The automation runner's reads and writes (docs/02 §7, docs/04 §1). This is the one place in a request path that
// creates the service-role client (CLAUDE.md rule 6). Every query here is scoped to the workspace the caller already
// authorised (a command's withOrg membership check, or the public form's link): sheets, items and automations of
// another workspace are treated as missing.
//
// Item writes go through the same RPCs as people's writes, with p_automation, so the activity log names the
// automation and the database checks the automation is enabled and in the workspace. Since 0010 only the service role
// may write as an automation; that is why they use this client and not the person's (a member's own client could
// otherwise pass any automation id and write to locked items).

let service: Db | null = null;

function serviceDb(): Db {
  if (!service) {
    const key = z.string().min(20).parse(process.env.SUPABASE_SERVICE_ROLE_KEY);
    service = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return service;
}

const FAILURE_NOTICE_MS = 60 * 60 * 1000;
const byPosition = <T extends { position: string }>(a: T, b: T) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

type Meta = NonNullable<Awaited<ReturnType<typeof fetchSheetMeta>>>;

const done = (over: Partial<EffectResult> = {}): EffectResult => ({
  outcome: 'done',
  message: '',
  events: [],
  touched: [],
  ...over,
});
const not = (outcome: EffectResult['outcome'], message: string): EffectResult => ({
  outcome,
  message,
  events: [],
  touched: [],
});
const dbMessage = (error: { message: string; code?: string }) => {
  const r = fromDbError(error);
  return r.ok ? error.message : r.error.message;
};
function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

/** The workspace's slug (public forms know only the workspace id). */
export async function workspaceSlug(orgId: string): Promise<string> {
  const { data } = await serviceDb().from('orgs').select('slug').eq('id', orgId).maybeSingle();
  return data?.slug ?? '';
}

/**
 * The runner's store for one chain in one workspace. `userId` is the person who started the chain (null for public
 * forms): conditions such as "includes me" and the `me` token read it.
 */
export function automationStore(scope: { orgId: string; userId: string | null }): RunnerStore {
  const db = serviceDb();
  const { orgId } = scope;
  const metas = new Map<string, Promise<Meta | null>>();
  const automationLists = new Map<string, Promise<AutomationRow[]>>();
  let directory: ReturnType<typeof fetchDirectory> | null = null;
  let roles: Promise<(roleId: string) => string[]> | null = null;
  let timeZone: Promise<string> | null = null;

  const meta = (sheetId: string) => {
    let m = metas.get(sheetId);
    if (!m) {
      m = fetchSheetMeta(db, sheetId).then((r) => (r && r.sheet.orgId === orgId ? r : null));
      metas.set(sheetId, m);
    }
    return m;
  };
  const people = () => (directory ??= fetchDirectory(db, orgId));
  const zone = () =>
    (timeZone ??= Promise.resolve(
      db.from('orgs').select('time_zone').eq('id', orgId).maybeSingle(),
    ).then((r) => r.data?.time_zone ?? 'Europe/London'));
  const roleHolders = () =>
    (roles ??= Promise.all([
      db.from('memberships').select('user_id, job_title').eq('org_id', orgId),
      db.from('job_roles').select('id, name').eq('org_id', orgId),
    ]).then(([m, r]) => {
      const names = new Map(must(r).map((x) => [x.id, x.name.trim().toLowerCase()]));
      const members = must(m);
      return (roleId: string) =>
        members
          .filter((x) => x.job_title && x.job_title.trim().toLowerCase() === names.get(roleId))
          .map((x) => x.user_id);
    }));

  async function ctxFor(m: Meta, items: Item[]): Promise<{ ctx: Ctx; data: SheetData }> {
    const [dir, tz] = await Promise.all([people(), zone()]);
    const attached = await fetchAttached(
      db,
      m.fields,
      items.map((i) => i.id),
    );
    const related = await fetchRelated(
      db,
      m.sheet.id,
      new Set(items.map((i) => i.id)),
      attached.links.map((l) => l.toItem),
    );
    const data: SheetData = { ...m, ...dir, items, ...attached, related };
    const ctx = sheetCtx(data, {
      now: new Date(),
      timeZone: tz,
      userId: scope.userId ?? '',
      newId,
      isAdmin: true,
    });
    return { ctx, data };
  }

  async function loadWorld(sheetId: string, itemId: string): Promise<World | null> {
    const m = await meta(sheetId);
    if (!m) return null;
    const [item] = await fetchItemsById(db, [itemId]);
    if (!item || item.sheetId !== sheetId || item.archivedAt) return null;
    const [{ ctx }, holders] = await Promise.all([ctxFor(m, [item]), roleHolders()]);
    return { ctx, item, roleHolders: holders };
  }

  /** The item's world by id alone (targets of update_linked), in this workspace. */
  async function worldOf(itemId: string): Promise<World | null> {
    const { data } = await db.from('items').select('sheet_id').eq('id', itemId).maybeSingle();
    return data ? loadWorld(data.sheet_id, itemId) : null;
  }

  /** The end of a group (fractional keys compare by code unit, as in JavaScript). */
  async function endOf(groupId: string): Promise<string> {
    let last: string | null = null;
    for (let from = 0; ; from += 1000) {
      const rows = must(
        await db
          .from('items')
          .select('position')
          .eq('group_id', groupId)
          .is('archived_at', null)
          .order('id')
          .range(from, from + 999),
      );
      for (const r of rows) if (last === null || r.position > last) last = r.position;
      if (rows.length < 1000) break;
    }
    return keyBetween(last, null);
  }

  const valueEvents = (before: Item, after: Item, automation: AutomationRow): AutomationEvent[] => {
    const ids = new Set([...Object.keys(before.values), ...Object.keys(after.values)]);
    const out: AutomationEvent[] = [];
    for (const fieldId of ids) {
      const b = before.values[fieldId] ?? null;
      const a = after.values[fieldId] ?? null;
      if (JSON.stringify(b) === JSON.stringify(a)) continue;
      out.push({
        type: 'value.changed',
        sheetId: after.sheetId,
        itemId: after.id,
        fieldId,
        before: b,
        after: a,
        actor: { kind: 'automation', id: automation.id },
      });
    }
    return out;
  };

  /** Validate and write values on one item as the automation (status rules apply; comment rules get a note). */
  async function writeValues(
    automation: AutomationRow,
    w: World,
    raw: Record<string, Json | null>,
  ): Promise<EffectResult> {
    const fields = w.ctx.fieldsOf(w.item.sheetId);
    const plan = planValues(w.item, fields, raw, w.ctx, sha256);
    if (plan.rejected.length > 0) return not('failed', plan.rejected[0]!.reason);
    if (Object.keys(plan.patch).length === 0) return not('no_change', '');
    const conflicts = await uniqueConflicts(db, w.item.sheetId, w.item.id, fields, plan.patch);
    const check = checkWrite(w.item, plan.next, fields, plan.changedKeys, w.ctx, {
      isUnique: (f) => !conflicts.has(f.id),
    });
    if (check.blocking.length > 0)
      return not('blocked', check.blocking.map((i) => i.message).join(' '));
    const { data, error } = await db.rpc('set_item_values', {
      p_item: w.item.id,
      p_patch: plan.patch as Json,
      p_automation: automation.id,
      p_note:
        check.commentRequired.length > 0 ? `Set by automation "${automation.name}"` : undefined,
    });
    if (error) return not('failed', dbMessage(error));
    const saved = toItem(data);
    return done({ events: valueEvents(w.item, saved, automation), touched: [w.item.id] });
  }

  async function notify(
    automation: AutomationRow,
    itemId: string,
    userIds: string[],
    kind: 'notify' | 'request' | 'system',
    body: string,
  ) {
    const members = new Set((await people()).people.map((p) => p.id));
    const rows = [...new Set(userIds)]
      .filter((id) => members.has(id))
      .map((user_id) => ({
        org_id: orgId,
        user_id,
        item_id: itemId,
        kind,
        body: body.slice(0, 500),
        automation_id: automation.id,
      }));
    if (rows.length === 0) return 0;
    must(await db.from('notifications').insert(rows));
    return rows.length;
  }

  async function post(itemId: string, body: string) {
    must(
      await db.from('item_updates').insert({
        org_id: orgId,
        item_id: itemId,
        author_id: null,
        kind: 'automation',
        body: body.slice(0, 10000),
      }),
    );
  }

  /** set_item_links for one direction, keeping a two-way inverse field in step. */
  async function link(
    automation: AutomationRow,
    field: Field,
    from: string,
    to: string,
  ): Promise<AutomationEvent[]> {
    const events: AutomationEvent[] = [];
    const add = async (fieldId: string, a: string, b: string, sheetId: string) => {
      const before = must(
        await db.from('item_links').select('to_item').eq('field_id', fieldId).eq('from_item', a),
      ).map((r) => r.to_item);
      const { error } = await db.rpc('set_item_links', {
        p_field: fieldId,
        p_from: a,
        p_to: [b],
        p_mode: 'add',
        p_automation: automation.id,
      });
      if (error) throw new Error(dbMessage(error));
      if (!before.includes(b))
        events.push({
          type: 'links.changed',
          sheetId,
          itemId: a,
          fieldId,
          before,
          after: [...before, b],
          actor: { kind: 'automation', id: automation.id },
        });
    };
    await add(field.id, from, to, field.sheetId);
    const inverse = (field.config as { inverseFieldId?: string | null }).inverseFieldId;
    if (inverse) {
      const { data } = await db
        .from('fields')
        .select('sheet_id')
        .eq('id', inverse)
        .is('archived_at', null)
        .maybeSingle();
      if (data) await add(inverse, to, from, data.sheet_id);
    }
    return events;
  }

  async function createItem(
    automation: AutomationRow,
    e: Extract<Effect, { kind: 'create_item' }>,
  ): Promise<EffectResult> {
    const target = await meta(e.sheetId);
    if (!target) return not('failed', 'The sheet to create on no longer exists.');
    const groups = [...target.groups].sort(byPosition);
    const group: Group | undefined = e.groupId ? groups.find((g) => g.id === e.groupId) : groups[0];
    if (!group) return not('failed', 'The group to create in no longer exists.');
    const { ctx } = await ctxFor(target, []);
    const fields = [...target.fields].sort(byPosition);
    const raw: Record<string, Json | null> = {};
    for (const [key, v] of Object.entries(e.values)) {
      const f = fields.find((x) => x.key === key);
      if (f && v !== null) raw[f.id] = v;
    }
    const now = new Date().toISOString();
    const blank: Item = {
      id: '00000000-0000-0000-0000-000000000000',
      sheetId: target.sheet.id,
      groupId: group.id,
      seq: 0,
      displayId: '',
      name: e.name,
      values: defaultValues(fields, ctx),
      position: '',
      locked: false,
      createdAt: now,
      updatedAt: now,
    };
    // the owner: the first people field still empty gets the source's first person
    if (e.ownerId && ctx.people.has(e.ownerId)) {
      const empty = fields.find(
        (f) =>
          resolveFieldType(f.type)?.storage === 'values' &&
          kindOf(f, ctx) === 'people' &&
          !(f.id in raw) &&
          blank.values[f.id] === undefined,
      );
      if (empty) raw[empty.id] = [e.ownerId];
    }
    const plan = planValues(blank, fields, raw, ctx, sha256);
    if (plan.rejected.length > 0) return not('failed', plan.rejected[0]!.reason);
    const conflicts = await uniqueConflicts(db, target.sheet.id, null, fields, plan.next.values);
    const check = checkCreate(plan.next, fields, ctx, { isUnique: (f) => !conflicts.has(f.id) });
    if (check.blocking.length > 0)
      return not('blocked', check.blocking.map((i) => i.message).join(' '));
    const { data, error } = await db.rpc('create_item', {
      p_sheet: target.sheet.id,
      p_group: group.id,
      p_name: e.name.slice(0, 500),
      p_position: await endOf(group.id),
      p_values: plan.next.values as Json,
      p_automation: automation.id,
    });
    if (error) return not('failed', dbMessage(error));
    const created = toItem(data);
    const events: AutomationEvent[] = [
      {
        type: 'item.created',
        sheetId: created.sheetId,
        itemId: created.id,
        actor: { kind: 'automation', id: automation.id },
      },
    ];
    const touched = [created.id];
    if (e.link) {
      const source = await meta(e.sourceSheetId);
      const links = (m: Meta | null, to: string) =>
        (m?.fields ?? [])
          .filter(
            (f) =>
              resolveFieldType(f.type)?.storage === 'links' &&
              (f.config as { targetSheetId?: unknown }).targetSheetId === to,
          )
          .sort(byPosition)[0];
      const out = links(source, target.sheet.id);
      const back = out ? undefined : links(target, e.sourceSheetId);
      try {
        if (out) events.push(...(await link(automation, out, e.sourceItemId, created.id)));
        else if (back) events.push(...(await link(automation, back, created.id, e.sourceItemId)));
      } catch (err) {
        return {
          outcome: 'failed',
          message: `Created ${created.displayId} but could not link it: ${err instanceof Error ? err.message : ''}`,
          events,
          touched: [...touched, e.sourceItemId],
        };
      }
      if (out || back) touched.push(e.sourceItemId);
    }
    return done({ message: created.displayId, events, touched });
  }

  async function updateLinked(
    automation: AutomationRow,
    w: World,
    e: Extract<Effect, { kind: 'update_linked' }>,
  ): Promise<EffectResult> {
    let ids = e.targetIds ?? [];
    if (e.direction === 'in') {
      const from = await meta(e.fromSheetId ?? '');
      const field = from?.fields.find(
        (f) => f.key === e.linkFieldKey && resolveFieldType(f.type)?.storage === 'links',
      );
      if (!field) return not('failed', 'The link field no longer exists.');
      ids = must(
        await db
          .from('item_links')
          .select('from_item')
          .eq('field_id', field.id)
          .eq('to_item', w.item.id),
      ).map((r) => r.from_item);
    }
    if (ids.length === 0) return not('skipped', 'No linked items.');
    const results: EffectResult[] = [];
    for (const id of ids) {
      const target = await worldOf(id);
      if (!target) continue;
      const field = target.ctx.fieldsByKey.get(e.fieldKey);
      if (!field) {
        results.push(not('failed', `${target.item.displayId} has no field "${e.fieldKey}".`));
        continue;
      }
      const r = await writeValues(automation, target, { [field.id]: e.value });
      results.push(
        r.outcome === 'done' || r.outcome === 'no_change'
          ? r
          : { ...r, message: `${target.item.displayId}: ${r.message}` },
      );
    }
    const events = results.flatMap((r) => r.events);
    const touched = results.flatMap((r) => r.touched);
    const changed = results.filter((r) => r.outcome === 'done').length;
    const bad = results.filter((r) => r.outcome === 'failed' || r.outcome === 'blocked');
    if (bad.length > 0 && changed === 0)
      return {
        outcome: bad[0]!.outcome,
        message: bad.map((r) => r.message).join(' '),
        events,
        touched,
      };
    if (changed === 0) return not('no_change', '');
    const message =
      bad.length > 0
        ? `${changed} updated; ${bad.map((r) => r.message).join(' ')}`
        : `${changed} updated`;
    return { outcome: 'done', message, events, touched };
  }

  return {
    automations(sheetId) {
      let list = automationLists.get(sheetId);
      if (!list) {
        list = Promise.resolve(
          db
            .from('automations')
            .select('id, sheet_id, name, trigger, conditions, actions, created_by')
            .eq('org_id', orgId)
            .eq('sheet_id', sheetId)
            .eq('enabled', true)
            .order('created_at')
            .order('id'),
        ).then((r) =>
          must(r).map((a) => ({
            id: a.id,
            sheetId: a.sheet_id,
            name: a.name,
            trigger: a.trigger as AutomationRow['trigger'],
            conditions: (Array.isArray(a.conditions) ? a.conditions : []) as unknown as Condition[],
            actions: (Array.isArray(a.actions) ? a.actions : []) as AutomationRow['actions'],
            createdBy: a.created_by,
          })),
        );
        automationLists.set(sheetId, list);
      }
      return list;
    },

    async paused(automationIds, itemId) {
      if (automationIds.length === 0) return new Set();
      const rows = must(
        await db
          .from('automation_pauses')
          .select('automation_id')
          .eq('org_id', orgId)
          .eq('item_id', itemId)
          .in('automation_id', automationIds),
      );
      return new Set(rows.map((r) => r.automation_id));
    },

    world: loadWorld,

    async execute(effect, { automation, world }) {
      switch (effect.kind) {
        case 'set_values': {
          const w =
            effect.itemId === world.item.id
              ? await loadWorld(effect.sheetId, effect.itemId)
              : await worldOf(effect.itemId);
          if (!w) return not('failed', 'This item no longer exists or was archived.');
          return writeValues(automation, w, effect.values);
        }
        case 'notify': {
          const n = await notify(
            automation,
            effect.itemId,
            effect.userIds,
            effect.notification,
            effect.body,
          );
          if (n === 0) return not('skipped', 'No one to notify.');
          if (effect.post) await post(effect.itemId, effect.post);
          return done();
        }
        case 'post':
          await post(effect.itemId, effect.body);
          return done();
        case 'webhook':
          must(
            await db.from('outbound_webhooks').insert({
              org_id: orgId,
              automation_id: automation.id,
              item_id: effect.itemId,
              url: effect.url,
              payload: effect.payload ?? {},
            }),
          );
          return done({ message: 'queued' });
        case 'lock': {
          const { error } = await db.rpc('set_item_lock', {
            p_item: effect.itemId,
            p_locked: true,
            p_reason: effect.reason ?? undefined,
            p_automation: automation.id,
          });
          if (error) return not('failed', dbMessage(error));
          return done({ touched: [effect.itemId] });
        }
        case 'move': {
          const w = await loadWorld(world.item.sheetId, effect.itemId);
          if (!w) return not('failed', 'This item no longer exists or was archived.');
          if (w.item.groupId === effect.groupId) return not('no_change', '');
          const { error } = await db.rpc('move_item', {
            p_item: effect.itemId,
            p_group: effect.groupId,
            p_position: await endOf(effect.groupId),
            p_automation: automation.id,
          });
          if (error) return not('failed', dbMessage(error));
          return done({
            touched: [effect.itemId],
            events: [
              {
                type: 'item.moved',
                sheetId: w.item.sheetId,
                itemId: w.item.id,
                fromGroupId: w.item.groupId,
                toGroupId: effect.groupId,
                actor: { kind: 'automation', id: automation.id },
              },
            ],
          });
        }
        case 'create_item':
          return createItem(automation, effect);
        case 'update_linked':
          return updateLinked(automation, world, effect);
      }
    },

    async saveRun(run: RunRecord) {
      const { error } = await db.rpc('record_automation_run', {
        p_automation: run.automationId,
        p_item: run.itemId,
        p_event: run.event as unknown as Json,
        p_status: run.status,
        p_detail: run.detail,
        p_steps: run.steps as unknown as Json,
        p_depth: run.depth,
        p_chain: run.chainId,
        p_started_at: run.startedAt.toISOString(),
      });
      if (error) throw new Error(error.message);
    },

    async reportFailure(automation, item, message) {
      if (!automation.createdBy) return;
      const since = new Date(Date.now() - FAILURE_NOTICE_MS).toISOString();
      const { count } = await db
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('automation_id', automation.id)
        .eq('user_id', automation.createdBy)
        .eq('kind', 'system')
        .gte('created_at', since);
      if ((count ?? 0) > 0) return;
      await notify(
        automation,
        item.id,
        [automation.createdBy],
        'system',
        `Automation "${automation.name}" failed on ${item.displayId}: ${message}`,
      );
    },
  };
}
