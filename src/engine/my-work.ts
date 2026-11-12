// My work (docs/01 FR-37, docs/05 §4) and the rail badge: which items need the signed-in person, in which bucket.
// Pure: items come with the Ctx of their sheet (ctx.today and ctx.userId are the person's), requests are the person's
// open `request` notifications.
import { relativeDue } from './fields/date';
import { itemStatusField } from './fields/item-status';
import type { LabelOption } from './fields/types';
import { addDays } from './fields/helpers';
import { dateOf, defOf, isItemDone, keysOf, kindOf, valueOf } from './values';
import type { Ctx, Field, Item } from './types';

export const DUE_SOON_DAYS = 14;

export type Bucket = 'overdue' | 'due' | 'assigned' | 'requests';
export const BUCKETS: Bucket[] = ['overdue', 'due', 'requests', 'assigned'];

export interface WorkSource {
  item: Item;
  ctx: Ctx;
}

export interface OpenRequest {
  id: string;
  itemId: string;
  body: string;
  createdAt: string;
}

export interface WorkRow {
  itemId: string;
  sheetId: string;
  sheetName: string;
  displayId: string;
  name: string;
  /** The status option the item is in, for the pill (null when the sheet has no status or it is empty). */
  status: LabelOption | null;
  done: boolean;
  /** The item's due date: its first date field that can hold a deadline. */
  due: { fieldName: string; date: string; relative: string } | null;
  overdue: boolean;
  dueSoon: boolean;
  assigned: boolean;
  requests: OpenRequest[];
}

export interface MyWork {
  rows: WorkRow[];
  counts: Record<Bucket | 'everything', number>;
  sheets: { id: string; name: string; count: number }[];
  /** The rail badge: overdue items plus open requests to me. */
  badge: number;
}

const byPosition = (a: Field, b: Field) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

/**
 * The field that holds the item's deadline: among the fields (in sheet order) whose type can fire "a date arrives" and
 * that are not file fields (evidence expiry is not a deadline), the first one set up as a deadline (a date showing time
 * left), else the first one. Created/updated dates never are: they cannot fire it. A "Found on" record date before a
 * "Due date" is therefore not the deadline (docs/07 B7).
 */
export function dueField(ctx: Ctx, sheetId = ctx.sheet.id): Field | null {
  const dates = [...ctx.fieldsOf(sheetId)].sort(byPosition).filter((f) => {
    const def = defOf(f);
    return def.kind === 'date' && def.storage !== 'files' && def.triggers.includes('date_arrives');
  });
  return dates.find((f) => defOf(f).isDeadline?.(f.config) === true) ?? dates[0] ?? null;
}

/** The selected option of the item's status field, if any. */
export function statusOption(item: Item, ctx: Ctx): LabelOption | null {
  const field = itemStatusField(ctx, ctx.fieldsOf(item.sheetId));
  if (!field) return null;
  const key = keysOf(item, field, ctx)[0];
  if (!key) return null;
  return (
    defOf(field)
      .options?.(field.config, ctx)
      .find((o) => o.id === key) ?? null
  );
}

/** Does any people field of the item (stored or looked up) hold this person? */
export function isAssigned(item: Item, ctx: Ctx, userId: string): boolean {
  return ctx.fieldsOf(item.sheetId).some((f) => {
    if (kindOf(f, ctx) !== 'people') return false;
    const v = valueOf(item, f, ctx);
    return Array.isArray(v) && v.includes(userId);
  });
}

export function workRow(source: WorkSource, userId: string, requests: OpenRequest[]): WorkRow {
  const { item, ctx } = source;
  const done = isItemDone(item, ctx);
  const field = dueField(ctx, item.sheetId);
  const date = field ? dateOf(item, field, ctx) : null;
  const overdue = !done && !!date && date < ctx.today;
  const dueSoon = !done && !!date && date >= ctx.today && date <= addDays(ctx.today, DUE_SOON_DAYS);
  return {
    itemId: item.id,
    sheetId: item.sheetId,
    sheetName: ctx.sheetOf(item.id)?.name ?? ctx.sheet.name,
    displayId: item.displayId,
    name: item.name,
    status: statusOption(item, ctx),
    done,
    due:
      field && date
        ? { fieldName: field.name, date, relative: relativeDue(date, ctx.today) }
        : null,
    overdue,
    dueSoon,
    assigned: !done && isAssigned(item, ctx, userId),
    requests,
  };
}

