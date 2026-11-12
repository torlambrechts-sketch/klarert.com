import 'server-only';
import type { LinkConfig } from '@/engine/fields/link';
import { needsLibraryTarget } from '@/engine/fields/type-change';
import { resolveFieldType } from '@/engine/fields/resolve';
import type { Ctx, Field, Item, Json } from '@/engine/types';
import { checkCreate, checkWrite, defaultValues, planValues } from '@/engine/writes';
import {
  archiveItemsInput,
  bulkSetValuesInput,
  clickButtonInput,
  createItemInput,
  lockItemInput,
  moveItemsInput,
  setLinksInput,
  setValuesInput,
} from '@/lib/schemas/items';
import { toItem, toLink } from '@/lib/sheet-rows';
import type { LinkRow } from '@/engine/sheet-data';
import type { Db } from '@/lib/sheet-query';
import { isAdminRole, type Role } from '@/server/auth';
import { runAutomations, type AutomationEvent } from '@/server/automations';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import {
  loadWriteContext,
  sha256,
  uniqueConflicts,
  type WriteContext,
} from '@/server/sheet-context';
import { withOrg } from './context';

// Item commands (docs/02 §4): authorise → validate with the field registry → RPC (row + activity log in one
// transaction) → automations → { item, messages }. The browser never writes items itself.

export type ItemResult = { item: Item; messages: string[]; mutationId?: string };

const LOCKED = 'This item is locked. Only owners and admins can change it.';

const lockedFor = (item: Item, role: Role) => item.locked && !isAdminRole(role);
const lockMessage = (item: Item) =>
  item.lockReason
    ? `This item is locked: ${item.lockReason}. Only owners and admins can change it.`
    : LOCKED;

async function automations(events: AutomationEvent[], orgId: string, userId: string) {
  return (await runAutomations(events, { orgId, userId })).messages;
}

type Who = { supabase: Db; orgId: string; userId: string; role: Role };

const sheetNotFound = () => fail('not_found', 'This sheet no longer exists.');
const itemNotFound = () => fail('not_found', 'This item no longer exists or was archived.');

/** Split raw inputs by where the field stores its value. */
function splitInputs(fields: Field[], input: Record<string, unknown>) {
  const values: Record<string, unknown> = {};
  const protectedInputs: [Field, unknown][] = [];
  const byId = new Map(fields.map((f) => [f.id, f]));
  for (const [id, v] of Object.entries(input)) {
    const f = byId.get(id);
    if (f && resolveFieldType(f.type)?.storage === 'protected') protectedInputs.push([f, v]);
    else values[id] = v;
  }
  return { values, protectedInputs };
}

function commentMessage(fields: Field[], ruleFieldKeys: string[], ctx: Ctx) {
  const names = [...new Set(ruleFieldKeys)]
    .map((k) => ctx.fieldsByKey.get(k)?.name ?? fields.find((f) => f.key === k)?.name)
    .filter(Boolean);
  return `Add a comment to change ${names.join(' and ') || 'this value'}.`;
}

/**
 * Validate and write one item's values and name. Shared by setValues (one cell or panel field) and bulkSetValues
 * (paste, bulk edit). Returns the saved row.
 */
