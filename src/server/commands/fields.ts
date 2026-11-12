import 'server-only';
import { randomUUID } from 'node:crypto';
import { fieldType, isFieldTypeId } from '@/engine/fields/registry';
import { resolveFieldType } from '@/engine/fields/resolve';
import { isLinkType, needsLibraryTarget, planTypeChange } from '@/engine/fields/type-change';
import { fieldKeyFromName, keyBetween } from '@/engine/ordering';
import type { Field } from '@/engine/types';
import type { Database } from '@/lib/database.types';
import {
  addFieldInput,
  changeTypeInput,
  deletedFieldsInput,
  fieldRefInput,
  moveFieldInput,
  updateFieldInput,
} from '@/lib/schemas/items';
import { FIELD_COLUMNS, toField } from '@/lib/sheet-rows';
import type { Db } from '@/lib/sheet-query';
import { isAdminRole } from '@/server/auth';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { loadWriteContext } from '@/server/sheet-context';
import { withOrg } from './context';
import { createInverseField, detachInverse } from './two-way';

// Field (column) commands (docs/01 FR-15…FR-20). Fields are structure: written under RLS (editors; locked fields
// admins only) and logged to the sheet chain by the schema trigger. Values move through set_item_values.

type FieldUpdate = Database['public']['Tables']['fields']['Update'];
type DbJson = NonNullable<FieldUpdate['config']>;

const clampWidth = (w: number) => Math.min(600, Math.max(60, Math.round(w)));
const LOCKED_FIELD = 'This field is kept by the app. Only owners and admins can change it.';

async function sheetFields(db: Db, sheetId: string) {
  const { data, error } = await db
    .from('fields')
    .select(FIELD_COLUMNS)
    .eq('sheet_id', sheetId)
    .order('position');
  if (error) throw new Error(error.message);
  return data;
}

async function fieldInOrg(db: Db, orgId: string, fieldId: string) {
  const { data } = await db
    .from('fields')
    .select(FIELD_COLUMNS)
    .eq('id', fieldId)
    .eq('org_id', orgId)
    .maybeSingle();
  return data;
}

async function sheetInOrg(db: Db, orgId: string, sheetId: string) {
  const { data } = await db
    .from('sheets')
    .select('id, is_library')
    .eq('id', sheetId)
    .eq('org_id', orgId)
    .maybeSingle();
  return data;
}

/** "Status", "Status 2" … so new columns never share a name. */
function freshName(base: string, taken: string[]): string {
  const names = new Set(taken.map((n) => n.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) if (!names.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

export async function addField(input: unknown): Promise<Result<{ field: Field }>> {
  const p = addFieldInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  if (!isFieldTypeId(v.type)) return fail('invalid', 'Choose a field type.');
  const def = fieldType(v.type)!;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId }) => {
      if (!(await sheetInOrg(supabase, orgId, v.sheetId)))
        return fail('not_found', 'This sheet no longer exists.');
      const all = await sheetFields(supabase, v.sheetId);
      const live = all.filter((f) => !f.archived_at);
      const name =
        v.name ??
        freshName(
          def.label,
          live.map((f) => f.name),
        );
      const anchor = v.beforeFieldId ?? v.afterFieldId;
      const at = anchor ? live.findIndex((f) => f.id === anchor) : -1;
      let position: string;
      if (at < 0) position = keyBetween(live.at(-1)?.position ?? null, null);
      else if (v.beforeFieldId)
        position = keyBetween(live[at - 1]?.position ?? null, live[at]!.position);
      else position = keyBetween(live[at]!.position, live[at + 1]?.position ?? null);
      const { data, error } = await supabase
        .from('fields')
        .insert({
          id: randomUUID(),
          org_id: orgId,
          sheet_id: v.sheetId,
          key: fieldKeyFromName(
            name,
            all.map((f) => f.key),
          ),
          name,
          type: v.type,
          position,
          width: clampWidth(def.defaultWidth),
          config: def.defaultConfig() as DbJson,
        })
        .select(FIELD_COLUMNS)
        .single();
      return error ? fromDbError(error) : ok({ field: toField(data) });
    },
    'addField',
  );
}

/**
 * The "Show on <target sheet> too" switch of a link field: turning it on creates the inverse field on the target sheet,
 * turning it off makes both fields one-way again. Returns the field's new inverseFieldId.
 */
