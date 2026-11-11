// Changing a field's type (docs/03 §5). Pure: which changes are allowed in place, and what every value becomes.
// Lives in src/engine/fields because the compatibility table is keyed by type ids.
import type { Ctx, Field, Item, Json } from '../types';
import { readValue } from './link';
import { resolveFieldType } from './resolve';
import type { AnyFieldType, LabelOption } from './types';

/** Families that convert in place, both ways. */
const FAMILIES: readonly (readonly string[])[] = [
  ['text', 'longtext', 'email', 'url', 'phone', 'justification'],
  ['number', 'percent', 'rating', 'value'],
  ['status', 'dropdown', 'severity', 'classification', 'finding', 'workflowstep'],
  ['dropdown', 'multiselect'],
  ['date', 'datetime'],
  ['check', 'yesno'],
  ['link', 'requirement', 'controllink'],
];
/** One-way in-place changes. */
const ONE_WAY: readonly [string, string][] = [['date', 'timeline']];

const LABEL_TYPES = new Set(FAMILIES[2]);
const LINK_TYPES = new Set(FAMILIES[6]);
const NUMBER_TYPES = new Set(FAMILIES[1]);

export type TypeChangeMode = 'in_place' | 'copy' | 'none';

const def = (id: string): AnyFieldType | undefined => resolveFieldType(id);
const isStored = (t: AnyFieldType | undefined) => t?.storage === 'values';

/** How a field of type `from` can become `to`: in place, by creating a new field and copying, or not at all. */
export function typeChangeMode(from: string, to: string): TypeChangeMode {
  if (from === to) return 'none';
  const a = def(from);
  const b = def(to);
  if (!a || !b) return 'none';
  if (FAMILIES.some((f) => f.includes(from) && f.includes(to))) return 'in_place';
  if (ONE_WAY.some(([x, y]) => x === from && y === to)) return 'in_place';
  if (to === 'text' && isStored(a)) return 'in_place';
  return isStored(a) && isStored(b) ? 'copy' : 'none';
}

/** Types a field can change to in place, for the settings picker. */
export function inPlaceTargets(from: string, all: readonly string[]): string[] {
  return all.filter((t) => typeChangeMode(from, t) === 'in_place');
}

/** True when the target needs a library sheet (requirement, controllink). */
export const needsLibraryTarget = (to: string) => to === 'requirement' || to === 'controllink';
export const isLinkType = (t: string) => LINK_TYPES.has(t);

/** Options carried from a label field to another label field: matched by label, missing labels added. */
function carryOptions(
  fromOptions: LabelOption[],
  toDef: AnyFieldType,
  toConfig: unknown,
): LabelOption[] {
  const base = (toDef.options?.(toConfig, {} as Ctx) ?? []).map((o) => ({ ...o }));
  const out: LabelOption[] = [];
  for (const o of fromOptions) {
    const match = base.find((b) => b.label.toLowerCase() === o.label.toLowerCase());
    out.push(match ? { ...match, id: o.id } : { ...o });
  }
  return out;
}

export interface TypeChangePlan {
  to: string;
  mode: TypeChangeMode;
  config: unknown;
  /** New stored value per item id (null = becomes empty). Only items that had a value are listed. */
  values: Map<string, Json | null>;
  total: number;
  converted: number;
  emptied: number;
  /** "38 of 40 values convert, 2 become empty". */
  summary: string;
}

function targetConfig(field: Field, to: string, ctx: Ctx): unknown {
  const fromDef = def(field.type)!;
  const toDef = def(to)!;
  const fresh = toDef.defaultConfig();
  const fromOptions = fromDef.options?.(field.config, ctx);
  const carries = (LABEL_TYPES.has(field.type) || field.type === 'multiselect') && fromOptions;
  if (carries && (LABEL_TYPES.has(to) || to === 'multiselect')) {
    // finding has fixed options: its config keeps the defaults and values are matched by label
    if (to === 'finding') return fresh;
    return { ...(fresh as object), options: carryOptions(fromOptions, toDef, fresh) };
  }
  if (LINK_TYPES.has(field.type) && LINK_TYPES.has(to)) {
    return { ...(fresh as object), ...(field.config as object) };
  }
  return fresh;
}

