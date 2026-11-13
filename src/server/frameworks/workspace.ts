// Adopted frameworks in a workspace (docs/12): the library sheets the person can read, their items, what links to
// them and their evidence, read with the person's client (RLS and sheet access decide what is seen). The engine
// (src/engine/frameworks) works out coverage, "Also satisfies" and suggestions from these rows.
import 'server-only';
import { requirementLabel, parseRequirementKey } from '@/engine/frameworks/refs';
import type { AdoptedRequirement } from '@/engine/frameworks/crosswalks';
import { libraryCoverage, type LinkRow, type SheetData } from '@/engine/frameworks/library';
import type { Field, Item, Sheet } from '@/engine/types';
import { fetchItems, fetchItemsById, type Db } from '@/lib/sheet-query';
import { FIELD_COLUMNS, SHEET_COLUMNS, toField, toSheet } from '@/lib/sheet-rows';

const CHUNK = 150;

async function chunks<T>(ids: string[], run: (part: string[]) => PromiseLike<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await run(ids.slice(i, i + CHUNK))));
  return out;
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export interface Library extends SheetData {
  framework: NonNullable<Sheet['framework']>;
  items: Item[];
}

/** Fields of the given sheets, live ones, in position order. */
export async function readFields(db: Db, sheetIds: string[]): Promise<Field[]> {
  if (sheetIds.length === 0) return [];
  const rows = await chunks(sheetIds, async (part) =>
    must(
      await db
        .from('fields')
        .select(FIELD_COLUMNS)
        .in('sheet_id', part)
        .is('archived_at', null)
        .order('position'),
      'fields',
    ),
  );
  return rows.map(toField);
}

/** The library sheets of adopted frameworks the person can read (not archived), with fields; items optional. */
export async function readLibraries(
  db: Db,
  orgId: string,
  opts: { items?: boolean } = {},
): Promise<Library[]> {
  const sheets = must(
    await db
      .from('sheets')
      .select(SHEET_COLUMNS)
      .eq('org_id', orgId)
      .eq('is_library', true)
      .is('archived_at', null)
      .is('parent_sheet_id', null)
      .order('position'),
    'library sheets',
  )
    .map(toSheet)
    .filter((s) => s.framework);
  const fields = await readFields(
    db,
    sheets.map((s) => s.id),
  );
  return Promise.all(
    sheets.map(async (sheet) => ({
      sheet,
      framework: sheet.framework!,
      fields: fields.filter((f) => f.sheetId === sheet.id),
      items: opts.items ? await fetchItems(db, sheet.id) : [],
    })),
  );
}

/** Every adopted requirement as a library item, by requirement key ("Also satisfies", suggestions, chips). */
export function adoptedRequirements(
  libraries: Library[],
  shortTitles: ReadonlyMap<string, string>,
  order: readonly string[],
): Map<string, AdoptedRequirement> {
  const out = new Map<string, AdoptedRequirement>();
  for (const lib of libraries) {
    const fw = `${lib.framework.key}@${lib.framework.version}`;
    const rank = order.indexOf(fw);
    lib.items.forEach((it, i) => {
      const id = it.requirementRef ? parseRequirementKey(it.requirementRef) : null;
      if (!id) return;
      out.set(it.requirementRef!, {
        key: it.requirementRef!,
        itemId: it.id,
        sheetId: it.sheetId,
        displayId: it.displayId,
        name: it.name,
        label: requirementLabel(shortTitles.get(fw) ?? id.framework, id.ref),
        order: (rank < 0 ? order.length : rank) * 10_000 + i,
      });
    });
  }
  return out;
}

/** Links touching the given items (either end), and the items and sheets on their other ends. */
export async function linksAround(
  db: Db,
  itemIds: string[],
): Promise<{ links: LinkRow[]; others: { item: Item; sheet: SheetData }[] }> {
  if (itemIds.length === 0) return { links: [], others: [] };
  const [into, out] = await Promise.all([
    chunks(itemIds, async (part) =>
      must(
        await db.from('item_links').select('field_id, from_item, to_item').in('to_item', part),
        'links',
      ),
    ),
    chunks(itemIds, async (part) =>
      must(
        await db.from('item_links').select('field_id, from_item, to_item').in('from_item', part),
        'links',
      ),
    ),
  ]);
  const seen = new Set<string>();
  const links: LinkRow[] = [];
  for (const l of [...into, ...out]) {
    const k = `${l.field_id}|${l.from_item}|${l.to_item}`;
    if (seen.has(k)) continue;
    seen.add(k);
    links.push({ fieldId: l.field_id, from: l.from_item, to: l.to_item });
  }
  const mine = new Set(itemIds);
  const otherIds = [...new Set(links.flatMap((l) => [l.from, l.to]).filter((id) => !mine.has(id)))];
  const items = (await fetchItemsById(db, otherIds)).filter((i) => !i.archivedAt);
  const sheetIds = [...new Set(items.map((i) => i.sheetId))];
  const [sheetRows, fields] = await Promise.all([
    sheetIds.length
      ? chunks(sheetIds, async (part) =>
          must(await db.from('sheets').select(SHEET_COLUMNS).in('id', part), 'sheets'),
        )
      : Promise.resolve([]),
    readFields(db, sheetIds),
  ]);
  const sheets = new Map(sheetRows.map((r) => [r.id, toSheet(r)]));
  return {
    links,
    others: items.flatMap((item) => {
      const sheet = sheets.get(item.sheetId);
      return sheet
        ? [{ item, sheet: { sheet, fields: fields.filter((f) => f.sheetId === sheet.id) } }]
        : [];
    }),
  };
}

/** Current, unexpired evidence files per item (evidence fields of the given fields only). */
export async function evidenceCounts(
  db: Db,
  fields: Field[],
  itemIds: string[],
  today: string,
): Promise<Map<string, number>> {
  const evidence = fields.filter((f) => f.type === 'evidence').map((f) => f.id);
  const out = new Map<string, number>();
  if (evidence.length === 0 || itemIds.length === 0) return out;
  const rows = await chunks(itemIds, async (part) =>
    must(
      await db
        .from('files')
        .select('item_id, valid_until')
        .in('item_id', part)
        .in('field_id', evidence)
        .is('replaced_by', null)
        .is('archived_at', null),
      'evidence',
    ),
  );
  for (const r of rows)
    if (!r.valid_until || r.valid_until >= today) out.set(r.item_id, (out.get(r.item_id) ?? 0) + 1);
  return out;
}

/** Coverage of one library: rows per requirement, the roll-up, and the covering items. */
export async function readLibraryCoverage(
  db: Db,
  lib: Library,
  env: { today: string; now: Date; timeZone: string; userId: string },
) {
  const ids = lib.items.map((i) => i.id);
  const [{ links, others }, evidence] = await Promise.all([
    linksAround(db, ids),
    evidenceCounts(db, lib.fields, ids, env.today),
  ]);
  return {
    ...libraryCoverage({ library: lib, links, others, evidence, env }),
    others,
  };
}
