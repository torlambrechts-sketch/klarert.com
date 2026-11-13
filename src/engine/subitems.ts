// Sub-items (docs/02 §12): one level of items under an item, kept on the sheet's hidden child sheet. Pure helpers
// the field type, roll-ups, triggers, the Table and the item panel share: the child sheet and its fields, an item's
// sub-items and their progress, the settings and the template set.
import { itemStatusField } from './fields/item-status';
import type { Ctx, Field, Item, Json, Sheet, SubitemSettings } from './types';
import { isDoneOf } from './values';

export const DEFAULT_SUBITEM_LABEL = 'Sub-items';
/** Sub-items the Table loads with the sheet; above this they load per expanded parent (docs/05 §3.1). */
export const SUBITEMS_EAGER_LIMIT = 2000;
/** A template set or an automation adds at most this many sub-items at once (create_subitems in SQL). */
export const MAX_SUBITEMS_AT_ONCE = 50;
/** update_subitems changes at most this many sub-items per run. */
export const MAX_SUBITEMS_UPDATED = 100;

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

/** sheets.settings.subitems, read leniently (missing keys take the defaults). */
export function readSubitemSettings(raw: unknown): SubitemSettings {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const template = Array.isArray(o.template) ? o.template : [];
  return {
    label: str(o.label).trim().slice(0, 40) || DEFAULT_SUBITEM_LABEL,
    blockClose: o.blockClose === true,
    lockCascade: o.lockCascade === true,
    template: template.flatMap((t) => {
      const r = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
      const name = str(r.name).trim();
      const values =
        r.values && typeof r.values === 'object' && !Array.isArray(r.values)
          ? (r.values as Record<string, Json>)
          : {};
      return name ? [{ name: name.slice(0, 500), values }] : [];
    }),
  };
}

/** The sheet's sub-item label ("Sub-items", "Actions"), singular for one ("Action"). */
export function subitemLabel(sheet: Pick<Sheet, 'subitems'>, count?: number): string {
  const label = sheet.subitems?.label || DEFAULT_SUBITEM_LABEL;
  if (count !== 1) return label;
  return label.endsWith('ies') ? `${label.slice(0, -3)}y` : label.replace(/s$/, '');
}

/** The child sheet of the Ctx's sheet, if sub-items are on. */
export const childSheetIdOf = (ctx: Ctx): string | null => ctx.sheet.childSheetId ?? null;

/** Fields of the child sheet (the sub-items' columns), in position order. */
export function childFieldsOf(ctx: Ctx): Field[] {
  const id = childSheetIdOf(ctx);
  return id ? ctx.fieldsOf(id) : [];
}

/** An item's live sub-items, in position order (only those the Ctx has loaded). */
export function subitemsOf(item: Pick<Item, 'id'>, ctx: Ctx): Item[] {
  return ctx.children(item.id).flatMap((id) => {
    const it = ctx.item(id);
    return it ? [it] : [];
  });
}

/** A sub-item is done when its sheet's status field says so (fields/item-status.ts). */
export function isSubitemDone(child: Item, ctx: Ctx): boolean {
  const field = itemStatusField(ctx, ctx.fieldsOf(child.sheetId));
  return field ? isDoneOf(child, field, ctx) : false;
}

/** How many sub-items an item has and how many are done ("3/5"). */
export function subitemProgress(item: Pick<Item, 'id'>, ctx: Ctx): { total: number; done: number } {
  const list = subitemsOf(item, ctx);
  return { total: list.length, done: list.filter((c) => isSubitemDone(c, ctx)).length };
}

/** Every sub-item is done (and there is at least one). */
export function allSubitemsDone(item: Pick<Item, 'id'>, ctx: Ctx): boolean {
  const p = subitemProgress(item, ctx);
  return p.total > 0 && p.done === p.total;
}

/** The sub-items that keep the parent from closing (the gate in SQL lists the same). */
export function openSubitems(item: Pick<Item, 'id'>, ctx: Ctx): Item[] {
  return subitemsOf(item, ctx).filter((c) => !isSubitemDone(c, ctx));
}

/** "3/5" for the chip on the parent row and card. */
export const progressText = (p: { total: number; done: number }) => `${p.done}/${p.total}`;

/** The parent of a sub-item, when loaded. */
export const parentOf = (item: Item, ctx: Ctx): Item | undefined =>
  item.parentId ? ctx.item(item.parentId) : undefined;
