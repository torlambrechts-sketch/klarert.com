// Group footer summaries (docs/03 §8): one default per value kind plus the options the column menu offers.
// Pure; works for any field through the kind and the type's projections.
import { addDays } from './fields/helpers';
import type { ValueKind } from './fields/types';
import type { Ctx, Field, Item } from './types';
import {
  dateOf,
  defOf,
  isEmptyOf,
  isItemDone,
  keysOf,
  kindOf,
  numberOf,
  valueOf,
  hiddenFor,
  RESTRICTED_TEXT,
} from './values';

export type SummaryFn =
  | 'sum'
  | 'average'
  | 'median'
  | 'min'
  | 'max'
  | 'count_filled'
  | 'distribution'
  | 'distinct'
  | 'range'
  | 'count_overdue'
  | 'percent_checked'
  | 'count_checked'
  | 'freshness'
  | 'count_with_files'
  | 'total_links'
  | 'items_with_links';

export const SUMMARY_LABELS: Record<SummaryFn, string> = {
  sum: 'Sum',
  average: 'Average',
  median: 'Median',
  min: 'Minimum',
  max: 'Maximum',
  count_filled: 'Count filled',
  distribution: 'Distribution',
  distinct: 'Distinct count',
  range: 'Earliest to latest',
  count_overdue: 'Count overdue',
  percent_checked: 'Percent checked',
  count_checked: 'Count checked',
  freshness: 'Freshness',
  count_with_files: 'Count with files',
  total_links: 'Total links',
  items_with_links: 'Items with links',
};

const OPTIONS: Record<ValueKind, SummaryFn[]> = {
  number: ['sum', 'average', 'median', 'min', 'max', 'count_filled'],
  option: ['distribution'],
  ordered: ['distribution'],
  multi: ['count_filled', 'distinct'],
  people: ['count_filled', 'distinct'],
  date: ['range', 'count_overdue'],
  daterange: ['range', 'count_overdue'],
  boolean: ['percent_checked', 'count_checked'],
  file: ['freshness', 'count_with_files'],
  link: ['total_links', 'items_with_links'],
  text: ['count_filled'],
  signature: ['count_filled'],
  none: ['count_filled'],
};

/** The summaries the column menu offers for a field; the first is the default unless the type says otherwise. */
export function summaryOptions(field: Field, ctx: Ctx): SummaryFn[] {
  return OPTIONS[kindOf(field, ctx)] ?? ['count_filled'];
}

export function defaultSummary(field: Field, ctx: Ctx): SummaryFn {
  const kind = kindOf(field, ctx);
  if (kind === 'number') return defOf(field).defaultSummary === 'average' ? 'average' : 'sum';
  return summaryOptions(field, ctx)[0]!;
}

/**
 * Kinds whose group summary shows by default (owner decision 18 Nov 2026, docs/18 C6: summaries on by default): a
 * status battery for option fields, Σ for numbers, the date range for dates, the people present and "n of m" for
 * evidence files.
 */
const AUTO_KINDS: ReadonlySet<ValueKind> = new Set([
  'number',
  'option',
  'ordered',
  'date',
  'daterange',
  'people',
  'file',
]);

/** The automatic summary where it differs from the kind's first option. */
const AUTO_FN: Partial<Record<ValueKind, SummaryFn>> = {
  people: 'distinct',
  file: 'count_with_files',
};

/** The summary a column shows when the view says nothing about it; null = none. */
export function autoSummary(field: Field, ctx: Ctx): SummaryFn | null {
  const kind = kindOf(field, ctx);
  if (!AUTO_KINDS.has(kind)) return null;
  return AUTO_FN[kind] ?? defaultSummary(field, ctx);
}

/**
 * The summary of each column in a view: a chosen function wins, a switched-off column has none, else the column's
 * automatic summary. Field key → function.
 */
export function columnSummaries(
  fields: Field[],
  chosen: Readonly<Record<string, SummaryFn>> | undefined,
  off: readonly string[] | undefined,
  ctx: Ctx,
): Record<string, SummaryFn> {
  const out: Record<string, SummaryFn> = {};
  const offSet = new Set(off ?? []);
  for (const f of fields) {
    const fn = chosen?.[f.key] ?? (offSet.has(f.key) ? null : autoSummary(f, ctx));
    if (fn) out[f.key] = fn;
  }
  return out;
}

/** The muted word after a summary value in the footer ("12.3 average"); empty when the text says it already. */
export const SUMMARY_CAPTION: Record<SummaryFn, string> = {
  sum: 'sum',
  average: 'average',
  median: 'median',
  min: 'minimum',
  max: 'maximum',
  count_filled: '',
  distribution: '',
  distinct: '',
  range: 'range',
  count_overdue: '',
  percent_checked: '',
  count_checked: '',
  freshness: '',
  count_with_files: 'with files',
  total_links: '',
  items_with_links: '',
};

export interface Segment {
  id: string;
  label: string;
  color: string;
  count: number;
}

export type Summary =
  | { kind: 'value'; fn: SummaryFn; value: number | null; text: string }
  /** The people present (people fields' "distinct"): shown as avatars, read as their names. */
  | { kind: 'people'; fn: SummaryFn; ids: string[]; text: string }
  | { kind: 'segments'; fn: SummaryFn; segments: Segment[]; total: number; text: string };

