import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { sheetCtx, type SheetData } from '@/engine/sheet-data';
import type { Ctx, Field, Item } from '@/engine/types';
import {
  fetchAttached,
  fetchDirectory,
  fetchItemsById,
  fetchRelated,
  fetchSheetMeta,
  fetchItems,
  type Db,
} from '@/lib/sheet-query';
import { isAdminRole, type Role } from '@/server/auth';

// The Ctx a command validates against (docs/02 §4 step 2): the sheet, its fields and groups, the workspace directory,
// and the items the command touches with their links, files and protected values. Built per request.

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newId = (prefix: string) => `${prefix}${randomUUID().replace(/-/g, '').slice(0, 6)}`;

export interface WriteContext {
  data: SheetData;
  ctx: Ctx;
  fields: Field[];
  items: Map<string, Item>;
}

async function timeZoneOf(db: Db, orgId: string): Promise<string> {
  const { data } = await db.from('orgs').select('time_zone').eq('id', orgId).maybeSingle();
  return data?.time_zone ?? 'Europe/London';
}

/**
 * Load a sheet of the workspace with the given items (`'all'` for every item, as type changes need). Null when the
 * sheet is not in the workspace.
 */
export async function loadWriteContext(
  db: Db,
  who: { orgId: string; userId: string; role: Role },
  sheetId: string,
  itemIds: string[] | 'all',
): Promise<WriteContext | null> {
  const meta = await fetchSheetMeta(db, sheetId);
  if (!meta || meta.sheet.orgId !== who.orgId) return null;
  const [directory, items, timeZone] = await Promise.all([
    fetchDirectory(db, who.orgId),
    itemIds === 'all' ? fetchItems(db, sheetId) : fetchItemsById(db, itemIds),
    timeZoneOf(db, who.orgId),
  ]);
  const own = items.filter((i) => i.sheetId === sheetId);
  const attached = await fetchAttached(
    db,
    meta.fields,
    itemIds === 'all' ? undefined : own.map((i) => i.id),
  );
  const related = await fetchRelated(
    db,
    sheetId,
    new Set(own.map((i) => i.id)),
    attached.links.map((l) => l.toItem),
  );
  const data: SheetData = { ...meta, ...directory, items: own, ...attached, related };
  const ctx = sheetCtx(data, {
    now: new Date(),
    timeZone,
    userId: who.userId,
    newId,
    isAdmin: isAdminRole(who.role),
  });
  return { data, ctx, fields: meta.fields, items: new Map(own.map((i) => [i.id, i])) };
}

/** Unique check (docs/03 §1): no other non-archived item of the sheet holds the same value. */
export async function uniqueConflicts(
  db: Db,
  sheetId: string,
  itemId: string | null,
  fields: Field[],
  patch: Record<string, unknown>,
): Promise<Set<string>> {
  const conflicts = new Set<string>();
  await Promise.all(
    fields
      .filter((f) => f.validation?.unique && patch[f.id] !== null && patch[f.id] !== undefined)
      .map(async (f) => {
        let q = db
          .from('items')
          .select('id')
          .eq('sheet_id', sheetId)
          .is('archived_at', null)
          .contains('values', { [f.id]: patch[f.id] });
        if (itemId) q = q.neq('id', itemId);
        const { data } = await q.limit(1);
        if ((data ?? []).length > 0) conflicts.add(f.id);
      }),
  );
  return conflicts;
}
