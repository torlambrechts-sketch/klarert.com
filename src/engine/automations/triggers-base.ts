// Before-states for trigger matching (docs/04 §2): an item and a Ctx as they were before a change. Pure.
import type { Ctx, Item } from '../types';

/** A Ctx that sees an item, or one item's links, as they were before a change (for computed before-values). */
export function ctxBefore(
  ctx: Ctx,
  before: Item,
  links: { fieldId: string; ids: string[] }[] = [],
): Ctx {
  const linkMap = new Map(links.map((l) => [l.fieldId, l.ids]));
  return {
    ...ctx,
    item: (id) => (id === before.id ? before : ctx.item(id)),
    links: (itemId, fieldId) =>
      itemId === before.id && linkMap.has(fieldId)
        ? linkMap.get(fieldId)!
        : ctx.links(itemId, fieldId),
  };
}

/** An item as it was before a value change: the after item with the changed fields' old values. */
export function itemBefore(after: Item, changes: { fieldId: string; before: unknown }[]): Item {
  const values = { ...after.values };
  for (const c of changes) {
    if (c.before === null || c.before === undefined) delete values[c.fieldId];
    else values[c.fieldId] = c.before as Item['values'][string];
  }
  return { ...after, values };
}