const fmt = (n: number, digits = 2) =>
  new Intl.NumberFormat('en-GB', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(n);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

function numberSummary(fn: SummaryFn, nums: number[]): number | null {
  if (nums.length === 0) return fn === 'sum' ? 0 : null;
  const sorted = [...nums].sort((a, b) => a - b);
  switch (fn) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'average':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'median': {
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    }
    case 'min':
      return sorted[0]!;
    case 'max':
      return sorted.at(-1)!;
    default:
      return null;
  }
}

const value = (fn: SummaryFn, v: number | null, text?: string): Summary => ({
  kind: 'value',
  fn,
  value: v,
  text: text ?? (v === null ? '' : fmt(v)),
});

const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

/** The summary of one field over the items of a group. */
export function summarise(field: Field, items: Item[], ctx: Ctx, fn?: SummaryFn): Summary {
  const use = fn && summaryOptions(field, ctx).includes(fn) ? fn : defaultSummary(field, ctx);
  // a restricted field the person may not see (docs/02 §16): no figure made from values they never received
  if (hiddenFor(field, ctx)) return { kind: 'value', fn: use, value: null, text: RESTRICTED_TEXT };
  const def = defOf(field);
  const filled = items.filter((it) => !isEmptyOf(it, field, ctx));

  switch (use) {
    case 'sum':
    case 'average':
    case 'median':
    case 'min':
    case 'max': {
      const nums = items
        .map((it) => numberOf(it, field, ctx))
        .filter((n): n is number => n !== null);
      const v = numberSummary(use, nums);
      // an average reads with one decimal ("12.3 average"), as the board design shows it
      return value(use, v, use === 'average' && v !== null ? fmt(v, 1) : undefined);
    }
    case 'count_filled':
      return value(use, filled.length, `${fmt(filled.length)} of ${fmt(items.length)} filled`);
    case 'distinct': {
      const keys = new Set(items.flatMap((it) => keysOf(it, field, ctx)));
      if (kindOf(field, ctx) === 'people')
        return {
          kind: 'people',
          fn: use,
          ids: [...keys],
          text: [...keys].map((id) => ctx.people.get(id)?.name ?? 'Former member').join(', '),
        };
      return value(use, keys.size, plural(keys.size, 'distinct', 'distinct'));
    }
    case 'distribution': {
      const options = def.options?.(field.config, ctx) ?? [];
      const counts = new Map<string, number>();
      for (const it of filled) {
        for (const k of keysOf(it, field, ctx)) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const segments: Segment[] = options
        .filter((o) => counts.has(o.id))
        .map((o) => ({ id: o.id, label: o.label, color: o.color, count: counts.get(o.id)! }));
      const empty = items.length - filled.length;
      if (empty > 0) segments.push({ id: '', label: 'Empty', color: 'empty', count: empty });
      return {
        kind: 'segments',
        fn: use,
        segments,
        total: items.length,
        text: segments.map((s) => `${s.label} ${s.count}`).join(', '),
      };
    }
    case 'range': {
      const dates = items
        .map((it) => dateOf(it, field, ctx))
        .filter((d): d is string => !!d)
        .sort();
      if (dates.length === 0) return value(use, null, '');
      const first = dates[0]!;
      const last = dates.at(-1)!;
      return value(
        use,
        dates.length,
        first === last ? shortDate(first) : `${shortDate(first)} – ${shortDate(last)}`,
      );
    }
    case 'count_overdue': {
      const n = items.filter((it) => {
        const d = dateOf(it, field, ctx);
        return !!d && d < ctx.today && !isItemDone(it, ctx);
      }).length;
      return value(use, n, `${fmt(n)} overdue`);
    }
    case 'percent_checked':
    case 'count_checked': {
      const n = items.filter((it) => valueOf(it, field, ctx) === true).length;
      if (use === 'count_checked') return value(use, n, `${fmt(n)} checked`);
      const pct = items.length ? Math.round((n / items.length) * 100) : 0;
      return value(use, pct, `${pct}% checked`);
    }
    case 'freshness': {
      const soon = addDays(ctx.today, 30);
      const counts = { current: 0, expiring: 0, expired: 0 };
      for (const it of filled) {
        const d = dateOf(it, field, ctx);
        if (d && d < ctx.today) counts.expired += 1;
        else if (d && d <= soon) counts.expiring += 1;
        else counts.current += 1;
      }
      const segments: Segment[] = [
        { id: 'current', label: 'Current', color: 'green', count: counts.current },
        { id: 'expiring', label: 'Expiring', color: 'orange', count: counts.expiring },
        { id: 'expired', label: 'Expired', color: 'red', count: counts.expired },
        { id: '', label: 'No files', color: 'empty', count: items.length - filled.length },
      ].filter((s) => s.count > 0);
      return {
        kind: 'segments',
        fn: use,
        segments,
        total: items.length,
        text: segments.map((s) => `${s.label} ${s.count}`).join(', '),
      };
    }
    case 'count_with_files':
      return value(use, filled.length, `${fmt(filled.length)} of ${fmt(items.length)}`);
    case 'total_links': {
      const n = items.reduce((a, it) => a + ctx.links(it.id, field.id).length, 0);
      return value(use, n, plural(n, 'link'));
    }
    case 'items_with_links': {
      const n = items.filter((it) => ctx.links(it.id, field.id).length > 0).length;
      return value(use, n, `${fmt(n)} with links`);
    }
  }
}
