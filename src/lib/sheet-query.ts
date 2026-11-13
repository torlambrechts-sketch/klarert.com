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
  SHEET_COLUMNS,
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
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pages = Math.max(1, Math.ceil(count / PAGE));
  const parts = await Promise.all(
    Array.from({ length: pages }, (_, i) => page(i * PAGE, i * PAGE + PAGE - 1).then(must)),
  );
  return parts.flat();
}

async function chunked<T>(ids: string[], run: (ids: string[]) => PromiseLike<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK)
    out.push(...(await run(ids.slice(i, i + ID_CHUNK))));
  return out;
}

const storageIds = (fields: Field[], storage: string) =>
  fields.filter((f) => resolveFieldType(f.type)?.storage === storage).map((f) => f.id);

/** People, teams, job roles, entities and sites of a workspace. */
export async function fetchDirectory(db: Db, orgId: string) {
  const [members, teams, teamMembers, jobRoles, entities, sites] = await Promise.all([
    db
      .from('memberships')
      .select('user_id, profiles(id, display_name, initials, color)')
      .eq('org_id', orgId),
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

/** Every live item of the given sheets in one paged read, by sheet (workspace-wide pages such as Workflow). */
export async function fetchItemsOfSheets(
  db: Db,
  orgId: string,
  sheetIds: string[],
): Promise<Map<string, Item[]>> {
  const out = new Map<string, Item[]>(sheetIds.map((id) => [id, []]));
  if (sheetIds.length === 0) return out;
  const head = await db
    .from('items')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .is('archived_at', null);
  if (head.error) throw new Error(head.error.message);
  const rows = await paged(head.count ?? 0, (from, to) =>
    db
      .from('items')
      .select(ITEM_COLUMNS)
      .eq('org_id', orgId)
      .is('archived_at', null)
      .order('sheet_id')
      .order('position')
      .order('id')
      .range(from, to),
  );
  for (const it of rows.map(toItem)) out.get(it.sheetId)?.push(it);
  return out;
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
  const all = async <T>(
    make: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  ) => {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const rows = must(await make(from, from + PAGE - 1));
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  };
  const sheetIds = [...new Set(fields.map((f) => f.sheetId))];
  const [links, files, itemFiles, protectedValues] = await Promise.all([
    linkFields.length
      ? all((a, b) =>
          byItems(
            db
              .from('item_links')
              .select('id, field_id, from_item, to_item, position')
              .in('field_id', linkFields),
            'from_item',
          )
            .order('id')
            .range(a, b),
        )
      : [],
    fileFields.length
      ? all((a, b) =>
          byItems(
            db
              .from('files')
              .select('*')
              .in('field_id', fileFields)
              .is('replaced_by', null)
              .is('archived_at', null),
            'item_id',
          )
            .order('id')
            .range(a, b),
        )
      : [],
    // the items' Files tabs (field_id null): by item, or by the sheets of the fields when every item is loaded
    itemIds || sheetIds.length
      ? all((a, b) =>
          (itemIds
            ? db.from('files').select('*').in('item_id', itemIds)
            : db.from('files').select('*, items!inner(sheet_id)').in('items.sheet_id', sheetIds)
          )
            .is('field_id', null)
            .is('replaced_by', null)
            .is('archived_at', null)
            .order('id')
            .range(a, b),
        )
      : [],
    protectedFields.length
      ? all((a, b) =>
          byItems(
            db
              .from('protected_values')
              .select('item_id, field_id, value')
              .in('field_id', protectedFields),
            'item_id',
          )
            .order('item_id')
            .range(a, b),
        )
      : [],
  ]);
  return {
    links: links.map(toLink),
    files: [...files, ...itemFiles].map(toFile),
    protectedValues: protectedValues.map((p) => ({
      itemId: p.item_id,
      fieldId: p.field_id,
      value: p.value,
    })),
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
    db.from('sheets').select(SHEET_COLUMNS).in('id', sheetIds),
    db
      .from('fields')
      .select(FIELD_COLUMNS)
      .in('sheet_id', sheetIds)
      .is('archived_at', null)
      .order('position'),
  ]);
  return { sheets: must(sheets).map(toSheet), fields: must(fields).map(toField), items };
}

export async function fetchSheetMeta(db: Db, sheetId: string) {
  const [sheet, fields, groups, child] = await Promise.all([
    db.from('sheets').select(SHEET_COLUMNS).eq('id', sheetId).maybeSingle(),
    db
      .from('fields')
      .select(FIELD_COLUMNS)
      .eq('sheet_id', sheetId)
      .is('archived_at', null)
      .order('position'),
    db
      .from('groups')
      .select('id, sheet_id, name, color, position')
      .eq('sheet_id', sheetId)
      .order('position'),
    db.from('sheets').select('id').eq('parent_sheet_id', sheetId).maybeSingle(),
  ]);
  const s = must(sheet);
  if (!s) return null;
  const childId = must(child)?.id;
  return {
    sheet: { ...toSheet(s), ...(childId ? { childSheetId: childId } : {}) },
    fields: must(fields).map(toField),
    groups: must(groups).map(toGroup),
  };
}

/**
 * Sub-items around the loaded items (docs/02 §12), as `related` data plus their links and files: for a sheet with
 * sub-items, the child sheet, its fields and the live sub-items of `parentIds` (every sub-item of the sheet when
 * undefined); for a child sheet, the parent sheet, its fields and the parents of `childItems`. Empty otherwise.
 */
export async function fetchSubitemContext(
  db: Db,
  sheet: SheetData['sheet'],
  loaded: Item[],
  parentIds?: string[],
): Promise<
  Pick<SheetData, 'links' | 'files' | 'protectedValues'> & { related: SheetData['related'] }
> {
  const none = {
    links: [],
    files: [],
    protectedValues: [],
    related: { sheets: [], fields: [], items: [] },
  };
  if (sheet.childSheetId) {
    const meta = await fetchSheetMeta(db, sheet.childSheetId);
    if (!meta) return none;
    let items: Item[];
    if (parentIds === undefined) items = await fetchItems(db, meta.sheet.id);
    else
      items = (
        await chunked(parentIds, async (part) =>
          must(
            await db
              .from('items')
              .select(ITEM_COLUMNS)
              .in('parent_id', part)
              .is('archived_at', null)
              .order('position'),
          ),
        )
      ).map(toItem);
    const attached = await fetchAttached(
      db,
      meta.fields,
      items.map((i) => i.id),
    );
    return { ...attached, related: { sheets: [meta.sheet], fields: meta.fields, items } };
  }
  if (sheet.parentSheetId) {
    const ids = [...new Set(loaded.flatMap((i) => (i.parentId ? [i.parentId] : [])))];
    const [meta, parents] = await Promise.all([
      fetchSheetMeta(db, sheet.parentSheetId),
      fetchItemsById(db, ids),
    ]);
    if (!meta) return none;
    return {
      links: [],
      files: [],
      protectedValues: [],
      related: { sheets: [meta.sheet], fields: meta.fields, items: parents },
    };
  }
  return none;
}

/** Merge sub-item context into a sheet's data (related items, links and files of the sub-items). */
export function mergeSubitemContext(
  data: SheetData,
  more: Awaited<ReturnType<typeof fetchSubitemContext>>,
): SheetData {
  const have = new Set([...data.items, ...data.related.items].map((i) => i.id));
  const sheets = new Set(data.related.sheets.map((s) => s.id));
  return {
    ...data,
    links: [...data.links, ...more.links],
    files: [...data.files, ...more.files],
    protectedValues: [...data.protectedValues, ...more.protectedValues],
    related: {
      sheets: [...data.related.sheets, ...more.related.sheets.filter((s) => !sheets.has(s.id))],
      fields: [
        ...data.related.fields,
        ...more.related.fields.filter((f) => !sheets.has(f.sheetId)),
      ],
      items: [...data.related.items, ...more.related.items.filter((i) => !have.has(i.id))],
    },
  };
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
