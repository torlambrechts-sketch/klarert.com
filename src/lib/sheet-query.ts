// Reads everything one sheet needs (SheetData) with any Supabase client: the browser client for the grid and
// realtime refetches, the server client for commands. Every query runs under the caller's RLS.
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveFieldType } from '@/engine/fields/resolve';
import '@/engine/fields/registry';
import type { SheetData } from '@/engine/sheet-data';
import type { Field, Item, Person } from '@/engine/types';
import type { Database } from './database.types';
import {
  FIELD_COLUMNS,
  ITEM_COLUMNS,
  toField,
  toFile,
  toGroup,
  toItem,
  toLink,
  toSheet,
} from './sheet-rows';

export type Db = SupabaseClient<Database>;

/** PostgREST returns at most 1000 rows per request (supabase/config.toml max_rows). */
const PAGE = 1000;
const ID_CHUNK = 150;

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

async function paged<T>(
  count: number,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pages = Math.max(1, Math.ceil(count / PAGE));
  const parts = await Promise.all(
    Array.from({ length: pages }, (_, i) => page(i * PAGE, i * PAGE + PAGE - 1).then(must)),
  );
  return parts.flat();
}

async function chunked<T>(ids: string[], run: (ids: string[]) => PromiseLike<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) out.push(...(await run(ids.slice(i, i + ID_CHUNK))));
  return out;
}

const storageIds = (fields: Field[], storage: string) =>
  fields.filter((f) => resolveFieldType(f.type)?.storage === storage).map((f) => f.id);