async function twoWayChange(
  db: Db,
  orgId: string,
  row: { id: string; sheet_id: string },
  stored: { inverseFieldId?: string | null; targetSheetId?: string },
  next: Record<string, unknown>,
  twoWay: unknown,
): Promise<Result<string | null>> {
  const current = stored.inverseFieldId ?? null;
  const target = typeof next.targetSheetId === 'string' ? next.targetSheetId : '';
  if (current && target !== (stored.targetSheetId ?? ''))
    return fail(
      'invalid',
      'Turn off showing this link on the other sheet before linking to another sheet.',
    );
  if (twoWay === true && !current) {
    if (!target) return fail('invalid', 'Choose the sheet to link to first.');
    const { data: sheet } = await db
      .from('sheets')
      .select('item_label')
      .eq('id', row.sheet_id)
      .maybeSingle();
    const created = await createInverseField(
      db,
      orgId,
      { fieldId: row.id, sheetId: row.sheet_id, itemLabel: sheet?.item_label ?? 'Linked item' },
      target,
    );
    return created.ok ? ok(created.data.id) : created;
  }
  if (twoWay === false && current) {
    const r = await detachInverse(db, current);
    return r.ok ? ok(null) : r;
  }
  return ok(current);
}

export async function updateField(input: unknown): Promise<Result<{ field: Field }>> {
  const p = updateFieldInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role }) => {
      const row = await fieldInOrg(supabase, orgId, v.fieldId);
      if (!row || row.archived_at) return fail('not_found', 'This field no longer exists.');
      if (row.locked && !isAdminRole(role)) return fail('forbidden', LOCKED_FIELD);
      if (v.locked !== undefined && v.locked !== row.locked && !isAdminRole(role))
        return fail('forbidden', 'Only owners and admins can lock a field.');
      const def = resolveFieldType(row.type)!;
      const patch: FieldUpdate = {};
      if (v.name !== undefined) patch.name = v.name;
      if (v.description !== undefined) patch.description = v.description || null;
      if (v.required !== undefined) patch.required = v.required;
      if (v.locked !== undefined) patch.locked = v.locked;
      if (v.width !== undefined) patch.width = clampWidth(v.width);
      if (v.validation !== undefined) patch.validation = v.validation as DbJson;
      if (v.visibility !== undefined) patch.visibility = v.visibility as DbJson | null;
      if (v.rules !== undefined) {
        // rules live on the field that changes (docs/03 §6)
        if (v.rules.some((r) => r.whenFieldKey !== row.key))
          return fail('invalid', 'A rule must watch this field.');
        patch.rules = v.rules as DbJson;
      }
      if (v.config !== undefined) {
        const { default: dflt, twoWay, ...rest } = v.config;
        if (isLinkType(row.type)) {
          // inverseFieldId is the app's to keep: only the two-way switch changes it
          const stored =
            (row.config as { inverseFieldId?: string | null; targetSheetId?: string }) ?? {};
          rest.inverseFieldId = stored.inverseFieldId ?? null;
          const r = await twoWayChange(supabase, orgId, row, stored, rest, twoWay);
          if (!r.ok) return r;
          rest.inverseFieldId = r.data;
        }
        const parsed = def.configSchema.safeParse(rest);
        if (!parsed.success)
          return fail('invalid', parsed.error.issues[0]?.message ?? 'Check the field settings.', {
            config: parsed.error.issues[0]?.message ?? 'Check the field settings.',
          });
        if (isLinkType(row.type) && needsLibraryTarget(row.type)) {
          const target = (parsed.data as { targetSheetId?: string }).targetSheetId;
          if (target) {
            const lib = await sheetInOrg(supabase, orgId, target);
            if (!lib?.is_library) return fail('invalid', 'Choose a library sheet.');
          }
        }
        patch.config = {
          ...(parsed.data as object),
          ...(dflt !== undefined && dflt !== null && dflt !== '' ? { default: dflt } : {}),
        } as DbJson;
      }
      if (Object.keys(patch).length === 0) return ok({ field: toField(row) });
      const { data, error } = await supabase
        .from('fields')
        .update(patch)
        .eq('id', row.id)
        .select(FIELD_COLUMNS)
        .maybeSingle();
      if (error) return fromDbError(error);
      if (!data) return fail('forbidden', LOCKED_FIELD);
      return ok({ field: toField(data) });
    },
    'updateField',
  );
}

