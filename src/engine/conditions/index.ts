// Filters and automation conditions: one operator set per value kind (docs/03 §4, docs/04 §4).
import type { ValueKind } from '../fields/types';
import { addDays } from '../fields/helpers';
import type { Condition, Ctx, Field, FileRow, Item, Json } from '../types';
import {
  dateOf,
  defOf,
  isDoneOf,
  isEmptyOf,
  isItemDone,
  keysOf,
  kindOf,
  numberOf,
  textOf,
  valueOf,
} from '../values';

export { OP_LABEL } from './labels';

const EMPTY = ['is_empty', 'is_not_empty'] as const;
const OPTION = ['is_any_of', 'is_none_of', 'is_done', 'is_not_done', ...EMPTY] as const;

export const OPERATORS: Record<ValueKind, readonly string[]> = {
  text: ['is', 'is_not', 'contains', 'not_contains', 'starts_with', ...EMPTY],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', ...EMPTY],
  date: [
    'is',
    'before',
    'after',
    'on_or_before',
    'on_or_after',
    'between',
    'is_today',
    'next_days',
    'last_days',
    'overdue',
    ...EMPTY,
  ],
  daterange: [
    'is',
    'before',
    'after',
    'on_or_before',
    'on_or_after',
    'between',
    'is_today',
    'next_days',
    'last_days',
    'overdue',
    ...EMPTY,
  ],
  option: OPTION,
  ordered: [...OPTION, 'at_least', 'at_most'],
  multi: ['has_any_of', 'has_all_of', 'has_none_of', ...EMPTY],
  people: ['includes_any_of', 'includes_me', 'excludes', ...EMPTY],
  boolean: ['is_checked', 'is_not_checked'],
  link: ['has_any', 'has_none', 'includes_item', 'count_gt', 'count_lt'],
  file: ['has_files', 'has_none', 'freshness_is', 'expires_within'],
  signature: ['is_signed', 'is_not_signed', 'signed_by'],
  none: EMPTY,
};

/** Special keys usable in conditions besides field keys. */
export const SPECIAL_KEYS: Record<string, ValueKind> = {
  __name: 'text',
  __group: 'option',
  __id: 'text',
  __missing: 'boolean',
};

/** The condition key that holds when an item misses a required field ("Missing required": filters, dashboards). */
export const MISSING_KEY = '__missing';

/**
 * The required fields an item leaves empty (docs/03 §2 required): stored fields the person may see (restricted ones
 * they may not see are never counted), shown by their visibility rule. Rows added inline may miss them; the Table
 * says "Missing: owner, due date" and filters on it, and `__missing` counts them on dashboards.
 */
export function missingRequired(item: Item, fields: Field[], ctx: Ctx): Field[] {
  const out: Field[] = [];
  for (const f of fields) {
    if (!f.required || f.hidden) continue;
    const storage = defOf(f).storage;
    if (storage === 'computed' || storage === 'none') continue;
    // a visibility rule on "missing required" itself would loop: such a field counts as shown
    if (f.visibility && f.visibility.fieldKey !== MISSING_KEY && !matches(f.visibility, item, ctx))
      continue;
    if (isEmptyOf(item, f, ctx)) out.push(f);
  }
  return out;
}

type Resolved =
  | { special: '__name' | '__id' | '__group' | '__missing'; field?: undefined }
  | { special?: undefined; field: Field };

function resolve(cond: Condition, ctx: Ctx): Resolved | null {
  if (
    cond.fieldKey === '__name' ||
    cond.fieldKey === '__id' ||
    cond.fieldKey === '__group' ||
    cond.fieldKey === MISSING_KEY
  ) {
    return { special: cond.fieldKey };
  }
  const field = ctx.fieldsByKey.get(cond.fieldKey);
  return field ? { field } : null;
}

export function kindOfKey(fieldKey: string, ctx: Ctx): ValueKind | null {
  if (fieldKey in SPECIAL_KEYS) return SPECIAL_KEYS[fieldKey]!;
  const field = ctx.fieldsByKey.get(fieldKey);
  return field ? kindOf(field, ctx) : null;
}