/** People, teams, job roles, entities and sites of a workspace. */
export async function fetchDirectory(db: Db, orgId: string) {
  const [members, teams, teamMembers, jobRoles, entities, sites] = await Promise.all([
    db.from('memberships').select('user_id, profiles(id, display_name, initials, color)').eq('org_id', orgId),
    db.from('teams').select('id, name').eq('org_id', orgId).order('name'),
    db.from('team_members').select('team_id, user_id').eq('org_id', orgId),
    db.from('job_roles').select('id, name').eq('org_id', orgId).order('name'),
    db.from('entities').select('id, name, country').eq('org_id', orgId).order('name'),
    db.from('sites').select('id, entity_id, name').eq('org_id', orgId).order('name'),
  ]);
  const people: Person[] = must(members)
    .flatMap((m) => (m.profiles ? [m.profiles] : []))
    .map((p) => ({ id: p.id, name: p.display_name, initials: p.initials, color: p.color }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
  const tm = must(teamMembers);
  return {
    people,
    teams: must(teams).map((t) => ({
      id: t.id,
      name: t.name,
      memberIds: tm.filter((x) => x.team_id === t.id).map((x) => x.user_id),
    })),
    jobRoles: must(jobRoles),
    entities: must(entities).map((e) => ({ id: e.id, name: e.name, country: e.country })),
    sites: must(sites).map((s) => ({ id: s.id, entityId: s.entity_id, name: s.name })),
  };
}

/** Items of a sheet (non-archived), in position order, all pages. */
export async function fetchItems(db: Db, sheetId: string): Promise<Item[]> {
  const head = await db
    .from('items')
    .select('id', { count: 'exact', head: true })
    .eq('sheet_id', sheetId)
    .is('archived_at', null);
  if (head.error) throw new Error(head.error.message);
  const rows = await paged(head.count ?? 0, (from, to) =>
    db
      .from('items')
      .select(ITEM_COLUMNS)
      .eq('sheet_id', sheetId)
      .is('archived_at', null)
      .order('position')
      .order('id')
      .range(from, to),
  );
  return rows.map(toItem);
}

export async function fetchItemsById(db: Db, ids: string[]): Promise<Item[]> {
  return chunked(ids, async (part) =>
    must(await db.from('items').select(ITEM_COLUMNS).in('id', part)).map(toItem),
  );
}

/** Links, current files and visible protected values of the given fields (optionally only some items). */
export async function fetchAttached(db: Db, fields: Field[], itemIds?: string[]) {
  const linkFields = storageIds(fields, 'links');
  const fileFields = storageIds(fields, 'files');
  const protectedFields = storageIds(fields, 'protected');
  const byItems = <Q extends { in: (c: string, v: string[]) => Q }>(q: Q, col: string) =>
    itemIds ? q.in(col, itemIds) : q;
  const all = async <T,>(
    make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  ) => {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const rows = must(await make(from, from + PAGE - 1));
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  };
  const [links, files, protectedValues] = await Promise.all([
    linkFields.length
      ? all((a, b) =>
          byItems(
            db.from('item_links').select('id, field_id, from_item, to_item, position').in('field_id', linkFields),
            'from_item',
          )
            .order('id')
            .range(a, b),
        )
      : [],
    fileFields.length
      ? all((a, b) =>
          byItems(db.from('files').select('*').in('field_id', fileFields).is('replaced_by', null), 'item_id')
            .order('id')
            .range(a, b),
        )
      : [],
    protectedFields.length
      ? all((a, b) =>
          byItems(
            db.from('protected_values').select('item_id, field_id, value').in('field_id', protectedFields),
            'item_id',
          )
            .order('item_id')
            .range(a, b),
        )
      : [],
  ]);
  return {
    links: links.map(toLink),
    files: files.map(toFile),
    protectedValues: protectedValues.map((p) => ({ itemId: p.item_id, fieldId: p.field_id, value: p.value })),
  };
}

/** Sheets, fields and items that links point to outside the loaded items. */
export async function fetchRelated(
  db: Db,
  sheetId: string,
  loaded: Set<string>,
  targetIds: string[],
): Promise<SheetData['related']> {
  const missing = [...new Set(targetIds)].filter((id) => !loaded.has(id));
  if (missing.length === 0) return { sheets: [], fields: [], items: [] };
  const items = await fetchItemsById(db, missing);
  const sheetIds = [...new Set(items.map((i) => i.sheetId))].filter((id) => id !== sheetId);
  if (sheetIds.length === 0) return { sheets: [], fields: [], items };
  const [sheets, fields] = await Promise.all([
    db.from('sheets').select('id, org_id, name, item_label, id_prefix, is_library').in('id', sheetIds),
    db.from('fields').select(FIELD_COLUMNS).in('sheet_id', sheetIds).is('archived_at', null).order('position'),
  ]);
  return { sheets: must(sheets).map(toSheet), fields: must(fields).map(toField), items };
}

export async function fetchSheetMeta(db: Db, sheetId: string) {
  const [sheet, fields, groups] = await Promise.all([
    db.from('sheets').select('id, org_id, name, item_label, id_prefix, is_library').eq('id', sheetId).maybeSingle(),
    db.from('fields').select(FIELD_COLUMNS).eq('sheet_id', sheetId).is('archived_at', null).order('position'),
    db.from('groups').select('id, sheet_id, name, color, position').eq('sheet_id', sheetId).order('position'),
  ]);
  const s = must(sheet);
  if (!s) return null;
  return { sheet: toSheet(s), fields: must(fields).map(toField), groups: must(groups).map(toGroup) };
}

/** The whole sheet for the grid. Null when the sheet does not exist or is not visible. */
export async function fetchSheetData(db: Db, sheetId: string): Promise<SheetData | null> {
  const meta = await fetchSheetMeta(db, sheetId);
  if (!meta) return null;
  const [directory, items, attached] = await Promise.all([
    fetchDirectory(db, meta.sheet.orgId),
    fetchItems(db, sheetId),
    fetchAttached(db, meta.fields),
  ]);
  const loaded = new Set(items.map((i) => i.id));
  const related = await fetchRelated(
    db,
    sheetId,
    loaded,
    attached.links.map((l) => l.toItem),
  );
  return { ...meta, ...directory, items, ...attached, related };
}
