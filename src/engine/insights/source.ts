// What the Insights widgets read, and the helpers they share: which fields can group, sum or date a widget (from the
// field registry's value kinds, never a type id), which items a widget counts, and its figure. Pure.
import { itemStatusField } from '../fields/item-status';
import { addDays } from '../fields/helpers';
import type { LabelOption } from '../fields/types';
import { ownerField } from '../item-panel';
import { dueField } from '../my-work';
import type { Ctx, Field, Item, LabelColor, Sheet } from '../types';
import { dateOf, defOf, isItemDone, keysOf, kindOf, numberOf } from '../values';
import {
  filterLabel,
  SOON_DAYS,
  type Aggregation,
  type InsightFilter,
  type InsightWidget,
} from './config';

/** One sheet as widgets read it. */
export interface InsightSource {
  sheet: Sheet;
  /** Fields in sheet order. */
  fields: Field[];
  /** The items widgets count: for the view's own sheet, the view's items (search, filters, group). */
  items: Item[];
  /** Every non-archived item of the sheet (the "of 12 items" base). */
  allItems: Item[];
  ctx: Ctx;
  /** The sheet the view belongs to: bars filter its Table, list rows open its item panel. */
  current: boolean;
}

/** Everything a widget may read: the view's own sheet and the other sheets its widgets name. */
export interface InsightsData {
  current: InsightSource;
  /** Another sheet by id: 'loading' while it loads, null when it no longer exists or cannot be read. */
  sheet(id: string): InsightSource | 'loading' | null;
}

const byPosition = (a: Field, b: Field) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
export const sortedFields = (fields: readonly Field[]) => [...fields].sort(byPosition);

const GROUP_KINDS = new Set(['option', 'ordered', 'multi', 'people', 'boolean']);
const DATE_KINDS = new Set(['date', 'daterange']);
const HIDDEN_KINDS = new Set(['none', 'file', 'signature']);

/** Fields bars and donuts can group by: options, people and checkboxes. */
export const groupFields = (s: Pick<InsightSource, 'fields' | 'ctx'>) =>
  sortedFields(s.fields).filter((f) => GROUP_KINDS.has(kindOf(f, s.ctx)));
/** Fields that can be summed or averaged. */
export const numberFields = (s: Pick<InsightSource, 'fields' | 'ctx'>) =>
  sortedFields(s.fields).filter((f) => kindOf(f, s.ctx) === 'number');
/** Fields with a date (timelines by their end). */
export const dateFields = (s: Pick<InsightSource, 'fields' | 'ctx'>) =>
  sortedFields(s.fields).filter((f) => DATE_KINDS.has(kindOf(f, s.ctx)));
/** Fields an item list can show after the name. */
export const listFields = (s: Pick<InsightSource, 'fields' | 'ctx'>) =>
  sortedFields(s.fields).filter((f) => !HIDDEN_KINDS.has(kindOf(f, s.ctx)));

const byKey = (fields: Field[], k: string | undefined) =>
  k ? fields.find((f) => f.key === k) : undefined;

/** The sheet's own deadline (the date My work uses), else its first date field. */
export function defaultDateField(s: Pick<InsightSource, 'fields' | 'ctx' | 'sheet'>): Field | null {
  const due = dueField(s.ctx, s.sheet.id);
  if (due && s.fields.some((f) => f.id === due.id)) return due;
  return dateFields(s)[0] ?? null;
}

/** The widget's date field: the one it names (if it still is a date field), else the default. */
export const widgetDateField = (w: InsightWidget, s: InsightSource): Field | null =>
  byKey(dateFields(s), w.date) ?? defaultDateField(s);

/** The widget's group-by field: the one it names, else the item status field, else the first groupable field. */
export function widgetGroupField(w: InsightWidget, s: InsightSource): Field | null {
  const groupable = groupFields(s);
  const named = byKey(groupable, w.by);
  if (named) return named;
  const status = itemStatusField(s.ctx, s.fields);
  return (status && groupable.find((f) => f.id === status.id)) ?? groupable[0] ?? null;
}

/** The number field of a sum or average, or null for a count. */
export function widgetNumberField(w: InsightWidget, s: InsightSource): Field | null {
  if (!w.agg || w.agg === 'count') return null;
  const nums = numberFields(s);
  return byKey(nums, w.num) ?? nums[0] ?? null;
}

/** The sheet's item status field (decides done), if it has one. */
export const statusField = (s: InsightSource): Field | null => itemStatusField(s.ctx, s.fields);
/** The sheet's first people field (the owner). */
export const personField = (s: InsightSource): Field | null =>
  s.fields.some((f) => kindOf(f, s.ctx) === 'people') ? ownerField(s.ctx) : null;

export const isDone = (item: Item, s: InsightSource) => isItemDone(item, s.ctx);

