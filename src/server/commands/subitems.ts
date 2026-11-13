import 'server-only';
import { randomUUID } from 'node:crypto';
import { resolveValueToken } from '@/engine/automations';
import { keysBetween } from '@/engine/ordering';
import { readSubitemSettings } from '@/engine/subitems';
import type { Item, Json, SubitemSettings } from '@/engine/types';
import { checkCreate, defaultValues, planValues } from '@/engine/writes';
import {
  createSubitemInput,
  enableSubitemsInput,
  moveSubitemInput,
  subitemSettingsInput,
  subitemsFromTemplateInput,
} from '@/lib/schemas/subitems';
import { fetchItemsById, type Db } from '@/lib/sheet-query';
import { planSubitems, type SubitemSetup } from '@/lib/templates/subitems';
import { toItem } from '@/lib/sheet-rows';
import { runAutomations, type AutomationEvent } from '@/server/automations';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { loadWriteContext, sha256 } from '@/server/sheet-context';
import { withOrg } from './context';

// Sub-items (docs/02 §12, docs/01): turn them on for a sheet (a hidden child sheet with its own fields and one hidden
// group, the sub-items column on the parent, the settings with the label, gate and template), add one or the
// template set under an item, move one to another parent. Every item write goes through the RPCs that log the
// sub-item's chain and the parents' pointer entries in one transaction; automations run as for any item.

type DbJson = NonNullable<Json>;

/**
 * Turn sub-items on for a sheet (the settings page, and the wizard for starts that come with a sub-item set). Runs
 * under the person's RLS: create_sheet makes the child sheet in one transaction, the schema triggers log it.
 */
export async function setUpSubitems(
  db: Db,
  orgId: string,
  sheetId: string,
  setup: SubitemSetup = {},
): Promise<Result<{ childSheetId: string }>> {
  const { data: parent } = await db
    .from('sheets')
    .select('id, name, folder_id, position, settings, parent_sheet_id, archived_at')
    .eq('id', sheetId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!parent || parent.archived_at) return fail('not_found', 'This sheet no longer exists.');
  if (parent.parent_sheet_id)
    return fail('invalid', 'Sub-items cannot have sub-items of their own.');
  const { data: existing } = await db
    .from('sheets')
    .select('id')
    .eq('parent_sheet_id', sheetId)
    .maybeSingle();
  if (existing) return ok({ childSheetId: existing.id });
  const { data: parentFields } = await db
    .from('fields')
    .select('key, position')
    .eq('sheet_id', sheetId);
  const settings = (parent.settings ?? {}) as Record<string, Json>;
  const rows = planSubitems(setup, {
    orgId,
    parent: {
      id: sheetId,
      name: parent.name,
      folderId: parent.folder_id,
      position: parent.position,
      holdAutomations: settings.holdAutomations !== false,
    },
    parentFields: parentFields ?? [],
    newId: randomUUID,
  });
  const { error } = await db.rpc('create_sheet', {
    p: { sheet: rows.sheet, groups: [rows.group], fields: rows.fields } as unknown as DbJson,
  });
  if (error) return fromDbError(error);
  const { error: fieldError } = await db
    .from('fields')
    .insert({ ...rows.parentField, org_id: orgId, sheet_id: sheetId, config: {} as DbJson });
  if (fieldError) return fromDbError(fieldError);
  const { error: settingsError } = await db
    .from('sheets')
    .update({ settings: { ...settings, subitems: rows.settings } as unknown as DbJson })
    .eq('id', sheetId);
  if (settingsError) return fromDbError(settingsError);
  return ok({ childSheetId: rows.sheet.id });
}

export async function enableSubitems(input: unknown): Promise<Result<{ childSheetId: string }>> {
  const p = enableSubitemsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    ({ supabase, orgId }) => setUpSubitems(supabase, orgId, v.sheetId, { label: v.label }),
    'enableSubitems',
  );
}

