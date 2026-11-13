// Column groups (sections) of a sheet (docs/02 sheets.settings.columnGroups): named runs of columns such as Identify,
// Assess, Treat. Defined per sheet by owners and admins; each view collapses groups for itself
// (viewConfig.collapsedGroups). A group's columns always sit together: the order of the groups is the order of their
// first field, and `planGroupPositions` works out the field positions that make each group's members adjacent.
// Fields in no group read as an implicit "Other". Pure: data in, data out.
import { z } from 'zod';
import { itemStatusField } from '../fields/item-status';
import { ownerField } from '../item-panel';
import { dueField } from '../my-work';
import { keysBetween } from '../ordering';
import { defOf, kindOf } from '../values';
import { trendPolarity } from '../values/trend';
import type { Ctx, Field } from '../types';

export const MAX_COLUMN_GROUPS = 30;

const fieldKey = z.string().min(1).max(64);

export const columnGroupSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'A group id is letters, digits, - and _ only.'),
  name: z
    .string()
    .trim()
    .min(1, 'A group needs a name.')
    .max(60, 'A group name can be at most 60 characters.'),
  fieldKeys: z.array(fieldKey).max(500),
});
export type ColumnGroup = z.infer<typeof columnGroupSchema>;

export const columnGroupsSchema = z
  .array(columnGroupSchema)
  .max(MAX_COLUMN_GROUPS, `A sheet can have at most ${MAX_COLUMN_GROUPS} column groups.`);

/** The implicit group of the fields in no group. Shown only when at least one group exists. */
export const OTHER_GROUP = { id: '__other', name: 'Other' } as const;

/**
 * Read stored groups leniently (a template written by hand, fields deleted since): a broken group is dropped, the rest
 * kept; with `fieldKeys`, unknown keys are dropped. A key in two groups stays in the first; a repeated id is dropped.
 */
export function parseColumnGroups(raw: unknown, fieldKeys?: Iterable<string>): ColumnGroup[] {
  if (!Array.isArray(raw)) return [];
  const known = fieldKeys ? new Set(fieldKeys) : null;
  const ids = new Set<string>();
  const taken = new Set<string>();
  const out: ColumnGroup[] = [];
  for (const entry of raw.slice(0, MAX_COLUMN_GROUPS)) {
    const r = columnGroupSchema.safeParse(entry);
    if (!r.success || ids.has(r.data.id)) continue;
    ids.add(r.data.id);
    const keys: string[] = [];
    for (const k of r.data.fieldKeys) {
      if (taken.has(k) || (known && !known.has(k))) continue;
      taken.add(k);
      keys.push(k);
    }
    out.push({ ...r.data, fieldKeys: keys });
  }
  return out;
}

/** field key → its group. */
export function groupByKey(groups: readonly ColumnGroup[]): Map<string, ColumnGroup> {
  const m = new Map<string, ColumnGroup>();
  for (const g of groups) for (const k of g.fieldKeys) if (!m.has(k)) m.set(k, g);
  return m;
}

const byPosition = (a: { position: string; id: string }, b: { position: string; id: string }) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : 1;

type Positioned = { id: string; key: string; position: string };

/**
 * The display order with every group's members together: walking the fields in position order, a group's members all
 * appear where its anchor appears. The anchor is its first member, or, with `previous`, its first member that was
 * already in it (so a field added to a group moves to the end of that group's block, not the block to the field).
 */
export function arrangeFields<T extends Positioned>(
  fields: readonly T[],
  groups: readonly ColumnGroup[],
  previous?: readonly ColumnGroup[],
): T[] {
  const sorted = [...fields].sort(byPosition);
  if (groups.length === 0) return sorted;
  const of = groupByKey(groups);
  const before = previous ? groupByKey(previous) : null;
  const isOld = (f: T, g: ColumnGroup) => !before || before.get(f.key)?.id === g.id;
  const members = new Map<string, { old: T[]; added: T[] }>();
  for (const f of sorted) {
    const g = of.get(f.key);
    if (!g) continue;
    const m = members.get(g.id) ?? { old: [], added: [] };
    (isOld(f, g) ? m.old : m.added).push(f);
    members.set(g.id, m);
  }
  const out: T[] = [];
  const emitted = new Set<string>();
  for (const f of sorted) {
    const g = of.get(f.key);
    if (!g) {
      out.push(f);
      continue;
    }
    if (emitted.has(g.id)) continue;
    const m = members.get(g.id)!;
    // the block sits at its first old member; a group with none sits at its first member
    const anchor = m.old[0] ?? m.added[0]!;
    if (anchor.id !== f.id) continue;
    emitted.add(g.id);
    out.push(...m.old, ...m.added);
  }
  return out;
}

/** Longest run of fields that can keep their positions (a longest increasing subsequence of current indexes). */
function keepers(order: number[]): Set<number> {
  const tails: number[] = [];
  const tailAt: number[] = [];
  const prev: number[] = new Array(order.length).fill(-1);
  order.forEach((v, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = v;
    tailAt[lo] = i;
    prev[i] = lo > 0 ? tailAt[lo - 1]! : -1;
  });
  const keep = new Set<number>();
  let i = tails.length ? tailAt[tails.length - 1]! : -1;
  while (i >= 0) {
    keep.add(i);
    i = prev[i]!;
  }
  return keep;
}

