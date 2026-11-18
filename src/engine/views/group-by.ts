// "Group by" in the Table (docs/05 §3.1): the sheet's own groups, or virtual groups made from a label or people
// field (one per option or person in option order, then "No <field>"). Pure: fields and items in, groups and a lookup out.
import { itemStatusField } from '../fields/item-status';
import { resolveFieldType } from '../fields/resolve';
import type { Ctx, Field, Group, Item, LabelColor } from '../types';
import { isItemDone, keysOf, kindOf } from '../values';

export const GROUP_BY_NONE = 'v:none';
const PERSON_COLORS: LabelColor[] = ['blue', 'teal', 'purple', 'pink', 'orange', 'navy', 'green'];

const byPosition = (a: Field, b: Field) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

/** Fields a Table can group by: people fields and label fields (status, dropdown, …), in field order. */
export function groupableFields(ctx: Ctx): Field[] {
  return [...ctx.fieldsByKey.values()]
    .sort(byPosition)
    .filter(
      (f) =>
        resolveFieldType(f.type)?.storage === 'values' &&
        (kindOf(f, ctx) === 'people' || !!resolveFieldType(f.type)?.options),
    );
}

export interface VirtualGroups {
  groups: Group[];
  /** The id of the virtual group an item sits in. */
  groupOf(item: Item): string;
}

/** Virtual groups of `items` by `field`: the field's options (or the people present) that hold items, then "No <field>". */
export function virtualGroups(
  field: Field,
  items: Item[],
  ctx: Ctx,
  sheetId: string,
): VirtualGroups {
  const keyOf = (item: Item) => keysOf(item, field, ctx)[0] ?? null;
  const used = new Set<string>();
  for (const it of items) {
    const k = keyOf(it);
    if (k) used.add(k);
  }
  const people = kindOf(field, ctx) === 'people';
  const entries: { id: string; name: string; color: LabelColor }[] = people
    ? [...used]
        .map((id) => ({ id, name: ctx.people.get(id)?.name ?? 'Former member' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'en-GB'))
        .map((e, i) => ({ ...e, color: PERSON_COLORS[i % PERSON_COLORS.length]! }))
    : (resolveFieldType(field.type)?.options?.(field.config, ctx) ?? [])
        .filter((o) => used.has(o.id))
        .map((o) => ({ id: o.id, name: o.label, color: o.color as LabelColor }));
  const known = new Set(entries.map((e) => e.id));
  const groups: Group[] = entries.map((e, i) => ({
    id: `v:${e.id}`,
    sheetId,
    name: e.name,
    color: e.color,
    position: String(i).padStart(4, '0'),
  }));
  if (
    items.some((it) => {
      const k = keyOf(it);
      return !k || !known.has(k);
    })
  )
    groups.push({
      id: GROUP_BY_NONE,
      sheetId,
      name: `No ${field.name.toLowerCase()}`,
      color: 'grey',
      position: '9999',
    });
  return {
    groups,
    groupOf: (item) => {
      const k = keyOf(item);
      return k && known.has(k) ? `v:${k}` : GROUP_BY_NONE;
    },
  };
}

/** Share of `items` the engine counts as done, 0 to 100 rounded; null when the sheet has no done-capable field. */
export function donePercent(items: Item[], ctx: Ctx): number | null {
  if (!itemStatusField(ctx)) return null;
  if (items.length === 0) return null;
  return Math.round((items.filter((i) => isItemDone(i, ctx)).length / items.length) * 100);
}

/**
 * The values "+ Add item" gives a new item in a virtual group (docs/18 §5): the group's option or person; nothing for
 * "No <field>" or a sheet group.
 */
export function groupValues(field: Field, groupId: string, ctx: Ctx): Record<string, unknown> {
  if (!groupId.startsWith('v:') || groupId === GROUP_BY_NONE) return {};
  const key = groupId.slice(2);
  return { [field.id]: kindOf(field, ctx) === 'people' ? [key] : key };
}
