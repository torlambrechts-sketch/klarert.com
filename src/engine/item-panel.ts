// What the item panel derives from an item (docs/05 §3.4, FR-28): the summary strip and the linked items in both
// directions. Pure; components only render these.
import { relativeDue } from './fields/date';
import { itemStatusField } from './fields/item-status';
import type { LinkConfig } from './fields/link';
import { resolveFieldType } from './fields/resolve';
import { dateOf, isDoneOf, kindOf, valueOf } from './values';
import type { Ctx, Field, Item } from './types';

export interface ItemSummary {
  status: Field | null;
  /** First people field and the first person in it. */
  person: { field: Field; userId: string | null } | null;
  /** First date-kind field with a date. */
  due: { field: Field; date: string; relative: string | null; overdue: boolean } | null;
  done: boolean;
}

const byPosition = (a: Field, b: Field) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

export function itemSummary(item: Item, ctx: Ctx): ItemSummary {
  const fields = [...ctx.fieldsByKey.values()].sort(byPosition);
  const status = itemStatusField(ctx);
  const done = status ? isDoneOf(item, status, ctx) : false;
  const peopleField = fields.find((f) => kindOf(f, ctx) === 'people');
  let person: ItemSummary['person'] = null;
  if (peopleField) {
    const v = valueOf(item, peopleField, ctx);
    const first = Array.isArray(v) ? v.find((x): x is string => typeof x === 'string') : undefined;
    person = { field: peopleField, userId: first ?? null };
  }
  let due: ItemSummary['due'] = null;
  for (const f of fields) {
    if (resolveFieldType(f.type)?.kind !== 'date') continue;
    const date = dateOf(item, f, ctx);
    if (!date) continue;
    const overdue = !done && date < ctx.today;
    due = { field: f, date, relative: done ? null : relativeDue(date, ctx.today), overdue };
    break;
  }
  return { status, person, due, done };
}

export interface LinkEdge {
  /** out: this item's link field points at `otherId`; in: a link field of `otherId` points at this item. */
  direction: 'out' | 'in';
  fieldId: string;
  otherId: string;
}

/**
 * Outgoing links (this item's link fields) and incoming links (other items' link fields pointing here), without the
 * mirror rows of two-way links: when field A and its inverse B connect the same two items, the outgoing edge is kept.
 */
export function linkEdges(input: {
  itemId: string;
  /** This item's link fields with their targets. */
  outgoing: { field: Field; targetIds: readonly string[] }[];
  /** item_links rows with to_item = this item. */
  incoming: readonly { fieldId: string; fromItem: string }[];
  /** Any link field by id (incoming rows belong to fields of other sheets). */
  fieldById(id: string): Field | undefined;
}): LinkEdge[] {
  const edges: LinkEdge[] = [];
  const out = new Set<string>();
  for (const o of input.outgoing)
    for (const t of o.targetIds) {
      if (t === input.itemId) continue;
      edges.push({ direction: 'out', fieldId: o.field.id, otherId: t });
      out.add(`${o.field.id}:${t}`);
    }
  const inverseOf = (f: Field | undefined) =>
    (f?.config as Partial<LinkConfig> | undefined)?.inverseFieldId ?? null;
  const seen = new Set<string>();
  for (const r of input.incoming) {
    if (r.fromItem === input.itemId) continue;
    const key = `${r.fieldId}:${r.fromItem}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const field = input.fieldById(r.fieldId);
    const inv = inverseOf(field);
    // mirror of a two-way link: the inverse field on this item already points back
    if (inv && out.has(`${inv}:${r.fromItem}`)) continue;
    if (
      input.outgoing.some(
        (o) => inverseOf(o.field) === r.fieldId && o.targetIds.includes(r.fromItem),
      )
    )
      continue;
    edges.push({ direction: 'in', fieldId: r.fieldId, otherId: r.fromItem });
  }
  return edges;
}

/** Items in panel order for J/K: the given order, skipping temporary rows. */
export function neighbours(
  order: readonly Item[],
  itemId: string,
): { prev: Item | null; next: Item | null } {
  const list = order.filter((i) => !i.id.startsWith('temp-'));
  const at = list.findIndex((i) => i.id === itemId);
  if (at < 0) return { prev: null, next: null };
  return { prev: list[at - 1] ?? null, next: list[at + 1] ?? null };
}

/** The status field of any sheet the Ctx knows (a linked item's status pill). */
export const statusFieldOf = (sheetId: string, ctx: Ctx): Field | null =>
  itemStatusField(ctx, ctx.fieldsOf(sheetId));

/** File fields whose files expire (evidence): the panel shows freshness for these. */
export const filesExpire = (field: Field): boolean =>
  resolveFieldType(field.type)?.triggers.includes('evidence_expiring') ?? false;