async function writeValues(
  who: Who,
  w: WriteContext,
  item: Item,
  change: { values?: Record<string, unknown>; name?: string; note?: string },
): Promise<Result<{ item: Item; changed: string[] }>> {
  if (lockedFor(item, who.role)) return fail('forbidden', lockMessage(item));
  const { values, protectedInputs } = splitInputs(w.fields, change.values ?? {});
  const plan = planValues(item, w.fields, values, w.ctx, sha256);
  if (plan.rejected.length > 0) {
    const fieldErrors = Object.fromEntries(plan.rejected.map((r) => [r.fieldId, r.reason]));
    return fail('invalid', plan.rejected[0]!.reason, fieldErrors);
  }
  const conflicts = await uniqueConflicts(
    who.supabase,
    item.sheetId,
    item.id,
    w.fields,
    plan.patch,
  );
  const check = checkWrite(item, plan.next, w.fields, plan.changedKeys, w.ctx, {
    isUnique: (f) => !conflicts.has(f.id),
  });
  if (check.blocking.length > 0) {
    return fail('blocked', check.blocking.map((i) => i.message).join(' '), {
      [check.blocking[0]!.fieldKey]: check.blocking[0]!.message,
    });
  }
  if (check.commentRequired.length > 0 && !change.note) {
    return fail(
      'comment_required',
      commentMessage(
        w.fields,
        check.commentRequired.map((r) => r.whenFieldKey),
        w.ctx,
      ),
    );
  }

  for (const [field, raw] of protectedInputs) {
    const def = resolveFieldType(field.type)!;
    const v = raw === null || raw === '' ? null : def.normalize(raw, field.config, w.ctx);
    if (raw !== null && raw !== '' && v === null)
      return fail('invalid', `This is not a valid ${field.name.toLowerCase()}.`);
    const { error } = await who.supabase.rpc('set_protected_value', {
      p_item: item.id,
      p_field: field.id,
      p_value: (v as string | null) ?? '',
      p_note: change.note,
    });
    if (error) return fromDbError(error);
  }

  const rename = change.name !== undefined && change.name !== item.name ? change.name : undefined;
  let saved = item;
  if (Object.keys(plan.patch).length > 0 || rename !== undefined) {
    const { data, error } = await who.supabase.rpc('set_item_values', {
      p_item: item.id,
      p_patch: plan.patch as Json,
      p_name: rename,
      p_note: change.note,
    });
    if (error) return fromDbError(error);
    saved = toItem(data);
  } else if (protectedInputs.length > 0) {
    const { data } = await who.supabase
      .from('items')
      .select('updated_at')
      .eq('id', item.id)
      .single();
    if (data) saved = { ...item, updatedAt: data.updated_at };
  }
  if (change.note && check.commentRequired.length > 0) {
    const { error } = await who.supabase.from('item_updates').insert({
      org_id: who.orgId,
      item_id: item.id,
      author_id: who.userId,
      kind: 'update',
      body: change.note,
    });
    if (error) return fromDbError(error);
  }
  const changed = [
    ...w.fields.filter((f) => plan.changedKeys.includes(f.key)).map((f) => f.id),
    ...protectedInputs.map(([f]) => f.id),
  ];
  return ok({ item: saved, changed });
}

// ───────────────────────── create ─────────────────────────

export async function createItem(input: unknown): Promise<Result<ItemResult>> {
  const p = createItemInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role, user }) => {
      const w = await loadWriteContext(supabase, { orgId, userId: user.id, role }, v.sheetId, []);
      if (!w) return sheetNotFound();
      if (!w.data.groups.some((g) => g.id === v.groupId))
        return fail('not_found', 'This group no longer exists.');
      const now = w.ctx.now.toISOString();
      const blank: Item = {
        id: '00000000-0000-0000-0000-000000000000',
        sheetId: v.sheetId,
        groupId: v.groupId,
        seq: 0,
        displayId: '',
        name: v.name,
        values: defaultValues(w.fields, w.ctx),
        position: v.position,
        locked: false,
        createdAt: now,
        updatedAt: now,
      };
      const { values } = splitInputs(w.fields, v.values ?? {});
      const plan = planValues(blank, w.fields, values, w.ctx, sha256);
      if (plan.rejected.length > 0) return fail('invalid', plan.rejected[0]!.reason);
      const conflicts = await uniqueConflicts(
        supabase,
        v.sheetId,
        null,
        w.fields,
        plan.next.values,
      );
      const check = checkCreate(plan.next, w.fields, w.ctx, {
        isUnique: (f) => !conflicts.has(f.id),
      });
      if (check.blocking.length > 0)
        return fail('blocked', check.blocking.map((i) => i.message).join(' '));
      const { data, error } = await supabase.rpc('create_item', {
        p_sheet: v.sheetId,
        p_group: v.groupId,
        p_name: v.name,
        p_position: v.position,
        p_values: plan.next.values as Json,
      });
      if (error) return fromDbError(error);
      const item = toItem(data);
      const messages = await automations(
        [{ type: 'item_created', sheetId: v.sheetId, itemId: item.id }],
        orgId,
        user.id,
      );
      return ok({ item, messages, mutationId: v.mutationId });
    },
    'createItem',
  );
}