/** Why a condition cannot run (deleted field, wrong operator), or null when it is valid. */
export function conditionProblem(cond: Condition, ctx: Ctx): string | null {
  const kind = kindOfKey(cond.fieldKey, ctx);
  if (!kind) return `Field "${cond.fieldKey}" no longer exists.`;
  if (!OPERATORS[kind].includes(cond.op)) return `"${cond.op}" cannot be used on this field.`;
  return null;
}

const str = (v: Json | undefined): string => (v === null || v === undefined ? '' : String(v));
const num = (v: Json | undefined): number | null =>
  typeof v === 'number'
    ? v
    : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))
      ? Number(v)
      : null;
const list = (v: Json | undefined): string[] =>
  Array.isArray(v) ? v.map(String) : v === null || v === undefined || v === '' ? [] : [String(v)];
const pair = (v: Json | undefined): [Json, Json] | null =>
  Array.isArray(v) && v.length === 2 ? [v[0]!, v[1]!] : null;

function textOp(op: string, actual: string, value: Json | undefined): boolean {
  const a = actual.toLowerCase();
  const b = str(value).toLowerCase();
  switch (op) {
    case 'is':
      return a === b;
    case 'is_not':
      return a !== b;
    case 'contains':
      return a.includes(b);
    case 'not_contains':
      return !a.includes(b);
    case 'starts_with':
      return a.startsWith(b);
    default:
      return false;
  }
}

function numberOp(op: string, actual: number | null, value: Json | undefined): boolean {
  if (actual === null) return op === 'neq' && num(value) !== null;
  if (op === 'between') {
    const p = pair(value);
    const lo = p ? num(p[0]) : null;
    const hi = p ? num(p[1]) : null;
    return lo !== null && hi !== null && actual >= Math.min(lo, hi) && actual <= Math.max(lo, hi);
  }
  const b = num(value);
  if (b === null) return false;
  switch (op) {
    case 'eq':
      return actual === b;
    case 'neq':
      return actual !== b;
    case 'gt':
      return actual > b;
    case 'gte':
      return actual >= b;
    case 'lt':
      return actual < b;
    case 'lte':
      return actual <= b;
    default:
      return false;
  }
}

function dateOp(
  op: string,
  actual: string | null,
  value: Json | undefined,
  item: Item,
  ctx: Ctx,
): boolean {
  if (actual === null) return false;
  const target = str(value) === 'today' ? ctx.today : str(value);
  switch (op) {
    case 'is':
      return actual === target;
    case 'before':
      return actual < target;
    case 'after':
      return actual > target;
    case 'on_or_before':
      return actual <= target;
    case 'on_or_after':
      return actual >= target;
    case 'between': {
      const p = pair(value);
      if (!p) return false;
      const [lo, hi] = [str(p[0]), str(p[1])].sort();
      return actual >= lo! && actual <= hi!;
    }
    case 'is_today':
      return actual === ctx.today;
    case 'next_days': {
      const n = num(value);
      return n !== null && actual >= ctx.today && actual <= addDays(ctx.today, n);
    }
    case 'last_days': {
      const n = num(value);
      return n !== null && actual <= ctx.today && actual >= addDays(ctx.today, -n);
    }
    case 'overdue':
      return actual < ctx.today && !isItemDone(item, ctx);
    default:
      return false;
  }
}

function freshnessOf(rows: FileRow[], today: string): 'current' | 'expiring' | 'expired' | 'none' {
  if (rows.length === 0) return 'none';
  const expiries = rows
    .map((r) => r.validUntil)
    .filter((d): d is string => !!d)
    .sort();
  const first = expiries[0];
  if (!first) return 'current';
  if (first < today) return 'expired';
  return first <= addDays(today, 30) ? 'expiring' : 'current';
}

