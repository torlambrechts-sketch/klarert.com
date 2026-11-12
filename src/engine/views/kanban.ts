// Kanban view (docs/05 §3.3, FR-23): lanes per option of the lane field, cards in the lanes. Pure.
import { laneOptions } from '../fields/view-support';
import type { LabelOption } from '../fields/types';
import type { Ctx, Field, Item } from '../types';
import { keysOf } from '../values';

export interface Lane {
  /** Option id (person id for a single-person field); null = items without a value. */
  key: string | null;
  option: LabelOption | null;
  items: Item[];
}

/** Fields that can be the lane field. */
export const laneFields = (fields: Field[], ctx: Ctx) =>
  fields.filter((f) => laneOptions(f, ctx) !== null);

/** The lane field of a view: the chosen key when it still qualifies, else the first status field, else the first. */
export function laneField(fields: Field[], chosenKey: string | undefined, ctx: Ctx): Field | null {
  const usable = laneFields(fields, ctx);
  return (
    usable.find((f) => f.key === chosenKey) ??
    usable.find((f) => f.type === 'status') ??
    usable[0] ??
    null
  );
}

/**
 * Items in lanes, in the given item order. A "No value" lane is added at the end when an item has no value or a
 * value that is no longer an option.
 */
export function kanbanLanes(field: Field, items: Item[], ctx: Ctx): Lane[] {
  const options = laneOptions(field, ctx) ?? [];
  const lanes: Lane[] = options.map((o) => ({ key: o.id, option: o, items: [] }));
  const byKey = new Map(lanes.map((l) => [l.key, l]));
  const none: Lane = { key: null, option: null, items: [] };
  for (const item of items) {
    const k = keysOf(item, field, ctx)[0];
    (k !== undefined ? (byKey.get(k) ?? none) : none).items.push(item);
  }
  return none.items.length > 0 ? [...lanes, none] : lanes;
}