// ───────────────────────── values ─────────────────────────

export async function setValues(input: unknown): Promise<Result<ItemResult>> {
  const p = setValuesInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role, user }) => {
      const who = { supabase, orgId, userId: user.id, role };
      const w = await loadWriteContext(supabase, who, v.sheetId, [v.itemId]);
      if (!w) return sheetNotFound();
      const item = w.items.get(v.itemId);
      if (!item || item.archivedAt) return itemNotFound();
      if (v.expectedUpdatedAt && v.expectedUpdatedAt !== item.updatedAt)
        return fail('conflict', 'Someone else changed this item since you opened it.');
      const r = await writeValues(who, w, item, v);
      if (!r.ok) return r;
      const messages =
        r.data.changed.length > 0
          ? await automations(
              [
                {
                  type: 'field_changed',
                  sheetId: v.sheetId,
                  itemId: item.id,
                  fieldIds: r.data.changed,
                },
              ],
              orgId,
              user.id,
            )
          : [];
      return ok({ item: r.data.item, messages, mutationId: v.mutationId });
    },
    'setValues',
  );
}

export type BulkResult = {
  items: Item[];
  skipped: { itemId: string; message: string }[];
  messages: string[];
  mutationId?: string;
};

/** Paste and bulk edit: each item is validated and written on its own; blocked items are reported, not fatal. */
export async function bulkSetValues(input: unknown): Promise<Result<BulkResult>> {
  const p = bulkSetValuesInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role, user }) => {
      const who = { supabase, orgId, userId: user.id, role };
      const w = await loadWriteContext(
        supabase,
        who,
        v.sheetId,
        v.items.map((i) => i.itemId),
      );
      if (!w) return sheetNotFound();
      const items: Item[] = [];
      const skipped: BulkResult['skipped'] = [];
      const events: AutomationEvent[] = [];
      for (const change of v.items) {
        const item = w.items.get(change.itemId);
        if (!item || item.archivedAt) {
          skipped.push({ itemId: change.itemId, message: 'This item no longer exists.' });
          continue;
        }
        const r = await writeValues(who, w, item, change);
        if (!r.ok) {
          skipped.push({
            itemId: change.itemId,
            message:
              r.error.code === 'comment_required'
                ? 'This change needs a comment. Make it in the cell instead.'
                : r.error.message,
          });
          continue;
        }
        items.push(r.data.item);
        if (r.data.changed.length > 0)
          events.push({
            type: 'field_changed',
            sheetId: v.sheetId,
            itemId: item.id,
            fieldIds: r.data.changed,
          });
      }
      const messages = await automations(events, orgId, user.id);
      return ok({ items, skipped, messages, mutationId: v.mutationId });
    },
    'bulkSetValues',
  );
}

// ───────────────────────── move, archive, lock ─────────────────────────