/** The label, the gates and the template set (sheets.settings.subitems); the label also renames the column. */
export async function updateSubitemSettings(
  input: unknown,
): Promise<Result<{ settings: SubitemSettings }>> {
  const p = subitemSettingsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId }) => {
      const { data: sheet } = await supabase
        .from('sheets')
        .select('id, settings')
        .eq('id', v.sheetId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!sheet) return fail('not_found', 'This sheet no longer exists.');
      const settings = (sheet.settings ?? {}) as Record<string, Json>;
      if (!settings.subitems) return fail('invalid', 'Turn on sub-items first.');
      const current = readSubitemSettings(settings.subitems);
      const next: SubitemSettings = {
        label: v.label ?? current.label,
        blockClose: v.blockClose ?? current.blockClose,
        lockCascade: v.lockCascade ?? current.lockCascade,
        template: (v.template as SubitemSettings['template'] | undefined) ?? current.template,
      };
      const { error } = await supabase
        .from('sheets')
        .update({ settings: { ...settings, subitems: next } as unknown as DbJson })
        .eq('id', v.sheetId);
      if (error) return fromDbError(error);
      if (v.label && v.label !== current.label) {
        await supabase
          .from('fields')
          .update({ name: v.label.slice(0, 80) })
          .eq('sheet_id', v.sheetId)
          .eq('type', 'subitems')
          .is('archived_at', null);
      }
      return ok({ settings: next });
    },
    'updateSubitemSettings',
  );
}

// ───────────────────────── items ─────────────────────────

async function holds(db: Db, sheetId: string): Promise<boolean> {
  const { data } = await db.from('sheets').select('settings').eq('id', sheetId).maybeSingle();
  return (data?.settings as { holdAutomations?: boolean } | null)?.holdAutomations !== false;
}

async function lastPosition(db: Db, parentId: string): Promise<string | null> {
  const { data } = await db
    .from('items')
    .select('position')
    .eq('parent_id', parentId)
    .order('position', { ascending: false })
    .limit(1);
  return data?.[0]?.position ?? null;
}

const created = (item: Item, userId: string): AutomationEvent => ({
  type: 'item.created',
  sheetId: item.sheetId,
  itemId: item.id,
  actor: { kind: 'user', id: userId },
});

export type SubitemResult = { item: Item; messages: string[]; held?: boolean; mutationId?: string };

/** Add one sub-item under an item (inline in the Table, the item panel, Shift+Enter). */
export async function createSubitem(input: unknown): Promise<Result<SubitemResult>> {
  const p = createSubitemInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role, user }) => {
      const w = await loadWriteContext(supabase, { orgId, userId: user.id, role }, v.sheetId, []);
      if (!w || !w.data.sheet.parentSheetId)
        return fail('not_found', 'Sub-items are off for this sheet.');
      const now = w.ctx.now.toISOString();
      const blank: Item = {
        id: '00000000-0000-0000-0000-000000000000',
        sheetId: v.sheetId,
        groupId: w.data.groups[0]?.id ?? '',
        seq: 0,
        displayId: '',
        name: v.name,
        values: defaultValues(w.fields, w.ctx),
        position: v.position,
        locked: false,
        createdAt: now,
        updatedAt: now,
        parentId: v.parentId,
      };
      const plan = planValues(blank, w.fields, v.values ?? {}, w.ctx, sha256);
      if (plan.rejected.length > 0) return fail('invalid', plan.rejected[0]!.reason);
      const check = checkCreate(plan.next, w.fields, w.ctx);
      if (check.blocking.length > 0)
        return fail('blocked', check.blocking.map((i) => i.message).join(' '));
      const { data, error } = await supabase.rpc('create_subitem', {
        p_parent: v.parentId,
        p_name: v.name,
        p_position: v.position,
        p_values: plan.next.values as Json,
      });
      if (error) return fromDbError(error);
      const item = toItem(data);
      if (v.hold && (await holds(supabase, v.sheetId))) {
        // the person is still filling the row: automations run when they finish it
        const { error: holdError } = await supabase.rpc('hold_item', {
          p_item: item.id,
          p_created: true,
        });
        if (!holdError) return ok({ item, messages: [], held: true, mutationId: v.mutationId });
      }
      const { messages } = await runAutomations([created(item, user.id)], {
        orgId,
        userId: user.id,
        workspace: v.org,
      });
      const [after] = messages.length ? await fetchItemsById(supabase, [item.id]) : [item];
      return ok({ item: after ?? item, messages, mutationId: v.mutationId });
    },
    'createSubitem',
  );
}

