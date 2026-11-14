import { z } from 'zod';
import {
  type FormulaAst,
  type FormulaResult,
  type FormulaResultType,
  coerceResult,
  evaluateFormula,
  formulaError,
  parseFormula,
  resultToValue,
} from '../formula';
import type { Ctx, Field, Item } from '../types';
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
import { resolveFieldType } from './resolve';
import type { ValueKind } from './types';

export type FormulaFieldValue = number | string | boolean;

export interface FormulaConfig {
  expr: string;
  result: FormulaResultType;
}

/** docs/03 §7: formula-to-formula nesting deeper than this is #LOOP. */
const MAX_DEPTH = 4;

/** Value kind a formula's result has, for filters and conditions; `auto` reads as text. */
export function formulaKind(
  cfg: FormulaConfig,
): Extract<ValueKind, 'number' | 'date' | 'text' | 'boolean'> {
  return cfg.result === 'auto' ? 'text' : cfg.result;
}

// Parsed ASTs keyed by source; formulas are re-evaluated for every item, parsing once is enough.
const astCache = new Map<string, ReturnType<typeof parseFormula>>();
function astOf(expr: string): FormulaAst | null {
  let parsed = astCache.get(expr);
  if (!parsed) {
    parsed = parseFormula(expr);
    if (astCache.size > 500) astCache.clear();
    astCache.set(expr, parsed);
  }
  return parsed.ok ? parsed.ast : null;
}

function rawValue(item: Item, field: Field, ctx: Ctx): unknown {
  const def = resolveFieldType(field.type);
  if (!def) return null;
  if (def.storage === 'values') return item.values[field.id] ?? null;
  return def.compute ? (def.compute(item, field, ctx) ?? null) : null;
}

/** Resolves `{key}` for a formula on an item (docs/03 §7 reference rules). */
function resolveRef(key: string, item: Item, ctx: Ctx, stack: string[]): FormulaResult {
  const special = key.toLowerCase();
  if (special === 'name') return item.name;
  if (special === 'id') return item.displayId;
  if (special === 'group') return ctx.groups.get(item.groupId)?.name ?? '';
  const target = ctx.fieldsByKey.get(key);
  if (!target) return formulaError('#REF', `No field with key ${key}`);
  if (target.type === formula.id)
    return evalField(item, target as Field<FormulaConfig>, ctx, stack);
  const def = resolveFieldType(target.type);
  if (!def) return formulaError('#REF', `Unknown field type ${target.type}`);
  const v = rawValue(item, target, ctx);
  if (def.isEmpty(v)) return '';
  const kind = def.effectiveKind ? def.effectiveKind(target, ctx) : def.kind;
  if (kind === 'number') return def.toNumber(v, target.config, ctx) ?? '';
  if (kind === 'date' || kind === 'daterange') return def.toDate(v, target.config, ctx) ?? '';
  return def.toText(v, target.config, ctx);
}

/** `stack` holds the keys of the formulas currently being evaluated above this one. */
function evalField(
  item: Item,
  field: Field<FormulaConfig>,
  ctx: Ctx,
  stack: string[],
): FormulaResult {
  if (stack.includes(field.key)) return formulaError('#LOOP', 'The formula refers to itself');
  if (stack.length > MAX_DEPTH) return formulaError('#LOOP', 'Formulas are nested too deeply');
  const expr = field.config.expr ?? '';
  if (expr.trim() === '') return '';
  const ast = astOf(expr);
  if (!ast) return formulaError('#ERR', 'The formula has a syntax error');
  const inner = [...stack, field.key];
  const raw = evaluateFormula(ast, {
    today: ctx.today,
    ref: (key) => resolveRef(key, item, ctx, inner),
  });
  return coerceResult(raw, field.config.result ?? 'auto');
}

const REF = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** A formula reading a field the caller may not see is hidden too (docs/02 §16); nested formulas are followed. */
function readsHidden(field: Field<FormulaConfig>, ctx: Ctx, stack: string[] = []): boolean {
  if (stack.includes(field.key) || stack.length > MAX_DEPTH) return false;
  for (const m of (field.config.expr ?? '').matchAll(REF)) {
    const target = ctx.fieldsByKey.get(m[1]!);
    if (!target) continue;
    if (ctx.canSee && !ctx.canSee(target)) return true;
    if (target.type === 'formula') {
      if (readsHidden(target as Field<FormulaConfig>, ctx, [...stack, field.key])) return true;
    } else if (resolveFieldType(target.type)?.readsHidden?.(target, ctx)) return true;
  }
  return false;
}

const isEmpty = (v: FormulaFieldValue | null) => v === null || v === undefined || v === '';
const isError = (v: unknown) => typeof v === 'string' && /^#(REF|LOOP|ERR|DIV0)$/.test(v);

function normalize(input: unknown): FormulaFieldValue | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input === 'boolean') return input;
  if (typeof input === 'string') return input.trim() === '' ? null : input.trim();
  return null;
}

function parseText(text: string): FormulaFieldValue | null {
  const t = text.trim();
  if (!t) return null;
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true';
  return parseNumber(t) ?? t;
}

export const formula = base<FormulaFieldValue, FormulaConfig>({
  id: 'formula',
  label: 'Formula',
  family: 'computed',
  description: 'A value calculated from other fields of the item.',
  storage: 'computed',
  kind: 'number',
  valueSchema: z.union([z.number().finite(), z.string(), z.boolean()]),
  configSchema: z.object({
    expr: z.string(),
    result: z.enum(['auto', 'number', 'text', 'date', 'boolean']),
  }),
  defaultConfig: () => ({ expr: '', result: 'auto' }),
  defaultWidth: 130,
  formAllowed: false,
  kanbanCapable: false,
  calendarCapable: false,
  // date_arrives fires on a formula whose result is a date (a deadline computed from other dates)
  triggers: ['number_above', 'number_below', 'date_arrives'],
  normalize,
  parseText,
  readsHidden: (field, ctx) => readsHidden(field, ctx),
  compute: (item, field, ctx) => {
    const v = resultToValue(evalField(item, field, ctx, []));
    return v === '' ? null : v;
  },
  effectiveKind: (field) => (field.config.result === 'auto' ? 'number' : formulaKind(field.config)),
  isEmpty,
  toText: (v) => {
    if (isEmpty(v)) return '';
    if (typeof v === 'number') return formatNumber(v, 2);
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return isIsoDate(v) ? formatDate(v as string) : String(v);
  },
  toNumber: (v) => (typeof v === 'number' ? v : null),
  toDate: (v) => (typeof v === 'string' && isIsoDate(v) ? v : null),
  compare: (a, b) =>
    emptyLast(a, b, isEmpty, (x, y) => {
      if (typeof x === 'number' && typeof y === 'number') return cmpNumber(x, y);
      if (isError(x) !== isError(y)) return isError(x) ? 1 : -1;
      return cmpText(String(x), String(y));
    }),
});