export async function moveItems(input: unknown): Promise<Result<BulkResult>> {
  const p = moveItemsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role, user }) => {
      const w = await loadWriteContext(
        supabase,
        { orgId, userId: user.id, role },
        v.sheetId,
        v.moves.map((m) => m.itemId),
      );
      if (!w) return sheetNotFound();
      const items: Item[] = [];
      const skipped: BulkResult['skipped'] = [];
      const events: AutomationEvent[] = [];
      for (const m of v.moves) {
        const item = w.items.get(m.itemId);
        if (!item || item.archivedAt) {
          skipped.push({ itemId: m.itemId, message: 'This item no longer exists.' });
          continue;
        }
        if (lockedFor(item, role)) {
          skipped.push({ itemId: m.itemId, message: lockMessage(item) });
          continue;
        }
        const { data, error } = await supabase.rpc('move_item', {
          p_item: m.itemId,
          p_group: m.groupId,
          p_position: m.position,
        });
        if (error) {
          const r = fromDbError(error);
          skipped.push({ itemId: m.itemId, message: r.ok ? '' : r.error.message });
          continue;
        }
        items.push(toItem(data));
        if (item.groupId !== m.groupId)
          events.push({
            type: 'item_moved',
            sheetId: v.sheetId,
            itemId: m.itemId,
            from: item.groupId,
            to: m.groupId,
          });
      }
      const messages = await automations(events, orgId, user.id);
      return ok({ items, skipped, messages, mutationId: v.mutationId });
    },
    'moveItems',
  );
}

/** Archive or restore (Undo) items. */
export async function archiveItems(input: unknown): Promise<Result<BulkResult>> {
  const p = archiveItemsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role, user }) => {
      const w = await loadWriteContext(
        supabase,
        { orgId, userId: user.id, role },
        v.sheetId,
        v.itemIds,
      );
      if (!w) return sheetNotFound();
      const items: Item[] = [];
      const skipped: BulkResult['skipped'] = [];
      const events: AutomationEvent[] = [];
      for (const id of v.itemIds) {
        const item = w.items.get(id);
        if (!item) {
          skipped.push({ itemId: id, message: 'This item no longer exists.' });
          continue;
        }
        if (lockedFor(item, role)) {
          skipped.push({ itemId: id, message: lockMessage(item) });
          continue;
        }
        const { data, error } = await supabase.rpc('set_item_archived', {
          p_item: id,
          p_archived: v.archived,
        });
        if (error) {
          const r = fromDbError(error);
          skipped.push({ itemId: id, message: r.ok ? '' : r.error.message });
          continue;
        }
        items.push(toItem(data));
        events.push({
          type: v.archived ? 'item_archived' : 'item_restored',
          sheetId: v.sheetId,
          itemId: id,
        });
      }
      const messages = await automations(events, orgId, user.id);
      return ok({ items, skipped, messages, mutationId: v.mutationId });
    },
    v.archived ? 'archiveItems' : 'restoreItems',
  );
}

/** Lock or unlock an item (docs/01 §4: owners and admins). */
export async function lockItem(input: unknown): Promise<Result<ItemResult>> {
  const p = lockItemInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId, user }) => {
      const { data: row } = await supabase
        .from('items')
        .select('id, sheet_id, org_id')
        .eq('id', v.itemId)
        .maybeSingle();
      if (!row || row.org_id !== orgId || row.sheet_id !== v.sheetId) return itemNotFound();
      const { data, error } = await supabase.rpc('set_item_lock', {
        p_item: v.itemId,
        p_locked: v.locked,
        p_reason: v.locked ? v.reason || undefined : undefined,
      });
      if (error) return fromDbError(error);
      const messages = await automations(
        [
          {
            type: v.locked ? 'item_locked' : 'item_unlocked',
            sheetId: v.sheetId,
            itemId: v.itemId,
          },
        ],
        orgId,
        user.id,
      );
      return ok({ item: toItem(data), messages, mutationId: v.mutationId });
    },
    'lockItem',
  );
}

// ───────────────────────── links ─────────────────────────

export type LinksResult = { links: LinkRow[]; messages: string[]; mutationId?: string };