/** The value a stored value becomes in the target type. Exported for tests. */
export function convertValue(
  value: unknown,
  field: Field,
  to: string,
  toConfig: unknown,
  ctx: Ctx,
): Json | null {
  const fromDef = def(field.type)!;
  const toDef = def(to)!;
  if (value === null || value === undefined || fromDef.isEmpty(value)) return null;
  if (NUMBER_TYPES.has(field.type) && NUMBER_TYPES.has(to)) {
    const n = fromDef.toNumber(value, field.config, ctx);
    if (n === null) return null;
    if (to === 'value') return toDef.normalize({ amount: n }, toConfig, ctx) as Json | null;
    return toDef.parseText(String(n), toConfig, ctx) as Json | null;
  }
  if (field.type === 'check' && to === 'yesno') return value === true ? 'yes' : 'no';
  if (field.type === 'yesno' && to === 'check')
    return value === 'yes' ? true : value === 'no' ? false : null;
  if (field.type === 'date' && to === 'timeline')
    return toDef.normalize({ start: value, end: value }, toConfig, ctx) as Json | null;
  if (field.type === 'date' && to === 'datetime')
    return toDef.normalize(String(value), toConfig, ctx) as Json | null;
  if (field.type === 'datetime' && to === 'date')
    return toDef.normalize(fromDef.toDate(value, field.config, ctx), toConfig, ctx) as Json | null;
  if (field.type === 'multiselect' && to === 'dropdown') {
    const first = Array.isArray(value) ? value[0] : null;
    return first ? (toDef.normalize(first, toConfig, ctx) as Json | null) : null;
  }
  if (field.type === 'dropdown' && to === 'multiselect')
    return toDef.normalize([value], toConfig, ctx) as Json | null;
  if (LABEL_TYPES.has(field.type) && LABEL_TYPES.has(to)) {
    const viaId = toDef.normalize(value, toConfig, ctx);
    if (viaId !== null) return viaId as Json;
  }
  const text = fromDef.toText(value, field.config, ctx);
  return text ? (toDef.parseText(text, toConfig, ctx) as Json | null) : null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function summarizeConversion(total: number, converted: number): string {
  const emptied = total - converted;
  if (total === 0) return 'No values to convert.';
  const head = `${converted} of ${total} ${plural(total, 'value converts', 'values convert')}`;
  return emptied === 0 ? head : `${head}, ${emptied} ${plural(emptied, 'becomes', 'become')} empty`;
}

/** Preview and values for changing `field` to type `to` over `items` (docs/03 §5). */
export function planTypeChange(field: Field, to: string, items: Item[], ctx: Ctx): TypeChangePlan {
  const mode = typeChangeMode(field.type, to);
  const fromDef = def(field.type);
  const config = mode === 'none' ? null : targetConfig(field, to, ctx);
  const values = new Map<string, Json | null>();
  let total = 0;
  let converted = 0;
  if (mode !== 'none' && fromDef) {
    for (const item of items) {
      const v = readValue(item, field, ctx);
      if (v === null || v === undefined || fromDef.isEmpty(v)) continue;
      total += 1;
      if (LINK_TYPES.has(field.type) && LINK_TYPES.has(to)) {
        converted += 1;
        continue;
      }
      const next = convertValue(v, field, to, config, ctx);
      values.set(item.id, next);
      if (next !== null) converted += 1;
    }
  }
  return {
    to,
    mode,
    config,
    values,
    total,
    converted,
    emptied: total - converted,
    summary: summarizeConversion(total, converted),
  };
}
