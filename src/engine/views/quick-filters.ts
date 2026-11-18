// The Table toolbar's quick views and option filters (docs/18 §4, docs/05 §3): View ▾ and Filter ▾ (the quick views
// Main table, My items, Overdue, Due in 7 days, the alert status and Missing evidence; a column of options per option
// and people field). UI state, not saved with the view unless a saved view stores it. Pure: items in, items out.
import type { LabelOption } from '../fields/types';
import { itemStatusField } from '../fields/item-status';
import { ownerField } from '../item-panel';
import { dueField, isAssigned } from '../my-work';
import type { Ctx, Field, Item } from '../types';
import { dateOf, defOf, isEmptyOf, isItemDone, keysOf, kindOf } from '../values';

/** The field the status filter uses: the item status field (first status, else first label with a done option). */
export const statusFilterField = (ctx: Ctx): Field | null => itemStatusField(ctx);

/** The options of the status filter, in the field's order, with how many of `items` hold each. */
export function statusChoices(items: Item[], ctx: Ctx): { option: LabelOption; count: number }[] {
  const field = statusFilterField(ctx);
  if (!field) return [];
  const n = new Map<string, number>();
  for (const it of items) for (const k of keysOf(it, field, ctx)) n.set(k, (n.get(k) ?? 0) + 1);
  return (defOf(field).options?.(field.config, ctx) ?? []).map((option) => ({
    option,
    count: n.get(option.id) ?? 0,
  }));
}

/** People who own at least one item (first people field), most items first, then by name. */
export function ownersOf(items: Item[], ctx: Ctx): string[] {
  const field = ownerField(ctx);
  if (!field) return [];
  const n = new Map<string, number>();
  for (const it of items) for (const id of keysOf(it, field, ctx)) n.set(id, (n.get(id) ?? 0) + 1);
  return [...n.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        (ctx.people.get(a[0])?.name ?? '').localeCompare(ctx.people.get(b[0])?.name ?? ''),
    )
    .map(([id]) => id);
}

/** Items whose `field` holds any of `keys`; everything when no field or no key is chosen. */
export function filterByKeys(
  items: Item[],
  field: Field | null,
  keys: ReadonlySet<string>,
  ctx: Ctx,
): Item[] {
  if (!field || keys.size === 0) return items;
  return items.filter((it) => keysOf(it, field, ctx).some((k) => keys.has(k)));
}

/** Items owned by any of `people` (the first people field) and in any of `statuses` (the status filter field). */
export function quickFilter(
  items: Item[],
  people: ReadonlySet<string>,
  statuses: ReadonlySet<string>,
  ctx: Ctx,
): Item[] {
  return filterByKeys(
    filterByKeys(items, ownerField(ctx), people, ctx),
    statusFilterField(ctx),
    statuses,
    ctx,
  );
}

// ───────────────────────── quick views ─────────────────────────

/** A quick view of the Table (View ▾ and Filter ▾'s "Show"). */
export type QuickView = 'all' | 'mine' | 'overdue' | 'week' | 'alert' | 'evidence';

export const QUICK_VIEWS: readonly QuickView[] = [
  'all',
  'mine',
  'overdue',
  'week',
  'alert',
  'evidence',
];

export interface QuickViewDef {
  id: QuickView;
  label: string;
}

/** Red and orange options that are not done need action: the Table marks them with "!" (docs/05 §3.1). */
const needsAction = (o: LabelOption) => !o.done && (o.color === 'red' || o.color === 'orange');

/**
 * The sheet's alert options: every option of the item status field that needs action (the "!" options); the quick
 * view "Needs action" shows items holding any of them (owner decision 18 Nov 2026). Empty when the field has none.
 */
export function alertOptions(ctx: Ctx): LabelOption[] {
  const field = statusFilterField(ctx);
  if (!field) return [];
  return (defOf(field).options?.(field.config, ctx) ?? []).filter(needsAction);
}

/** The sheet's evidence fields (files): "Missing evidence" looks at them. */
const evidenceFields = (ctx: Ctx): Field[] =>
  [...ctx.fieldsByKey.values()].filter((f) => defOf(f).storage === 'files');

/** The quick views a sheet offers: Main table always, the others when the sheet has what they look at. */
export function quickViews(ctx: Ctx): QuickViewDef[] {
  const out: QuickViewDef[] = [{ id: 'all', label: 'Main table' }];
  if ([...ctx.fieldsByKey.values()].some((f) => kindOf(f, ctx) === 'people'))
    out.push({ id: 'mine', label: 'My items' });
  if (dueField(ctx)) {
    out.push({ id: 'overdue', label: 'Overdue' });
    out.push({ id: 'week', label: 'Due in 7 days' });
  }
  if (alertOptions(ctx).length) out.push({ id: 'alert', label: 'Needs action' });
  if (evidenceFields(ctx).length) out.push({ id: 'evidence', label: 'Missing evidence' });
  return out;
}