/** Does one condition hold for an item (evaluated after the change)? Invalid conditions never match. */
export function matches(cond: Condition, item: Item, ctx: Ctx): boolean {
  const r = resolve(cond, ctx);
  if (!r) return false;
  const { op, value } = cond;

  if (r.special) {
    if (r.special === MISSING_KEY) {
      const missing = missingRequired(item, ctx.fieldsOf(item.sheetId), ctx).length > 0;
      if (op === 'is_checked') return missing;
      if (op === 'is_not_checked') return !missing;
      return false;
    }
    if (r.special === '__group') {
      if (op === 'is_any_of') return list(value).includes(item.groupId);
      if (op === 'is_none_of') return !list(value).includes(item.groupId);
      return false;
    }
    const actual = r.special === '__name' ? item.name : item.displayId;
    if (op === 'is_empty') return actual.trim() === '';
    if (op === 'is_not_empty') return actual.trim() !== '';
    return textOp(op, actual, value);
  }

  const field = r.field;
  const kind = kindOf(field, ctx);
  if (!OPERATORS[kind].includes(op)) return false;
  if (op === 'is_empty') return isEmptyOf(item, field, ctx);
  if (op === 'is_not_empty') return !isEmptyOf(item, field, ctx);

  switch (kind) {
    case 'text':
      return textOp(op, textOf(item, field, ctx), value);
    case 'number':
      return numberOp(op, numberOf(item, field, ctx), value);
    case 'date':
    case 'daterange':
      return dateOp(op, dateOf(item, field, ctx), value, item, ctx);
    case 'option':
    case 'ordered': {
      const keys = keysOf(item, field, ctx);
      if (op === 'is_any_of') return keys.some((k) => list(value).includes(k));
      if (op === 'is_none_of') return !keys.some((k) => list(value).includes(k));
      if (op === 'is_done') return isDoneOf(item, field, ctx);
      if (op === 'is_not_done') return !isDoneOf(item, field, ctx);
      const def = defOf(field);
      const mine = def.rank?.(valueOf(item, field, ctx), field.config) ?? null;
      // the condition value may be an option id, a label or a number: read it the way the field would
      const theirs =
        def.rank?.(def.normalize(value, field.config, ctx) ?? str(value), field.config) ?? null;
      if (mine === null || theirs === null) return false;
      return op === 'at_least' ? mine >= theirs : op === 'at_most' ? mine <= theirs : false;
    }
    case 'multi': {
      const keys = keysOf(item, field, ctx);
      const want = list(value);
      if (op === 'has_any_of') return want.some((w) => keys.includes(w));
      if (op === 'has_all_of') return want.length > 0 && want.every((w) => keys.includes(w));
      if (op === 'has_none_of') return !want.some((w) => keys.includes(w));
      return false;
    }
    case 'people': {
      const ids = keysOf(item, field, ctx);
      if (op === 'includes_me') return ids.includes(ctx.userId);
      const want = list(value).map((w) => (w === 'me' ? ctx.userId : w));
      if (op === 'includes_any_of') return want.some((w) => ids.includes(w));
      if (op === 'excludes') return !want.some((w) => ids.includes(w));
      return false;
    }
    case 'boolean': {
      const checked = valueOf(item, field, ctx) === true;
      return op === 'is_checked' ? checked : !checked;
    }
    case 'link': {
      const v = valueOf(item, field, ctx);
      const ids = Array.isArray(v) ? v.map(String) : [];
      if (op === 'has_any') return ids.length > 0;
      if (op === 'has_none') return ids.length === 0;
      if (op === 'includes_item') return ids.includes(str(value));
      const n = num(value);
      if (n === null) return false;
      return op === 'count_gt' ? ids.length > n : ids.length < n;
    }
    case 'file': {
      const v = valueOf(item, field, ctx);
      const rows = Array.isArray(v) ? (v as FileRow[]) : [];
      if (op === 'has_files') return rows.length > 0;
      if (op === 'has_none') return rows.length === 0;
      if (op === 'freshness_is')
        return rows.length > 0 && freshnessOf(rows, ctx.today) === str(value);
      if (op === 'expires_within') {
        const n = num(value);
        const first = rows
          .map((r) => r.validUntil)
          .filter((d): d is string => !!d)
          .sort()[0];
        return n !== null && !!first && first >= ctx.today && first <= addDays(ctx.today, n);
      }
      return false;
    }
    case 'signature': {
      const v = valueOf(item, field, ctx) as { by?: string } | null;
      const signed = !!v && typeof v === 'object' && !!v.by;
      if (op === 'is_signed') return signed;
      if (op === 'is_not_signed') return !signed;
      if (op === 'signed_by')
        return (
          signed &&
          list(value)
            .map((w) => (w === 'me' ? ctx.userId : w))
            .includes(v!.by!)
        );
      return false;
    }
    default:
      return false;
  }
}

/** All conditions must hold (AND). An empty list matches everything. */
export function matchesAll(conds: Condition[], item: Item, ctx: Ctx): boolean {
  return conds.every((c) => matches(c, item, ctx));
}
