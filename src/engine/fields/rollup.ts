import { z } from 'zod';
import type { Ctx, Field, Item, Json } from '../types';
import { base, cmpNumber, emptyLast, formatNumber, parseNumber } from './helpers';
import { fieldByKey, linkedItems, readValue } from './link';
import { resolveFieldType } from './resolve';
import type { AnyFieldType, FieldTypeDef } from './types';

export const ROLLUP_FNS = [
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'pctDone',
  'countEmpty',
  'countWhere',
] as const;
export type RollupFn = (typeof ROLLUP_FNS)[number];

const WHERE_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'] as const;
export interface RollupWhere {
  op: (typeof WHERE_OPS)[number];
  value?: Json;
}

export interface RollupConfig {
  linkFieldKey: string;
  targetFieldKey: string | null;
  fn: RollupFn;
  where?: RollupWhere;
}

interface Target {
  item: Item;
  field: Field;
  def: AnyFieldType;
  value: unknown;
}

const isEmpty = (v: number | null) => v === null || v === undefined || Number.isNaN(v);

// A small comparison for countWhere only; filters and automation conditions use src/engine/conditions.
function matches(t: Target, where: RollupWhere, ctx: Ctx): boolean {
  const empty = t.def.isEmpty(t.value);
  if (where.op === 'is_empty') return empty;
  if (where.op === 'is_not_empty') return !empty;
  const n = t.def.toNumber(t.value, t.field.config, ctx);
  const wn = typeof where.value === 'number' ? where.value : parseNumber(where.value);
  let c: number | null = null;
  if (n !== null && wn !== null) c = cmpNumber(n, wn);
  else if (where.op === 'eq' || where.op === 'neq') {
    const w = where.value;
    const same =
      (typeof w === 'string' &&
        (t.value === w ||
          t.def.toText(t.value, t.field.config, ctx).toLowerCase() === w.trim().toLowerCase())) ||
      (w === null && empty);
    return where.op === 'eq' ? same : !same;
  }
  if (c === null) return false;
  switch (where.op) {
    case 'eq':
      return c === 0;
    case 'neq':
      return c !== 0;
    case 'gt':
      return c > 0;
    case 'gte':
      return c >= 0;
    case 'lt':
      return c < 0;
    default:
      return c <= 0;
  }
}

/** The target field to read on a linked item; pctDone without a target uses the sheet's first status field. */
function targetField(t: Item, cfg: RollupConfig, ctx: Ctx): Field | undefined {
  if (cfg.targetFieldKey) return fieldByKey(t.sheetId, cfg.targetFieldKey, ctx);
  return cfg.fn === 'pctDone'
    ? ctx.fieldsOf(t.sheetId).find((f) => f.type === 'status')
    : undefined;
}

export function computeRollup(item: Item, field: Field<RollupConfig>, ctx: Ctx): number | null {
  const cfg = field.config;
  const linkField = fieldByKey(field.sheetId, cfg.linkFieldKey, ctx);
  if (!linkField) return null;
  const items = linkedItems(item, linkField, ctx);
  if (cfg.fn === 'count') return items.length;
  const targets: Target[] = items.flatMap((t) => {
    const f = targetField(t, cfg, ctx);
    const def = f && resolveFieldType(f.type);
    return f && def ? [{ item: t, field: f, def, value: readValue(t, f, ctx) }] : [];
  });
  switch (cfg.fn) {
    case 'countEmpty':
      return targets.filter((t) => t.def.isEmpty(t.value)).length;
    case 'countWhere':
      return cfg.where ? targets.filter((t) => matches(t, cfg.where!, ctx)).length : null;
    case 'pctDone': {
      if (!targets.length) return null;
      const done = targets.filter((t) => t.def.isDone?.(t.value, t.field.config) ?? false).length;
      return Math.round((done / targets.length) * 100);
    }
    default: {
      const ns = targets
        .map((t) => t.def.toNumber(t.value, t.field.config, ctx))
        .filter((n): n is number => n !== null);
      if (!ns.length) return null;
      const sum = ns.reduce((a, b) => a + b, 0);
      if (cfg.fn === 'sum') return sum;
      if (cfg.fn === 'avg') return sum / ns.length;
      return cfg.fn === 'min' ? Math.min(...ns) : Math.max(...ns);
    }
  }
}

export const rollup: FieldTypeDef<number, RollupConfig> = base<number, RollupConfig>({
  id: 'rollup',
  label: 'Rollup',
  family: 'computed',
  description: 'Counts or totals a field across the linked items.',
  storage: 'computed',
  kind: 'number',
  valueSchema: z.number().finite(),
  configSchema: z.object({
    linkFieldKey: z.string(),
    targetFieldKey: z.string().min(1).nullable(),
    fn: z.enum(ROLLUP_FNS),
    where: z
      .object({ op: z.enum(WHERE_OPS), value: z.custom<Json>((x) => x !== undefined).optional() })
      .optional(),
  }) as z.ZodType<RollupConfig>,
  defaultConfig: () => ({ linkFieldKey: '', targetFieldKey: null, fn: 'count' }),
  defaultWidth: 110,
  formAllowed: false,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['number_above', 'number_below'],
  normalize: (input) => parseNumber(input),
  parseText: (t) => parseNumber(t),
  compute: computeRollup,
  isEmpty,
  toText: (v, cfg) =>
    isEmpty(v) ? '' : `${formatNumber(v!, 2)}${cfg.fn === 'pctDone' ? '%' : ''}`,
  toNumber: (v) => (isEmpty(v) ? null : v),
  compare: (a, b) => emptyLast(a, b, isEmpty, cmpNumber),
});