/**
 * The position changes that make every group's members adjacent (see `arrangeFields`): as few fields move as
 * possible, each to a fractional key between its new neighbours. Empty when the fields already sit together.
 */
export function planGroupPositions(
  fields: readonly Positioned[],
  groups: readonly ColumnGroup[],
  previous?: readonly ColumnGroup[],
): { fieldId: string; position: string }[] {
  const sorted = [...fields].sort(byPosition);
  const want = arrangeFields(sorted, groups, previous);
  const indexOf = new Map(sorted.map((f, i) => [f.id, i]));
  const keep = keepers(want.map((f) => indexOf.get(f.id)!));
  const moves: { fieldId: string; position: string }[] = [];
  let i = 0;
  while (i < want.length) {
    if (keep.has(i)) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < want.length && !keep.has(j)) j += 1;
    const lower =
      i > 0
        ? (moves.find((m) => m.fieldId === want[i - 1]!.id)?.position ?? want[i - 1]!.position)
        : null;
    const upper = j < want.length ? want[j]!.position : null;
    const keys = keysBetween(lower, upper, j - i);
    for (let k = i; k < j; k += 1) moves.push({ fieldId: want[k]!.id, position: keys[k - i]! });
    i = j;
  }
  return moves;
}

/**
 * Columns a view hides: the ones it hides itself plus every member of a group it collapsed (by field id).
 */
export function hiddenWithCollapsed(
  fields: readonly Field[],
  hidden: ReadonlySet<string>,
  groups: readonly ColumnGroup[],
  collapsed: readonly string[] | undefined,
): Set<string> {
  const out = new Set(hidden);
  if (!collapsed?.length) return out;
  const shut = new Set(collapsed);
  const keys = new Set(groups.filter((g) => shut.has(g.id)).flatMap((g) => g.fieldKeys));
  for (const f of fields) if (keys.has(f.key)) out.add(f.id);
  return out;
}

/** The collapsed group ids that still name a group of the sheet. */
export function liveCollapsed(
  groups: readonly ColumnGroup[],
  collapsed: readonly string[] | undefined,
): string[] {
  if (!collapsed?.length) return [];
  const ids = new Set(groups.map((g) => g.id));
  return collapsed.filter((id) => ids.has(id));
}

// ───────────────────────── key columns ─────────────────────────

export type KeyColumn = 'owner' | 'status' | 'date';
export const KEY_COLUMN_LABEL: Record<KeyColumn, string> = {
  owner: 'Owner',
  status: 'Status',
  date: 'Main date',
};

/**
 * The sheet's key columns, worked out from the fields (never by name): the owner (first people field), the status
 * (the field that decides done) and the main date (the deadline). field id → which one.
 */
export function keyColumns(ctx: Ctx): Map<string, KeyColumn> {
  const out = new Map<string, KeyColumn>();
  const owner = ownerField(ctx);
  const status = itemStatusField(ctx);
  const date = dueField(ctx);
  if (status) out.set(status.id, 'status');
  if (owner && !out.has(owner.id)) out.set(owner.id, 'owner');
  if (date && !out.has(date.id)) out.set(date.id, 'date');
  return out;
}

/**
 * The member a collapsed group shows in its stub: a key column first (status, then the main date, then the owner),
 * then the first option, date, score or number member, then the first member that holds values.
 */
export function stubField(members: readonly Field[], ctx: Ctx): Field | null {
  if (members.length === 0) return null;
  const keys = keyColumns(ctx);
  for (const k of ['status', 'date', 'owner'] as const) {
    const f = members.find((m) => keys.get(m.id) === k);
    if (f) return f;
  }
  const kindIs = (m: Field, kinds: string[]) => kinds.includes(kindOf(m, ctx));
  const picks: ((m: Field) => boolean)[] = [
    (m) => kindIs(m, ['option', 'ordered']),
    (m) => kindIs(m, ['date']),
    // a score (a number with a better or worse direction) before other numbers
    (m) => kindIs(m, ['number']) && trendPolarity(m) !== null,
    (m) => kindIs(m, ['number']),
  ];
  for (const pick of picks) {
    const f = members.find(pick);
    if (f) return f;
  }
  return members.find((m) => defOf(m).storage === 'values') ?? members[0]!;
}

// ───────────────────────── changes ─────────────────────────

/** "Added Assess, renamed Treat to Treatment, 2 fields moved" — said when the groups are saved. */
export function describeGroupsChange(
  before: readonly ColumnGroup[],
  after: readonly ColumnGroup[],
): string | null {
  const parts: string[] = [];
  const old = new Map(before.map((g) => [g.id, g]));
  const now = new Map(after.map((g) => [g.id, g]));
  for (const g of after) {
    const was = old.get(g.id);
    if (!was) parts.push(`added ${g.name}`);
    else if (was.name !== g.name) parts.push(`renamed ${was.name} to ${g.name}`);
  }
  for (const g of before) if (!now.has(g.id)) parts.push(`removed ${g.name}`);
  const a = groupByKey(before);
  const b = groupByKey(after);
  const keys = new Set([...a.keys(), ...b.keys()]);
  let moved = 0;
  for (const k of keys) if (a.get(k)?.id !== b.get(k)?.id) moved += 1;
  if (moved) parts.push(`${moved} ${moved === 1 ? 'field' : 'fields'} regrouped`);
  if (parts.length === 0) return null;
  const s = parts.join(', ');
  return `${s[0]!.toUpperCase()}${s.slice(1)}.`;
}
