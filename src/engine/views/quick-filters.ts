// The Table toolbar's quick filters (docs/05 §3.1): "All statuses" (the item status field) and "All owners" (the
// first people field). UI state, not saved with the view. Pure: items in, items out.
import type { LabelOption } from '../fields/types';
import { itemStatusField } from '../fields/item-status';
import { ownerField } from '../item-panel';
import type { Ctx, Field, Item } from '../types';
import { defOf, keysOf } from '../values';

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