/** Reorder: put the field at `toIndex` among the sheet's fields; only its position changes. */
export async function moveField(input: unknown): Promise<Result<{ field: Field }>> {
  const p = moveFieldInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role }) => {
      const row = await fieldInOrg(supabase, orgId, v.fieldId);
      if (!row || row.archived_at) return fail('not_found', 'This field no longer exists.');
      if (row.locked && !isAdminRole(role)) return fail('forbidden', LOCKED_FIELD);
      const others = (await sheetFields(supabase, row.sheet_id)).filter(
        (f) => !f.archived_at && f.id !== row.id,
      );
      const at = Math.min(v.toIndex, others.length);
      const position = keyBetween(others[at - 1]?.position ?? null, others[at]?.position ?? null);
      const { data, error } = await supabase
        .from('fields')
        .update({ position })
        .eq('id', row.id)
        .select(FIELD_COLUMNS)
        .single();
      return error ? fromDbError(error) : ok({ field: toField(data) });
    },
    'moveField',
  );
}

/** A copy of the column's settings right after it, without values (docs are silent on copying values). */
export async function duplicateField(input: unknown): Promise<Result<{ field: Field }>> {
  const p = fieldRefInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId }) => {
      const row = await fieldInOrg(supabase, orgId, v.fieldId);
      if (!row || row.archived_at) return fail('not_found', 'This field no longer exists.');
      const all = await sheetFields(supabase, row.sheet_id);
      const live = all.filter((f) => !f.archived_at);
      const at = live.findIndex((f) => f.id === row.id);
      const name = freshName(
        `${row.name} copy`.slice(0, 80),
        live.map((f) => f.name),
      );
      const { data, error } = await supabase
        .from('fields')
        .insert({
          id: randomUUID(),
          org_id: orgId,
          sheet_id: row.sheet_id,
          key: fieldKeyFromName(
            name,
            all.map((f) => f.key),
          ),
          name,
          type: row.type,
          position: keyBetween(row.position, live[at + 1]?.position ?? null),
          width: row.width,
          required: row.required,
          description: row.description,
          // a two-way link's inverse belongs to the original
          config: (isLinkType(row.type)
            ? { ...(row.config as object), inverseFieldId: null }
            : row.config) as DbJson,
          validation: row.validation,
          rules: [] as DbJson,
          visibility: row.visibility,
        })
        .select(FIELD_COLUMNS)
        .single();
      return error ? fromDbError(error) : ok({ field: toField(data) });
    },
    'duplicateField',
  );
}

/** Soft delete (FR-18): archived_at; restorable for 30 days. Locked fields cannot be deleted. */
export async function deleteField(input: unknown): Promise<Result<{ fieldId: string }>> {
  const p = fieldRefInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId }) => {
      const row = await fieldInOrg(supabase, orgId, v.fieldId);
      if (!row || row.archived_at) return fail('not_found', 'This field no longer exists.');
      if (row.locked)
        return fail('forbidden', 'This field is kept by the app. You can hide it, not delete it.');
      const { data, error } = await supabase
        .from('fields')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', row.id)
        .select('id');
      if (error) return fromDbError(error);
      return data.length ? ok({ fieldId: row.id }) : fail('forbidden', LOCKED_FIELD);
    },
    'deleteField',
  );
}

export async function restoreField(input: unknown): Promise<Result<{ field: Field }>> {
  const p = fieldRefInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId }) => {
      const row = await fieldInOrg(supabase, orgId, v.fieldId);
      if (!row) return fail('not_found', 'This field no longer exists.');
      const { data, error } = await supabase
        .from('fields')
        .update({ archived_at: null })
        .eq('id', row.id)
        .select(FIELD_COLUMNS)
        .single();
      return error ? fromDbError(error) : ok({ field: toField(data) });
    },
    'restoreField',
  );
}

export type DeletedField = { id: string; name: string; type: string; deletedAt: string };

