import 'server-only';
import { randomUUID } from 'node:crypto';
import { fieldType } from '@/engine/fields/registry';
import { fieldKeyFromName, keyBetween } from '@/engine/ordering';
import type { Field, Json } from '@/engine/types';
import { FIELD_COLUMNS, toField } from '@/lib/sheet-rows';
import type { Db } from '@/lib/sheet-query';
import { fail, fromDbError, ok, type Result } from '@/server/result';

// Two-way links (docs/03 link: "two-way when inverseFieldId is set; the wizard creates the inverse field on the
// target sheet"). The inverse is a plain link field on the target sheet pointing back; both fields store each other's
// id in config.inverseFieldId, and setLinks keeps both directions in step. Written with the person's client (RLS).

/** "Status", "Status 2" … so the inverse never shares a name with a field of the target sheet. */
function freshName(base: string, taken: string[]): string {
  const names = new Set(taken.map((n) => n.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) if (!names.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/**
 * Create the inverse link field on `targetSheetId` for the link field `sourceFieldId` of `sourceSheetId`, named after
 * what the source sheet calls its items (docs/07 step 4: an "Actions" link on Corrective actions gives Actions a
 * "Corrective action" field), and copy the existing links into it. Returns the new field.
 */
export async function createInverseField(
  db: Db,
  orgId: string,
  source: { fieldId: string; sheetId: string; itemLabel: string },
  targetSheetId: string,
): Promise<Result<Field>> {
  const { data: target } = await db
    .from('sheets')
    .select('id')
    .eq('id', targetSheetId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!target) return fail('not_found', 'The linked sheet no longer exists.');
  const { data: existing, error: e1 } = await db
    .from('fields')
    .select('key, name, position, archived_at')
    .eq('sheet_id', targetSheetId)
    .order('position');
  if (e1) return fromDbError(e1);
  const live = (existing ?? []).filter((f) => !f.archived_at);
  const name = freshName(
    source.itemLabel.slice(0, 80),
    live.map((f) => f.name),
  );
  const def = fieldType('link')!;
  const config = { targetSheetId: source.sheetId, multiple: true, inverseFieldId: source.fieldId };
  const { data, error } = await db
    .from('fields')
    .insert({
      id: randomUUID(),
      org_id: orgId,
      sheet_id: targetSheetId,
      key: fieldKeyFromName(
        name,
        (existing ?? []).map((f) => f.key),
      ),
      name,
      type: 'link',
      position: keyBetween(live.at(-1)?.position ?? null, null),
      width: def.defaultWidth,
      config: config as NonNullable<Json>,
    })
    .select(FIELD_COLUMNS)
    .single();
  if (error) return fromDbError(error);
  const inverse = toField(data);

  // links made before the field became two-way: write their mirror rows
  const { data: links } = await db
    .from('item_links')
    .select('from_item, to_item')
    .eq('field_id', source.fieldId);
  const byTarget = new Map<string, string[]>();
  for (const l of links ?? [])
    byTarget.set(l.to_item, [...(byTarget.get(l.to_item) ?? []), l.from_item]);
  for (const [to, froms] of byTarget) {
    const r = await db.rpc('set_item_links', {
      p_field: inverse.id,
      p_from: to,
      p_to: froms,
      p_mode: 'add',
    });
    if (r.error) return fromDbError(r.error);
  }
  return ok(inverse);
}

/** Make a former inverse field one-way again (the field and its links stay). */
export async function detachInverse(db: Db, inverseFieldId: string): Promise<Result<null>> {
  const { data } = await db
    .from('fields')
    .select('id, config')
    .eq('id', inverseFieldId)
    .maybeSingle();
  if (!data) return ok(null);
  const { error } = await db
    .from('fields')
    .update({ config: { ...(data.config as object), inverseFieldId: null } as NonNullable<Json> })
    .eq('id', data.id);
  return error ? fromDbError(error) : ok(null);
}