/** Items the widget counts: its sheet's items narrowed by its filter. Dated filters without a date field match none. */
export function widgetItems(w: InsightWidget, s: InsightSource): Item[] {
  const f: InsightFilter = w.filter ?? 'all';
  if (f === 'all') return s.items;
  if (f === 'open') return s.items.filter((it) => !isDone(it, s));
  if (f === 'done') return s.items.filter((it) => isDone(it, s));
  const field = widgetDateField(w, s);
  if (!field) return [];
  const today = s.ctx.today;
  const until = addDays(today, SOON_DAYS);
  return s.items.filter((it) => {
    const d = dateOf(it, field, s.ctx);
    if (!d || isDone(it, s)) return false;
    return f === 'overdue' ? d < today : d >= today && d <= until;
  });
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

/** The figure of a set of items: their count, or the sum or average of the widget's number field. */
export function aggregate(
  items: Item[],
  numField: Field | null,
  agg: Aggregation | undefined,
  ctx: Ctx,
) {
  if (!numField || !agg || agg === 'count') return items.length;
  const values = items
    .map((it) => numberOf(it, numField, ctx))
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  if (!values.length) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return round1(agg === 'avg' ? sum / values.length : sum);
}

/** A number as widgets show it: whole numbers plain, others with one decimal, thousands separated. */
export const formatFigure = (n: number) =>
  n.toLocaleString('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 0 });

/** One entry of a breakdown: a value of the group-by field and its figure. */
export interface Slice {
  /** The stored key (option id, user id, "true"/"false"); what a Table filter matches. */
  key: string;
  label: string;
  value: number;
  /** Items counted (equals value for a count). */
  count: number;
  /** An option's colour; null = a monochrome step (the UI picks the grey by `shade`). */
  color: LabelColor | null;
  /** 0 (darkest) … 4 (lightest), for slices without an option colour. */
  shade: number;
  /** Marks of the option ("!" for action needed, a check for done), so colour is never the only signal. */
  option?: LabelOption;
}

const SHADES = 5;

/** The keys an item contributes to a breakdown. Checkboxes count unticked when empty. */
function sliceKeys(item: Item, field: Field, ctx: Ctx): string[] {
  const keys = keysOf(item, field, ctx);
  if (!keys.length && kindOf(field, ctx) === 'boolean') return ['false'];
  return keys;
}

function sliceLabel(
  key: string,
  field: Field,
  ctx: Ctx,
  options: Map<string, LabelOption>,
): string {
  const o = options.get(key);
  if (o) return o.label;
  const kind = kindOf(field, ctx);
  if (kind === 'people') return ctx.people.get(key)?.name ?? 'Former member';
  if (kind === 'boolean') return key === 'true' ? 'Ticked' : 'Not ticked';
  return key;
}

/**
 * Items of `items` per value of `field`, with the widget's figure. Option fields keep their options' order (options
 * nobody holds included, so the scale stays put); other fields go largest first, ties in the order they first
 * appear. At most `top` slices.
 */
export function breakdown(
  items: Item[],
  field: Field,
  numField: Field | null,
  agg: Aggregation | undefined,
  ctx: Ctx,
  top: number,
): Slice[] {
  const opts = defOf(field).options?.(field.config, ctx) ?? [];
  const options = new Map(opts.map((o) => [o.id, o]));
  const buckets = new Map<string, Item[]>();
  for (const o of opts) buckets.set(o.id, []);
  for (const it of items)
    for (const k of sliceKeys(it, field, ctx)) {
      const list = buckets.get(k) ?? [];
      list.push(it);
      buckets.set(k, list);
    }
  const slices = [...buckets.entries()].map(([k, list]) => ({
    key: k,
    label: sliceLabel(k, field, ctx, options),
    value: aggregate(list, numField, agg, ctx),
    count: list.length,
    option: options.get(k),
  }));
  // largest first; ties keep the order the values first appear in (the items' order)
  if (!opts.length) slices.sort((a, b) => b.value - a.value);
  return slices.slice(0, Math.max(1, top)).map((s, i) => ({
    key: s.key,
    label: s.label,
    value: s.value,
    count: s.count,
    color: (s.option?.color as LabelColor | undefined) ?? null,
    shade: Math.min(i, SHADES - 1),
    ...(s.option ? { option: s.option } : {}),
  }));
}

/** "This sheet · Open items" or the other sheet's name, the line under a widget's title. */
export function sourceLine(w: InsightWidget, s: InsightSource | undefined, showFilter: boolean) {
  const f = showFilter && w.filter && w.filter !== 'all' ? ` · ${filterLabel(w.filter)}` : '';
  if (!s) return `Another sheet${f}`;
  return `${s.current ? 'This sheet' : s.sheet.name}${f}`;
}
