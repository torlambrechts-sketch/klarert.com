import { z } from 'zod';
import type { Ctx, Field, Item, Json } from '../types';
import { freshness } from './evidence';
import {
  base,
  cmpNumber,
  cmpText,
  emptyLast,
  formatDate,
  formatNumber,
  isIsoDate,
  parseNumber,
} from './helpers';
import { fieldByKey, linkedItems, readValue, throughHidden } from './link';
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
  // sub-items and other linked items (docs/03 §3.4): the least finished option, the earliest date, expired evidence
  'worst',
  'earliest',
  'countExpired',
  // "7 of 9": done out of the targets that count (requirement checks, docs/11)
  'doneOf',
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
  /**
   * Status option ids (or labels) of linked items left out of every function (the first status field of the target
   * sheet): "Not applicable" checks count neither as done nor as open.
   */
  ignore?: string[];
}

interface Target {
  item: Item;
  field: Field;
  def: AnyFieldType;
  value: unknown;
}

/** number for most functions; the option label for `worst`; an ISO date for `earliest`. */
export type RollupValue = number | string;

const isEmpty = (v: RollupValue | null) =>
  v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v)) || v === '';

/**
 * The least finished value among option-like targets: a value that is not done beats a done one; then the higher
 * rank (ordered kinds such as severity) or the later option in the list (status: Stuck after Working on it).
 */
function worstOf(targets: Target[], ctx: Ctx): string | null {
  let best: { label: string; done: boolean; order: number } | null = null;
  for (const t of targets) {
    if (t.def.isEmpty(t.value)) continue;
    const cfg = t.field.config;
    const options = t.def.options?.(cfg, ctx) ?? [];
    const key = t.def.keyOf
      ? t.def.keyOf(t.value, cfg)
      : typeof t.value === 'string'
        ? t.value
        : null;
    const index = options.findIndex((o) => o.id === key);
    const order = t.def.rank?.(t.value, cfg) ?? index;
    if (order === null || order < 0) continue;
    const done = t.def.isDone?.(t.value, cfg) ?? false;
    const label = options[index]?.label ?? t.def.toText(t.value, cfg, ctx);
    if (!best || (best.done && !done) || (best.done === done && order > best.order))
      best = { label, done, order };
  }
  return best?.label ?? null;
}

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

/** A linked item whose status (the first status field of its sheet) is one of `ignore`, by option id or label. */
function ignored(t: Item, ignore: string[], ctx: Ctx): boolean {
  const f = ctx.fieldsOf(t.sheetId).find((x) => x.type === 'status');
  const def = f && resolveFieldType(f.type);
  if (!f || !def) return false;
  const v = readValue(t, f, ctx);
  const key = def.keyOf ? def.keyOf(v, f.config) : typeof v === 'string' ? v : null;
  if (key === null) return false;
  if (ignore.includes(key)) return true;
  const label = def.options?.(f.config, ctx).find((o) => o.id === key)?.label;
  return !!label && ignore.some((x) => x.trim().toLowerCase() === label.trim().toLowerCase());
}

/** The target field to read on a linked item; pctDone without a target uses the sheet's first status field. */
function targetField(t: Item, cfg: RollupConfig, ctx: Ctx): Field | undefined {
  if (cfg.targetFieldKey) return fieldByKey(t.sheetId, cfg.targetFieldKey, ctx);
  return cfg.fn === 'pctDone' || cfg.fn === 'doneOf'
    ? ctx.fieldsOf(t.sheetId).find((f) => f.type === 'status')
    : undefined;
}

export function computeRollup(
  item: Item,
  field: Field<RollupConfig>,
  ctx: Ctx,
): RollupValue | null {
  const cfg = field.config;
  const linkField = fieldByKey(field.sheetId, cfg.linkFieldKey, ctx);
  if (!linkField) return null;
  const linked = linkedItems(item, linkField, ctx);
  const items = cfg.ignore?.length ? linked.filter((t) => !ignored(t, cfg.ignore!, ctx)) : linked;
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
    case 'worst':
      return worstOf(targets, ctx);
    case 'earliest': {
      const dates = targets
        .map((t) => t.def.toDate(t.value, t.field.config, ctx))
        .filter((d): d is string => !!d)
        .sort();
      return dates[0] ?? null;
    }
    case 'countExpired':
      // evidence files past their valid-until date, or a date (an evidence expiry) before today
      return targets.filter((t) =>
        t.def.storage === 'files'
          ? freshness(Array.isArray(t.value) ? (t.value as never) : null, ctx.today) === 'expired'
          : t.def.kind === 'date' &&
            (t.def.toDate(t.value, t.field.config, ctx) ?? '9999') < ctx.today,
      ).length;
    case 'doneOf': {
      const done = targets.filter((t) => t.def.isDone?.(t.value, t.field.config) ?? false).length;
      return `${done} of ${targets.length}`;
    }
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

const asNumber = (v: RollupValue | null) => (typeof v === 'number' && !Number.isNaN(v) ? v : null);

export const rollup: FieldTypeDef<RollupValue, RollupConfig> = base<RollupValue, RollupConfig>({
  id: 'rollup',
  label: 'Rollup',
  family: 'computed',
  description: 'Counts or totals a field across the linked items.',
  storage: 'computed',
  kind: 'number',
  valueSchema: z.union([z.number().finite(), z.string()]),
  configSchema: z.object({
    linkFieldKey: z.string(),
    targetFieldKey: z.string().min(1).nullable(),
    fn: z.enum(ROLLUP_FNS),
    where: z
      .object({ op: z.enum(WHERE_OPS), value: z.custom<Json>((x) => x !== undefined).optional() })
      .optional(),
    ignore: z.array(z.string().min(1).max(200)).max(50).optional(),
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
  readsHidden: (field, ctx) => throughHidden(field.sheetId, field.config, ctx),
  isEmpty,
  effectiveKind: (field) =>
    field.config.fn === 'worst' || field.config.fn === 'doneOf'
      ? 'text'
      : field.config.fn === 'earliest'
        ? 'date'
        : 'number',
  toText: (v, cfg) => {
    if (v === null || isEmpty(v)) return '';
    if (typeof v === 'string') return isIsoDate(v) ? formatDate(v) : v;
    if (cfg.fn === 'countExpired') return `${formatNumber(v, 0)} expired`;
    return `${formatNumber(v, 2)}${cfg.fn === 'pctDone' ? '%' : ''}`;
  },
  toNumber: (v) => asNumber(v),
  toDate: (v) => (typeof v === 'string' && isIsoDate(v) ? v : null),
  compare: (a, b) =>
    emptyLast(a, b, isEmpty, (x, y) =>
      typeof x === 'number' && typeof y === 'number'
        ? cmpNumber(x, y)
        : cmpText(String(x), String(y)),
    ),
});
