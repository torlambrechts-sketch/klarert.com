// What the item panel derives from an item (docs/05 §3.4, FR-28): the summary strip and the linked items in both
// directions. Pure; components only render these.
import { relativeDue } from './fields/date';
import { itemStatusField } from './fields/item-status';
import type { LinkConfig } from './fields/link';
import { resolveFieldType } from './fields/resolve';
import type { LabelOption } from './fields/types';
import {
  dateOf,
  hiddenFor,
  isDoneOf,
  keysOf,
  kindOf,
  RESTRICTED_TEXT,
  textOf,
  valueOf,
} from './values';
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

/** The sheet's owner field: its first field whose values are people (by value kind, any type). */
export function ownerField(ctx: Ctx): Field | null {
  return (
    [...ctx.fieldsByKey.values()].sort(byPosition).find((f) => kindOf(f, ctx) === 'people') ?? null
  );
}

/** The first person in an item's owner field. */
export function ownerOf(item: Item, field: Field, ctx: Ctx): string | null {
  const v = valueOf(item, field, ctx);
  return (Array.isArray(v) ? v.find((x): x is string => typeof x === 'string') : undefined) ?? null;
}

/**
 * "Notify the owner" in the row menu (docs/18 §5, owner decision 18 Nov 2026): an update on the item that
 * @mentions its owner, so the existing mention notification reaches them in the app. Null when the item has no
 * owner, the owner is unknown, or the owner is the person asking.
 */
export function notifyOwnerUpdate(item: Item, ctx: Ctx): { userId: string; body: string } | null {
  const field = ownerField(ctx);
  const userId = field ? ownerOf(item, field, ctx) : null;
  const person = userId ? ctx.people.get(userId) : undefined;
  if (!userId || !person || userId === ctx.userId) return null;
  return { userId, body: `@${person.name} please take a look at this item.` };
}

export function itemSummary(item: Item, ctx: Ctx): ItemSummary {
  const fields = [...ctx.fieldsByKey.values()].sort(byPosition);
  const status = itemStatusField(ctx);
  const done = status ? isDoneOf(item, status, ctx) : false;
  const peopleField = ownerField(ctx);
  const person: ItemSummary['person'] = peopleField
    ? { field: peopleField, userId: ownerOf(item, peopleField, ctx) }
    : null;
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

// ───────────────────────── checklist sections ─────────────────────────

/** Link fields shown as a checklist section in the panel (`config.panel: 'checklist'`, docs/03 §3.4). */
export const isChecklistField = (field: Field): boolean =>
  resolveFieldType(field.type)?.storage === 'links' &&
  (field.config as Partial<LinkConfig>).panel === 'checklist';

export interface ChecklistRow {
  id: string;
  sheetId: string;
  displayId: string;
  name: string;
  /** The linked item's status option (text, colour, done), or null when it has none or it is empty. */
  status: LabelOption | null;
  /** The fields named in `panelFields`, as text ("Restricted" where hidden), and whether its date has passed. */
  cells: { key: string; name: string; text: string; expired: boolean }[];
}

/**
 * The rows of a checklist section: each linked item with its status and the fields the link field names, read
 * through the field registry. `ctx` is the linked sheet's (its items, files and links loaded).
 */
export function checklistRows(
  ids: readonly string[],
  fieldKeys: readonly string[],
  ctx: Ctx,
): ChecklistRow[] {
  const rows: ChecklistRow[] = [];
  for (const id of ids) {
    const item = ctx.item(id);
    if (!item || item.archivedAt) continue;
    const fields = ctx.fieldsOf(item.sheetId);
    const statusField = itemStatusField(ctx, fields);
    let status: LabelOption | null = null;
    if (statusField && !hiddenFor(statusField, ctx)) {
      const def = resolveFieldType(statusField.type);
      const key = keysOf(item, statusField, ctx)[0];
      status = def?.options?.(statusField.config, ctx).find((o) => o.id === key) ?? null;
    }
    const cells = fieldKeys.flatMap((k) => {
      const f = fields.find((x) => x.key === k);
      if (!f) return [];
      const hidden = hiddenFor(f, ctx);
      const date = hidden || kindOf(f, ctx) !== 'date' ? null : dateOf(item, f, ctx);
      return [
        {
          key: f.key,
          name: f.name,
          text: hidden ? RESTRICTED_TEXT : textOf(item, f, ctx),
          expired: !!date && date < ctx.today,
        },
      ];
    });
    rows.push({
      id: item.id,
      sheetId: item.sheetId,
      displayId: item.displayId,
      name: item.name,
      status,
      cells,
    });
  }
  return rows;
}