/** Replace the targets of a link field on one item; two-way links keep the inverse field in step. */
export async function setLinks(input: unknown): Promise<Result<LinksResult>> {
  const p = setLinksInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role, user }) => {
      const w = await loadWriteContext(supabase, { orgId, userId: user.id, role }, v.sheetId, [
        v.itemId,
      ]);
      if (!w) return sheetNotFound();
      const item = w.items.get(v.itemId);
      if (!item || item.archivedAt) return itemNotFound();
      if (lockedFor(item, role)) return fail('forbidden', lockMessage(item));
      const field = w.fields.find((f) => f.id === v.fieldId);
      if (!field || resolveFieldType(field.type)?.storage !== 'links')
        return fail('not_found', 'This field no longer exists.');
      const cfg = field.config as Partial<LinkConfig>;
      const to = [...new Set(v.to)].filter((id) => id !== v.itemId);
      if (cfg.multiple === false && to.length > 1)
        return fail('invalid', `${field.name} links to one item only.`);
      if (field.required && to.length === 0) return fail('blocked', `${field.name} is required.`);
      if (needsLibraryTarget(field.type) && to.length > 0) {
        const { data: lib } = await supabase
          .from('items')
          .select('id, sheets!inner(is_library)')
          .in('id', to);
        if ((lib ?? []).some((r) => !r.sheets.is_library))
          return fail('invalid', 'Choose items from a library sheet.');
      }
      const before = w.ctx.links(item.id, field.id);
      if (cfg.inverseFieldId && !isAdminRole(role)) {
        // the inverse side is written too: a locked item on the other sheet refuses the whole change up front
        const touched = [
          ...to.filter((id) => !before.includes(id)),
          ...before.filter((id) => !to.includes(id)),
        ];
        if (touched.length > 0) {
          const { data: locked } = await supabase
            .from('items')
            .select('display_id')
            .in('id', touched)
            .eq('locked', true);
          if ((locked ?? []).length > 0)
            return fail(
              'forbidden',
              `${locked![0]!.display_id} is locked, so its side of this link cannot change. Ask an owner or admin.`,
            );
        }
      }
      const { data, error } = await supabase.rpc('set_item_links', {
        p_field: field.id,
        p_from: item.id,
        p_to: to,
        p_mode: 'replace',
      });
      if (error) return fromDbError(error);
      if (cfg.inverseFieldId) {
        const added = to.filter((id) => !before.includes(id));
        const removed = before.filter((id) => !to.includes(id));
        for (const [ids, mode] of [
          [added, 'add'],
          [removed, 'remove'],
        ] as const) {
          for (const target of ids) {
            const r = await supabase.rpc('set_item_links', {
              p_field: cfg.inverseFieldId,
              p_from: target,
              p_to: [item.id],
              p_mode: mode,
            });
            if (r.error) return fromDbError(r.error);
          }
        }
      }
      const messages = await automations(
        [{ type: 'links_changed', sheetId: v.sheetId, itemId: item.id, fieldId: field.id }],
        orgId,
        user.id,
      );
      return ok({ links: (data ?? []).map(toLink), messages, mutationId: v.mutationId });
    },
    'setLinks',
  );
}

// ───────────────────────── buttons ─────────────────────────

/** A button cell emits a `button_clicked` event (docs/04); the runner decides what happens. */
export async function clickButton(input: unknown): Promise<Result<{ messages: string[] }>> {
  const p = clickButtonInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role, user }) => {
      const w = await loadWriteContext(supabase, { orgId, userId: user.id, role }, v.sheetId, [
        v.itemId,
      ]);
      if (!w) return sheetNotFound();
      const item = w.items.get(v.itemId);
      const field = w.fields.find((f) => f.id === v.fieldId);
      if (!item || item.archivedAt) return itemNotFound();
      if (!field || resolveFieldType(field.type)?.storage !== 'none')
        return fail('not_found', 'This button no longer exists.');
      const outcome = await runAutomations(
        [{ type: 'button_clicked', sheetId: v.sheetId, itemId: v.itemId, fieldId: v.fieldId }],
        { orgId, userId: user.id },
      );
      return ok({
        messages:
          outcome.runs.length === 0 ? ['No automation uses this button yet.'] : outcome.messages,
      });
    },
    'clickButton',
  );
}