/** `iso` (YYYY-MM-DD) plus `days`. */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Does the item belong to the quick view? My items: a people field holds me. Overdue: the deadline (`dueField`) has
 * passed and the item is not done. Due in 7 days: the deadline is today or in the next 7 days, not done. Needs action:
 * the status holds an option that needs action. Missing evidence: every evidence field is empty.
 */
export function inQuickView(item: Item, view: QuickView, ctx: Ctx): boolean {
  switch (view) {
    case 'all':
      return true;
    case 'mine':
      return isAssigned(item, ctx, ctx.userId);
    case 'overdue':
    case 'week': {
      const field = dueField(ctx);
      const date = field ? dateOf(item, field, ctx) : null;
      if (!date || isItemDone(item, ctx)) return false;
      return view === 'overdue'
        ? date < ctx.today
        : date >= ctx.today && date <= addDays(ctx.today, 7);
    }
    case 'alert': {
      const field = statusFilterField(ctx);
      const ids = new Set(alertOptions(ctx).map((o) => o.id));
      return !!field && keysOf(item, field, ctx).some((k) => ids.has(k));
    }
    case 'evidence': {
      const fields = evidenceFields(ctx);
      return fields.length > 0 && fields.every((f) => isEmptyOf(item, f, ctx));
    }
  }
}

export const applyQuickView = (items: Item[], view: QuickView, ctx: Ctx): Item[] =>
  view === 'all' ? items : items.filter((it) => inQuickView(it, view, ctx));

/** How many of `items` each offered quick view shows. */
export function quickViewCounts(items: Item[], ctx: Ctx): Map<QuickView, number> {
  return new Map(quickViews(ctx).map((v) => [v.id, applyQuickView(items, v.id, ctx).length]));
}

/**
 * The key figures above the view tabs (docs/18 §4): Items, Open (when the sheet has a done state), Overdue, the alert
 * status and Missing evidence, each when the sheet can answer it. At most five, never buttons.
 */
export function keyFigures(
  items: Item[],
  ctx: Ctx,
): { id: string; label: string; value: number }[] {
  const out = [{ id: 'items', label: 'Items', value: items.length }];
  if (statusFilterField(ctx))
    out.push({ id: 'open', label: 'Open', value: items.filter((i) => !isItemDone(i, ctx)).length });
  const counts = quickViewCounts(items, ctx);
  for (const v of quickViews(ctx))
    if (v.id === 'overdue' || v.id === 'alert' || v.id === 'evidence')
      out.push({ id: v.id, label: v.label, value: counts.get(v.id) ?? 0 });
  return out.slice(0, 5);
}

// ───────────────────────── option filters (Filter ▾) ─────────────────────────

/** Field id → the option ids (or person ids) to keep. Any of them within a field; every field must match. */
export type ColumnFilters = Readonly<Record<string, readonly string[]>>;

export function applyColumnFilters(items: Item[], filters: ColumnFilters, ctx: Ctx): Item[] {
  let out = items;
  for (const [fieldId, keys] of Object.entries(filters)) {
    if (!keys.length) continue;
    const field = [...ctx.fieldsByKey.values()].find((f) => f.id === fieldId) ?? null;
    out = filterByKeys(out, field, new Set(keys), ctx);
  }
  return out;
}

export const columnFilterCount = (filters: ColumnFilters) =>
  Object.values(filters).reduce((n, keys) => n + keys.length, 0);

/** Toggle one key of one field's filter (a field left with no key drops out). */
export function toggleColumnFilter(
  filters: ColumnFilters,
  fieldId: string,
  key: string,
): ColumnFilters {
  const cur = filters[fieldId] ?? [];
  const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
  const { [fieldId]: _drop, ...rest } = filters;
  void _drop;
  return next.length ? { ...rest, [fieldId]: next } : rest;
}

export interface FilterChoice {
  id: string;
  label: string;
  color: string;
  count: number;
}

/** The fields Filter ▾ shows a column for: option and people fields the person may see, in field order. */
export function filterFields(ctx: Ctx): Field[] {
  return [...ctx.fieldsByKey.values()]
    .filter((f) => !f.hidden && defOf(f).storage === 'values')
    .filter((f) => kindOf(f, ctx) === 'people' || !!defOf(f).options)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
}

/** A field's choices with how many of `items` hold each: options in their order, people present, most first. */
export function filterChoices(items: Item[], field: Field, ctx: Ctx): FilterChoice[] {
  const n = new Map<string, number>();
  for (const it of items) for (const k of keysOf(it, field, ctx)) n.set(k, (n.get(k) ?? 0) + 1);
  if (kindOf(field, ctx) === 'people')
    return [...n.entries()]
      .map(([id, count]) => {
        const p = ctx.people.get(id);
        return { id, label: p?.name ?? 'Former member', color: p?.color ?? 'grey', count };
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'en-GB'));
  return (defOf(field).options?.(field.config, ctx) ?? []).map((o) => ({
    id: o.id,
    label: o.label,
    color: o.color,
    count: n.get(o.id) ?? 0,
  }));
}
