// Applying a view to a sheet's items (docs/01 FR-26): AND of conditions, sheet search, multi-level sort. Pure; the
// browser runs it for sheets up to 2 000 items and for calculated columns on bigger ones (docs/03 §4).
import { conditionProblem, matchesAll } from '../conditions';
import type { Condition, Ctx, Field, Item } from '../types';
import { compareItems, defOf, textOf } from '../values';
import type { SortRule } from './config';

/** Above this many items the server filters (src/server/query/filters.ts). */
export const CLIENT_FILTER_LIMIT = 2000;

const blank = (v: unknown) =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * A condition still being written in the filter builder: its operator needs a value and has none yet (an empty
 * text, an empty choice, half a range). Views skip it instead of hiding every item.
 */
export function isIncomplete(c: Condition): boolean {
  if (NO_VALUE_OPS.has(c.op)) return false;
  const v = c.value;
  if (Array.isArray(v)) return v.length === 0 || (c.op === 'between' && v.some(blank));
  return blank(v);
}

/** Operators that take no value (docs/03 §4). */
export const NO_VALUE_OPS = new Set([
  'is_empty',
  'is_not_empty',
  'is_today',
  'overdue',
  'is_done',
  'is_not_done',
  'includes_me',
  'is_checked',
  'is_not_checked',
  'has_any',
  'has_none',
  'has_files',
  'is_signed',
  'is_not_signed',
]);

/**
 * Conditions that can run, the ones that cannot (deleted field, wrong operator) with the reason, and the ones still
 * waiting for a value.
 */
export function splitConditions(conds: Condition[], ctx: Ctx) {
  const valid: Condition[] = [];
  const invalid: { cond: Condition; problem: string }[] = [];
  const incomplete: Condition[] = [];
  for (const c of conds) {
    const problem = conditionProblem(c, ctx);
    if (problem) invalid.push({ cond: c, problem });
    else if (isIncomplete(c)) incomplete.push(c);
    else valid.push(c);
  }
  return { valid, invalid, incomplete };
}

/** Sheet search: name, display id and the text of every field the person can read. */
export function matchesSearch(item: Item, query: string, fields: Field[], ctx: Ctx): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (item.name.toLowerCase().includes(q) || item.displayId.toLowerCase().includes(q)) return true;
  for (const f of fields) {
    if (defOf(f).storage === 'protected') continue;
    let text = '';
    try {
      text = textOf(item, f, ctx);
    } catch {
      text = '';
    }
    if (text.toLowerCase().includes(q)) return true;
  }
  return false;
}

const byPosition = (a: Item, b: Item) =>
  a.position < b.position
    ? -1
    : a.position > b.position
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;

/** Comparator for a multi-level sort; ties fall back to position. Unknown keys are ignored. */
export function sortComparator(sort: SortRule[], ctx: Ctx): (a: Item, b: Item) => number {
  const levels = sort.flatMap((s): ((a: Item, b: Item) => number)[] => {
    const sign = s.dir === 'asc' ? 1 : -1;
    if (s.fieldKey === '__name')
      return [(a, b) => sign * a.name.localeCompare(b.name, 'en-GB', { numeric: true })];
    if (s.fieldKey === '__id') return [(a, b) => sign * (a.seq - b.seq)];
    const field = ctx.fieldsByKey.get(s.fieldKey);
    return field ? [compareItems(field, ctx, s.dir)] : [];
  });
  return (a, b) => {
    for (const cmp of levels) {
      const c = cmp(a, b);
      if (c !== 0) return c;
    }
    return byPosition(a, b);
  };
}

export interface ApplyInput {
  items: Item[];
  fields: Field[];
  ctx: Ctx;
  conditions: Condition[];
  sort: SortRule[];
  search: string;
  /** Items the server already matched (large sheets); the conditions given here then run on top of it. */
  serverIds?: ReadonlySet<string> | null;
}

/** The items a view shows, in order. Invalid conditions are skipped (the filter bar lists them). */
export function applyView(input: ApplyInput): Item[] {
  const { valid } = splitConditions(input.conditions, input.ctx);
  const out = input.items.filter(
    (it) =>
      (!input.serverIds || input.serverIds.has(it.id)) &&
      matchesAll(valid, it, input.ctx) &&
      matchesSearch(it, input.search, input.fields, input.ctx),
  );
  return out.sort(sortComparator(input.sort, input.ctx));
}

/** Rows for a grouped list: the sheet's groups in order, each with its items in view order. Empty groups dropped. */
export function groupRows<G extends { id: string }>(groups: G[], items: Item[]) {
  const by = new Map<string, Item[]>(groups.map((g) => [g.id, []]));
  for (const it of items) by.get(it.groupId)?.push(it);
  return groups
    .map((group) => ({ group, items: by.get(group.id)! }))
    .filter((r) => r.items.length > 0);
}
