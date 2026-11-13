import 'server-only';
import { randomUUID } from 'node:crypto';
import { basicCtx } from '@/engine/context';
import { isDocumentsRegister, summariseDocument, type DocumentSummary } from '@/engine/documents';
import { isoDateInZone } from '@/engine/fields/helpers';
import { fieldType } from '@/engine/fields/registry';
import { resolveFieldType } from '@/engine/fields/resolve';
import type { LinkConfig } from '@/engine/fields/link';
import { fieldKeyFromName, keyBetween } from '@/engine/ordering';
import type { Field, Sheet } from '@/engine/types';
import type { Json } from '@/lib/database.types';
import {
  addDocumentsFieldInput,
  itemDocumentsInput,
  searchDocumentsInput,
  setRegisterInput,
} from '@/lib/schemas/panel';
import { fetchDirectory, fetchItemsById, type Db } from '@/lib/sheet-query';
import {
  FIELD_COLUMNS,
  ITEM_COLUMNS,
  SHEET_COLUMNS,
  toField,
  toFileVersion,
  toItem,
  toSheet,
} from '@/lib/sheet-rows';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { newId } from '@/server/sheet-context';
import { withOrg } from './context';

// Controlled documents linked from items (docs/02 §14, docs/05 §3.4 Files tab): items link to documents through
// ordinary link fields that point at a documents register. These reads run under the person's RLS; linking itself is
// the ordinary setLinks command. The register flag is changed by owners and admins only (also enforced in SQL).

export interface RegisterRef {
  id: string;
  name: string;
}

export interface LinkedDocuments {
  /** Link fields of the item's sheet that point at a documents register. */
  fields: { id: string; name: string; targetSheetId: string; multiple: boolean }[];
  /** Linked documents, per link field, in link order. */
  documents: (DocumentSummary & { fieldId: string })[];
  /** Every documents register of the workspace (for "Link a document" and creating the field). */
  registers: RegisterRef[];
}

const isLinkField = (f: Field) =>
  resolveFieldType(f.type)?.storage === 'links' &&
  !!(f.config as Partial<LinkConfig>)?.targetSheetId;

async function registers(db: Db, orgId: string): Promise<Sheet[]> {
  const { data, error } = await db
    .from('sheets')
    .select(SHEET_COLUMNS)
    .eq('org_id', orgId)
    .is('archived_at', null)
    .eq('settings->>register', 'documents')
    .order('position');
  if (error) throw new Error(error.message);
  return (data ?? []).map(toSheet);
}

/** Summaries of documents (items of registers), with their files and the people for owner names. */
async function summarise(
  db: Db,
  orgId: string,
  items: ReturnType<typeof toItem>[],
): Promise<Map<string, DocumentSummary>> {
  if (items.length === 0) return new Map();
  const sheetIds = [...new Set(items.map((i) => i.sheetId))];
  const [fieldRows, fileRows, directory, org] = await Promise.all([
    db.from('fields').select(FIELD_COLUMNS).in('sheet_id', sheetIds).is('archived_at', null),
    db
      .from('files')
      .select('*')
      .in(
        'item_id',
        items.map((i) => i.id),
      )
      .is('field_id', null)
      .is('archived_at', null),
    fetchDirectory(db, orgId),
    db.from('orgs').select('time_zone').eq('id', orgId).maybeSingle(),
  ]);
  const fields = (fieldRows.data ?? []).map(toField);
  const files = (fileRows.data ?? []).map(toFileVersion);
  const tz = org.data?.time_zone ?? 'Europe/London';
  const now = new Date();
  const out = new Map<string, DocumentSummary>();
  for (const item of items) {
    const sheetFields = fields.filter((f) => f.sheetId === item.sheetId);
    const ctx = basicCtx({
      today: isoDateInZone(now, tz),
      now,
      timeZone: tz,
      userId: '',
      sheet: { id: item.sheetId, orgId, name: '', itemLabel: '', idPrefix: '', isLibrary: false },
      people: directory.people,
      newId,
    });
    out.set(item.id, summariseDocument(item, sheetFields, files, ctx));
  }
  return out;
}

/** The documents an item links to, through link fields that point at a documents register. */
export async function itemDocuments(input: unknown): Promise<Result<LinkedDocuments>> {
  const p = itemDocumentsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId }) => {
      const { data: item } = await supabase
        .from('items')
        .select('id, org_id, sheet_id')
        .eq('id', v.itemId)
        .maybeSingle();
      if (!item || item.org_id !== orgId) return fail('not_found', 'This item no longer exists.');
      const [fieldRows, regs] = await Promise.all([
        supabase
          .from('fields')
          .select(FIELD_COLUMNS)
          .eq('sheet_id', item.sheet_id)
          .is('archived_at', null)
          .order('position'),
        registers(supabase, orgId),
      ]);
      const regIds = new Set(regs.filter(isDocumentsRegister).map((s) => s.id));
      const docFields = (fieldRows.data ?? [])
        .map(toField)
        .filter((f) => isLinkField(f) && regIds.has((f.config as LinkConfig).targetSheetId ?? ''));
      const links = docFields.length
        ? ((
            await supabase
              .from('item_links')
              .select('field_id, to_item, position')
              .eq('from_item', item.id)
              .in(
                'field_id',
                docFields.map((f) => f.id),
              )
              .order('position')
          ).data ?? [])
        : [];
      const docs = (
        await fetchItemsById(
          supabase,
          links.map((l) => l.to_item),
        )
      ).filter((d) => !d.archivedAt);
      const summaries = await summarise(supabase, orgId, docs);
      return ok({
        fields: docFields.map((f) => ({
          id: f.id,
          name: f.name,
          targetSheetId: (f.config as LinkConfig).targetSheetId,
          multiple: (f.config as LinkConfig).multiple !== false,
        })),
        documents: links.flatMap((l) => {
          const s = summaries.get(l.to_item);
          return s ? [{ ...s, fieldId: l.field_id }] : [];
        }),
        registers: regs.map((s) => ({ id: s.id, name: s.name })),
      });
    },
    'itemDocuments',
  );
}