/** "From template": the sheet's sub-item set under an item, in one transaction. */
export async function createSubitemsFromTemplate(
  input: unknown,
): Promise<Result<{ items: Item[]; messages: string[]; mutationId?: string }>> {
  const p = subitemsFromTemplateInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role, user }) => {
      const { data: parentSheet } = await supabase
        .from('sheets')
        .select('id, settings')
        .eq('id', v.sheetId)
        .eq('org_id', orgId)
        .maybeSingle();
      const { data: child } = await supabase
        .from('sheets')
        .select('id')
        .eq('parent_sheet_id', v.sheetId)
        .maybeSingle();
      if (!parentSheet || !child) return fail('not_found', 'Sub-items are off for this sheet.');
      const template = readSubitemSettings(
        (parentSheet.settings as { subitems?: unknown } | null)?.subitems,
      ).template;
      if (template.length === 0)
        return fail(
          'invalid',
          'This sheet has no sub-item template yet. Add one in the sheet settings.',
        );
      const w = await loadWriteContext(supabase, { orgId, userId: user.id, role }, child.id, []);
      if (!w) return fail('not_found', 'Sub-items are off for this sheet.');
      const actor = { kind: 'user' as const, id: user.id };
      const positions = keysBetween(
        await lastPosition(supabase, v.parentId),
        null,
        template.length,
      );
      const now = w.ctx.now.toISOString();
      const rows: { name: string; position: string; values: Json }[] = [];
      for (const [i, t] of template.entries()) {
        const raw: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(t.values)) {
          const f = w.fields.find((x) => x.key === key);
          const r = resolveValueToken(value, w.ctx, actor);
          if (f && r.ok && r.value !== null) raw[f.id] = r.value;
        }
        const blank: Item = {
          id: '00000000-0000-0000-0000-000000000000',
          sheetId: child.id,
          groupId: w.data.groups[0]?.id ?? '',
          seq: 0,
          displayId: '',
          name: t.name,
          values: defaultValues(w.fields, w.ctx),
          position: positions[i]!,
          locked: false,
          createdAt: now,
          updatedAt: now,
          parentId: v.parentId,
        };
        const plan = planValues(blank, w.fields, raw, w.ctx, sha256);
        if (plan.rejected.length > 0)
          return fail('invalid', `${t.name}: ${plan.rejected[0]!.reason}`);
        rows.push({ name: t.name, position: positions[i]!, values: plan.next.values as Json });
      }
      const { data, error } = await supabase.rpc('create_subitems', {
        p_parent: v.parentId,
        p_rows: rows as unknown as Json,
      });
      if (error) return fromDbError(error);
      const items = (data ?? []).map(toItem);
      const { messages } = await runAutomations(
        items.map((it) => created(it, user.id)),
        { orgId, userId: user.id, workspace: v.org, summarise: true },
      );
      const fresh = messages.length
        ? await fetchItemsById(
            supabase,
            items.map((i) => i.id),
          )
        : items;
      return ok({ items: fresh, messages, mutationId: v.mutationId });
    },
    'createSubitemsFromTemplate',
  );
}

/** Move a sub-item to another parent of the same sheet (or reorder it under its own). The display id stays. */
export async function moveSubitem(
  input: unknown,
): Promise<Result<{ item: Item; messages: string[]; mutationId?: string }>> {
  const p = moveSubitemInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId }) => {
      const { data: row } = await supabase
        .from('items')
        .select('id, sheet_id, org_id')
        .eq('id', v.itemId)
        .maybeSingle();
      if (!row || row.org_id !== orgId || row.sheet_id !== v.sheetId)
        return fail('not_found', 'This item no longer exists or was archived.');
      const { data, error } = await supabase.rpc('move_subitem', {
        p_item: v.itemId,
        p_parent: v.parentId,
        p_position: v.position,
      });
      if (error) return fromDbError(error);
      // no trigger listens to moves (docs/04 §3)
      return ok({ item: toItem(data), messages: [], mutationId: v.mutationId });
    },
    'moveSubitem',
  );
}