/** Fields deleted in the last 30 days, newest first. */
export async function listDeletedFields(input: unknown): Promise<Result<DeletedField[]>> {
  const p = deletedFieldsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId }) => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data, error } = await supabase
        .from('fields')
        .select('id, name, type, archived_at')
        .eq('org_id', orgId)
        .eq('sheet_id', v.sheetId)
        .gte('archived_at', since)
        .order('archived_at', { ascending: false });
      if (error) return fromDbError(error);
      return ok(
        data.map((f) => ({ id: f.id, name: f.name, type: f.type, deletedAt: f.archived_at! })),
      );
    },
    'listDeletedFields',
  );
}

export type TypeChangePreview = {
  mode: 'in_place' | 'copy' | 'none';
  total: number;
  converted: number;
  emptied: number;
  summary: string;
  /** Items whose value could not be written (locked items for editors). */
  failed?: number;
  /** The field that holds the values afterwards (the new one for a copy). */
  field?: Field;
};

/**
 * Change a field's type (docs/03 §5): preview first ("38 of 40 values convert, 2 become empty"); apply converts in
 * place, or creates a new field after this one and copies the converted values into it.
 */
export async function changeFieldType(input: unknown): Promise<Result<TypeChangePreview>> {
  const p = changeTypeInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  if (!isFieldTypeId(v.to)) return fail('invalid', 'Choose a field type.');
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role, user }) => {
      const row = await fieldInOrg(supabase, orgId, v.fieldId);
      if (!row || row.archived_at) return fail('not_found', 'This field no longer exists.');
      if (row.locked && !isAdminRole(role)) return fail('forbidden', LOCKED_FIELD);
      const w = await loadWriteContext(
        supabase,
        { orgId, userId: user.id, role },
        row.sheet_id,
        'all',
      );
      if (!w) return fail('not_found', 'This sheet no longer exists.');
      const field = w.fields.find((f) => f.id === row.id)!;
      const plan = planTypeChange(field, v.to, [...w.items.values()], w.ctx);
      const preview: TypeChangePreview = {
        mode: plan.mode,
        total: plan.total,
        converted: plan.converted,
        emptied: plan.emptied,
        summary: plan.summary,
      };
      if (plan.mode === 'none')
        return fail(
          'invalid',
          'This field cannot change to that type. Create a new field instead.',
        );
      if (needsLibraryTarget(v.to)) {
        const target = (plan.config as { targetSheetId?: string }).targetSheetId;
        const lib = target ? await sheetInOrg(supabase, orgId, target) : null;
        if (!lib?.is_library)
          return fail('invalid', 'Requirement and control links must point at a library sheet.');
      }
      if (!v.apply) return ok(preview);

      let target: Field;
      if (plan.mode === 'in_place') {
        const { data, error } = await supabase
          .from('fields')
          .update({ type: v.to, config: plan.config as DbJson })
          .eq('id', row.id)
          .select(FIELD_COLUMNS)
          .single();
        if (error) return fromDbError(error);
        target = toField(data);
      } else {
        const all = await sheetFields(supabase, row.sheet_id);
        const live = all.filter((f) => !f.archived_at);
        const at = live.findIndex((f) => f.id === row.id);
        const name = freshName(
          `${row.name} (${fieldType(v.to)!.label})`.slice(0, 80),
          live.map((f) => f.name),
        );
        const { data, error } = await supabase
          .from('fields')
          .insert({
            id: randomUUID(),
            org_id: orgId,
            sheet_id: row.sheet_id,
            key: fieldKeyFromName(
              name,
              all.map((f) => f.key),
            ),
            name,
            type: v.to,
            position: keyBetween(row.position, live[at + 1]?.position ?? null),
            width: clampWidth(fieldType(v.to)!.defaultWidth),
            config: plan.config as DbJson,
          })
          .select(FIELD_COLUMNS)
          .single();
        if (error) return fromDbError(error);
        target = toField(data);
      }
      // write converted values, logged per value; locked items fail for editors and are counted
      let failed = 0;
      const writes = [...plan.values.entries()];
      for (let i = 0; i < writes.length; i += 10) {
        const results = await Promise.all(
          writes.slice(i, i + 10).map(([itemId, value]) =>
            supabase.rpc('set_item_values', {
              p_item: itemId,
              p_patch: { [target.id]: value } as DbJson,
              p_note: `Field type changed to ${fieldType(v.to)!.label}`,
            }),
          ),
        );
        failed += results.filter((r) => r.error).length;
      }
      return ok({ ...preview, failed, field: target });
    },
    v.apply ? 'changeFieldType' : 'previewFieldType',
  );
}