export type FoundDocument = DocumentSummary & { sheetName: string };

/** "Link a document": documents across the workspace's registers whose name or ID contains the query. */
export async function searchDocuments(
  input: unknown,
): Promise<Result<{ documents: FoundDocument[] }>> {
  const p = searchDocumentsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId }) => {
      const regs = await registers(supabase, orgId);
      if (regs.length === 0) return ok({ documents: [] });
      let q = supabase
        .from('items')
        .select(ITEM_COLUMNS)
        .in(
          'sheet_id',
          regs.map((s) => s.id),
        )
        .is('archived_at', null)
        .is('parent_id', null)
        .order('seq')
        .limit(30);
      // PostgREST filter syntax: strip the characters that would break or widen the or() expression
      const s = v.query
        .trim()
        .replace(/[%,()*\\:."]/g, ' ')
        .trim();
      if (s) q = q.or(`name.ilike.%${s}%,display_id.ilike.%${s}%`);
      const { data, error } = await q;
      if (error) return fromDbError(error);
      const items = (data ?? []).map(toItem);
      const summaries = await summarise(supabase, orgId, items);
      const names = new Map(regs.map((r) => [r.id, r.name]));
      return ok({
        documents: items.flatMap((i) => {
          const sum = summaries.get(i.id);
          return sum ? [{ ...sum, sheetName: names.get(i.sheetId) ?? '' }] : [];
        }),
      });
    },
    'searchDocuments',
  );
}

/** A "Documents" link field on the item's sheet that points at a documents register (editors). */
export async function addDocumentsField(input: unknown): Promise<Result<{ field: Field }>> {
  const p = addDocumentsFieldInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId }) => {
      const [sheet, regs, all] = await Promise.all([
        supabase.from('sheets').select('id, org_id').eq('id', v.sheetId).maybeSingle(),
        registers(supabase, orgId),
        supabase
          .from('fields')
          .select('key, name, position, archived_at')
          .eq('sheet_id', v.sheetId),
      ]);
      if (!sheet.data || sheet.data.org_id !== orgId)
        return fail('not_found', 'This sheet no longer exists.');
      if (!regs.some((r) => r.id === v.targetSheetId))
        return fail('invalid', 'Choose a documents register of this workspace.');
      const rows = all.data ?? [];
      const live = rows
        .filter((f) => !f.archived_at)
        .sort((a, b) => (a.position < b.position ? -1 : 1));
      const taken = new Set(live.map((f) => f.name.toLowerCase()));
      let name = 'Documents';
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `Documents ${n}`;
      const def = fieldType('link')!;
      const { data, error } = await supabase
        .from('fields')
        .insert({
          id: randomUUID(),
          org_id: orgId,
          sheet_id: v.sheetId,
          key: fieldKeyFromName(
            name,
            rows.map((f) => f.key),
          ),
          name,
          type: 'link',
          position: keyBetween(live.at(-1)?.position ?? null, null),
          width: def.defaultWidth,
          config: {
            ...(def.defaultConfig() as object),
            targetSheetId: v.targetSheetId,
          } as NonNullable<Json>,
        })
        .select(FIELD_COLUMNS)
        .single();
      return error ? fromDbError(error) : ok({ field: toField(data) });
    },
    'addDocumentsField',
  );
}

/** Make a sheet a documents register, or stop it being one (owners and admins; the SQL guard checks too). */
export async function setDocumentsRegister(input: unknown): Promise<Result<{ sheetId: string }>> {
  const p = setRegisterInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { data: sheet } = await supabase
        .from('sheets')
        .select('id, org_id, settings')
        .eq('id', v.sheetId)
        .maybeSingle();
      if (!sheet || sheet.org_id !== orgId)
        return fail('not_found', 'This sheet no longer exists.');
      const settings = { ...((sheet.settings ?? {}) as Record<string, Json>) };
      if (v.documents) settings.register = 'documents';
      else delete settings.register;
      const { error } = await supabase
        .from('sheets')
        .update({ settings: settings as NonNullable<Json> })
        .eq('id', v.sheetId);
      return error ? fromDbError(error) : ok({ sheetId: v.sheetId });
    },
    'setDocumentsRegister',
  );
}
