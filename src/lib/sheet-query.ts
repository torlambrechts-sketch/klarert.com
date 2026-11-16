// Reads everything one sheet needs (SheetData) with any Supabase client: the browser client for the grid and
// realtime refetches, the server client for commands. Every query runs under the caller's RLS.
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveFieldType } from '@/engine/fields/resolve';
import { byPosition } from '@/engine/organise';
import '@/engine/fields/registry';
import type { SheetData } from '@/engine/sheet-data';
import type { Field, Item, Json, Person } from '@/engine/types';
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

/**
 * Every row of a list query, a page of PAGE rows at a time until a short page: for lists with no known size, such as a
 * workspace's sheets (no limit on how many a workspace holds), instead of relying on the API's row cap. The query must
 * have a stable order (end it with a unique column).
 */
export async function fetchAllPages<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = must(await page(from, from + PAGE - 1)) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function chunked<T>(ids: string[], run: (ids: string[]) => PromiseLike<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK)
    out.push(...(await run(ids.slice(i, i + ID_CHUNK))));
  return out;
}

const storageIds = (fields: Field[], storage: string) =>
  fields.filter((f) => resolveFieldType(f.type)?.storage === storage).map((f) => f.id);

/** The workspace's members as people (by name), every page: a workspace may have more than 1000 members. */
export async function fetchPeople(db: Db, orgId: string): Promise<Person[]> {
  const members = await fetchAllPages((from, to) =>
    db
      .from('memberships')
      .select('user_id, profiles(id, display_name, initials, color)')
      .eq('org_id', orgId)
      .order('user_id')
      .range(from, to),
  );
  return members
    .flatMap((m) => (m.profiles ? [m.profiles] : []))
    .map((p) => ({ id: p.id, name: p.display_name, initials: p.initials, color: p.color }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
}

/** People, teams, job roles, entities and sites of a workspace, every page of each. */
export async function fetchDirectory(db: Db, orgId: string) {
  const [people, teams, tm, jobRoles, entities, sites] = await Promise.all([
    fetchPeople(db, orgId),
    fetchAllPages((from, to) =>
      db
        .from('teams')
        .select('id, name')
        .eq('org_id', orgId)
        .order('name')
        .order('id')
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      db
        .from('team_members')
        .select('team_id, user_id')
        .eq('org_id', orgId)
        .order('team_id')
        .order('user_id')
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      db
        .from('job_roles')
        .select('id, name')
        .eq('org_id', orgId)
        .order('name')
        .order('id')
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      db
        .from('entities')
        .select('id, name, country')
        .eq('org_id', orgId)
        .order('name')
        .order('id')
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      db
        .from('sites')
        .select('id, entity_id, name')
        .eq('org_id', orgId)
        .order('name')
        .order('id')
        .range(from, to),
    ),
  ]);
  const byTeam = new Map<string, string[]>();
  for (const x of tm) byTeam.set(x.team_id, [...(byTeam.get(x.team_id) ?? []), x.user_id]);
  return {
    people,
    teams: teams.map((t) => ({ id: t.id, name: t.name, memberIds: byTeam.get(t.id) ?? [] })),
    jobRoles,
    entities: entities.map((e) => ({ id: e.id, name: e.name, country: e.country })),
    sites: sites.map((s) => ({ id: s.id, entityId: s.entity_id, name: s.name })),
  };
}

/** The workspace's live sheets (sub-item sheets too): id and name, every page. */
export async function fetchLiveSheets(
  db: Db,
  orgId: string,
): Promise<{ id: string; name: string }[]> {
  return fetchAllPages((from, to) =>
    db
      .from('sheets')
      .select('id, name')
      .eq('org_id', orgId)
      .is('archived_at', null)
      .order('id')
      .range(from, to),
  );
}

/**
 * Restricted fields (docs/02 §16): their values live in restricted_values, readable only by the people who see the
 * field (RLS). The ones the caller may read are merged into the items' values; the others never arrive.
 */
async function mergeRestricted(
  items: Item[],
  rows: { item_id: string; field_id: string; value: unknown }[],
): Promise<Item[]> {
  if (rows.length === 0) return items;
  const byItem = new Map<string, Record<string, Json>>();
  for (const r of rows) {
    const v = byItem.get(r.item_id) ?? {};
    v[r.field_id] = r.value as Json;
    byItem.set(r.item_id, v);
  }
  return items.map((it) => {
    const more = byItem.get(it.id);
    return more ? { ...it, values: { ...it.values, ...more } } : it;
  });
}

async function restrictedRows(
  db: Db,
  by: { sheetId: string } | { orgId: string },
): Promise<{ item_id: string; field_id: string; value: unknown }[]> {
  const out: { item_id: string; field_id: string; value: unknown }[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from('restricted_values').select('item_id, field_id, value');
    q = 'sheetId' in by ? q.eq('sheet_id', by.sheetId) : q.eq('org_id', by.orgId);
    const rows = must(
      await q
        .order('item_id')
        .order('field_id')
        .range(from, from + PAGE - 1),
    );
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Link target sheets of these fields that the caller cannot read (lookups through them say "Restricted"). */
export async function fetchNoAccess(db: Db, fields: Field[]): Promise<string[]> {
  const targets = [
    ...new Set(
      fields.flatMap((f) => {
        const t = (f.config as { targetSheetId?: unknown } | null)?.targetSheetId;
        return resolveFieldType(f.type)?.storage === 'links' && typeof t === 'string' && t
          ? [t]
          : [];
      }),
    ),
  ];
  if (targets.length === 0) return [];
  const { data, error } = await db.rpc('sheet_levels', { p_sheets: targets });
  if (error) return [];
  return (data ?? []).filter((r) => r.level === 'none').map((r) => r.sheet_id);
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
  const items = await mergeRestricted(rows.map(toItem), await restrictedRows(db, { sheetId }));
  // the database orders text by its locale (aV next to av); fractional keys compare by code unit
  return items.sort(byPosition);
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
  const items = await mergeRestricted(rows.map(toItem), await restrictedRows(db, { orgId }));
  for (const it of items) out.get(it.sheetId)?.push(it);
  // the database orders text by its locale (aV next to av); fractional keys compare by code unit
  for (const list of out.values()) list.sort(byPosition);
  return out;
}

export async function fetchItemsById(db: Db, ids: string[]): Promise<Item[]> {
  return chunked(ids, async (part) => {
    const [items, restricted] = await Promise.all([
      db.from('items').select(ITEM_COLUMNS).in('id', part),
      db.from('restricted_values').select('item_id, field_id, value').in('item_id', part),
    ]);
    return mergeRestricted(must(items).map(toItem), must(restricted));
  });
}

/** One item's restricted values the caller may read, merged into an item a write just returned. */
export async function withRestrictedValues(db: Db, item: Item): Promise<Item> {
  const { data } = await db
    .from('restricted_values')
    .select('item_id, field_id, value')
    .eq('item_id', item.id);
  return (await mergeRestricted([item], data ?? []))[0]!;
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
  const [directory, items, attached, noAccessSheetIds] = await Promise.all([
    fetchDirectory(db, meta.sheet.orgId),
    fetchItems(db, sheetId),
    fetchAttached(db, meta.fields),
    fetchNoAccess(db, meta.fields),
  ]);
  const loaded = new Set(items.map((i) => i.id));
  const related = await fetchRelated(
    db,
    sheetId,
    loaded,
    attached.links.map((l) => l.toItem),
  );
  return { ...meta, ...directory, items, ...attached, related, noAccessSheetIds };
}