export function inBucket(row: WorkRow, bucket: Bucket): boolean {
  switch (bucket) {
    case 'overdue':
      return row.overdue;
    case 'due':
      return row.dueSoon;
    case 'assigned':
      return row.assigned;
    case 'requests':
      return row.requests.length > 0;
  }
}

/** Mine: assigned to me (not done) or with an open request to me. Others' items never show. */
const isMine = (row: WorkRow) => row.assigned || row.requests.length > 0;

/** Sorted by date (soonest first, undated last), then by display id. */
export function compareRows(a: WorkRow, b: WorkRow): number {
  if (a.due && b.due && a.due.date !== b.due.date) return a.due.date < b.due.date ? -1 : 1;
  if (!!a.due !== !!b.due) return a.due ? -1 : 1;
  return a.displayId.localeCompare(b.displayId, 'en', { numeric: true });
}

/**
 * My work: one row per item that is mine, in the buckets it belongs to. Overdue and "Due in 14 days" count only my
 * items: an item becomes my work by being assigned to me or requested of me.
 */
export function buildMyWork(
  sources: WorkSource[],
  userId: string,
  requests: OpenRequest[],
): MyWork {
  const byItem = new Map<string, OpenRequest[]>();
  for (const r of requests) byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), r]);
  const seen = new Set<string>();
  const rows: WorkRow[] = [];
  for (const s of sources) {
    if (seen.has(s.item.id) || s.item.archivedAt) continue;
    seen.add(s.item.id);
    const row = workRow(s, userId, byItem.get(s.item.id) ?? []);
    if (isMine(row)) rows.push(row);
  }
  rows.sort(compareRows);
  const counts = {
    everything: rows.length,
    overdue: rows.filter((r) => r.overdue).length,
    due: rows.filter((r) => r.dueSoon).length,
    assigned: rows.filter((r) => r.assigned).length,
    requests: rows.filter((r) => r.requests.length > 0).length,
  };
  const sheets = new Map<string, { id: string; name: string; count: number }>();
  for (const r of rows) {
    const s = sheets.get(r.sheetId) ?? { id: r.sheetId, name: r.sheetName, count: 0 };
    s.count += 1;
    sheets.set(r.sheetId, s);
  }
  const openRequests = requests.filter((r) => seen.has(r.itemId)).length;
  return {
    rows,
    counts,
    sheets: [...sheets.values()].sort((a, b) => a.name.localeCompare(b.name, 'en-GB')),
    badge: counts.overdue + openRequests,
  };
}

/** Rows for a filter of the second panel (?filter=, ?sheet=). */
export function filterRows(
  work: MyWork,
  filter: { bucket?: Bucket | null; sheetId?: string | null },
): WorkRow[] {
  return work.rows.filter(
    (r) =>
      (!filter.bucket || inBucket(r, filter.bucket)) &&
      (!filter.sheetId || r.sheetId === filter.sheetId),
  );
}

export const isBucket = (v: unknown): v is Bucket =>
  typeof v === 'string' && (BUCKETS as string[]).includes(v);

export const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: 'Overdue',
  due: 'Due in 14 days',
  requests: 'Requests to me',
  assigned: 'Assigned to me',
};

/** "Everything": each row once, in the first section it belongs to (Overdue, Due in 14 days, Requests, Assigned). */
export function sections(rows: WorkRow[]): { bucket: Bucket; rows: WorkRow[] }[] {
  const out = BUCKETS.map((bucket) => ({ bucket, rows: [] as WorkRow[] }));
  for (const r of rows) {
    const s = out.find((x) => inBucket(r, x.bucket));
    if (s) s.rows.push(r);
  }
  return out.filter((s) => s.rows.length > 0);
}
