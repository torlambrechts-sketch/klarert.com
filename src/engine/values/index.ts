// Field-level projections: read a field's value wherever it lives and project it (docs/02 §2, docs/03 §1).
// Everything that needs "the value of field X on item Y" goes through here, never through a type switch.
import { itemStatusField } from '../fields/item-status';
import { resolveFieldType } from '../fields/resolve';
import type { AnyFieldType, ValueKind } from '../fields/types';
import type { Ctx, Field, Item, Json } from '../types';

export function defOf(field: Field): AnyFieldType {
  const def = resolveFieldType(field.type);
  if (!def) throw new Error(`Unknown field type ${field.type}`);
  return def;
}

/** The value of a field on an item: stored values, links, files, protected values or computed. */
export function valueOf(item: Item, field: Field, ctx: Ctx): unknown {
  const def = defOf(field);
  if (def.storage === 'values') {
    const raw = item.values[field.id];
    return raw === undefined ? null : raw;
  }
  return def.compute ? (def.compute(item, field, ctx) ?? null) : null;
}

export function kindOf(field: Field, ctx: Ctx): ValueKind {
  const def = defOf(field);
  return def.effectiveKind ? def.effectiveKind(field, ctx) : def.kind;
}

export const textOf = (item: Item, field: Field, ctx: Ctx) =>
  defOf(field).toText(valueOf(item, field, ctx), field.config, ctx);
export const numberOf = (item: Item, field: Field, ctx: Ctx) =>
  defOf(field).toNumber(valueOf(item, field, ctx), field.config, ctx);
export const dateOf = (item: Item, field: Field, ctx: Ctx) =>
  defOf(field).toDate(valueOf(item, field, ctx), field.config, ctx);
export const isEmptyOf = (item: Item, field: Field, ctx: Ctx) => defOf(field).isEmpty(valueOf(item, field, ctx));
export const isDoneOf = (item: Item, field: Field, ctx: Ctx) =>
  defOf(field).isDone?.(valueOf(item, field, ctx), field.config) ?? false;

/** Option key(s) of a value for option/ordered/multi/people filters. */
export function keysOf(item: Item, field: Field, ctx: Ctx): string[] {
  const def = defOf(field);
  const v = valueOf(item, field, ctx);
  if (def.keyOf) {
    const k = def.keyOf(v, field.config);
    return k === null ? [] : [k];
  }
  if (typeof v === 'string') return v ? [v] : [];
  if (typeof v === 'boolean') return [String(v)];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

/** Sort comparator for one field, empties last. */
export function compareItems(field: Field, ctx: Ctx, direction: 'asc' | 'desc' = 'asc') {
  const def = defOf(field);
  return (a: Item, b: Item) => {
    const va = valueOf(a, field, ctx);
    const vb = valueOf(b, field, ctx);
    const ea = def.isEmpty(va);
    const eb = def.isEmpty(vb);
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // empties last in both directions
    const c = def.compare(va, vb, field.config, ctx);
    return direction === 'asc' ? c : -c;
  };
}

/** The item's done state, decided by its status field (fields/item-status.ts). Items without one are never done. */
export function isItemDone(item: Item, ctx: Ctx): boolean {
  const field = itemStatusField(ctx);
  return field ? isDoneOf(item, field, ctx) : false;
}

export type { Json };
