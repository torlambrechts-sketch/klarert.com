import { z } from 'zod';
import { base, cmpNumber, emptyLast, formatNumber, parseJson, parseNumber } from './helpers';

export const DURATION_UNITS = ['hours', 'days', 'weeks', 'months', 'years'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];
export interface DurationValue {
  n: number;
  unit: DurationUnit;
}
export interface DurationConfig {
  unit: DurationUnit;
}

/** Days per unit (docs/03 §3.1: month = 30.4, year = 365). */
export const DAYS_PER_UNIT: Record<DurationUnit, number> = { hours: 1 / 24, days: 1, weeks: 7, months: 30.4, years: 365 };

// "m" is left out on purpose: minutes or months is ambiguous.
const UNIT_ALIASES: Record<string, DurationUnit> = {
  h: 'hours', hr: 'hours', hrs: 'hours', hour: 'hours', hours: 'hours',
  d: 'days', day: 'days', days: 'days',
  w: 'weeks', wk: 'weeks', wks: 'weeks', week: 'weeks', weeks: 'weeks',
  mo: 'months', mos: 'months', mth: 'months', mths: 'months', month: 'months', months: 'months',
  y: 'years', yr: 'years', yrs: 'years', year: 'years', years: 'years',
};

const unitOf = (s: unknown): DurationUnit | undefined =>
  typeof s === 'string' ? UNIT_ALIASES[s.trim().toLowerCase()] : undefined;

const isEmpty = (v: DurationValue | null) => !v || typeof v.n !== 'number' || !Number.isFinite(v.n);
const ok = (n: number | null, unit: DurationUnit | undefined): DurationValue | null =>
  n !== null && n >= 0 && unit ? { n, unit } : null;

function normalize(input: unknown, cfg: DurationConfig): DurationValue | null {
  if (typeof input === 'number') return ok(Number.isFinite(input) ? input : null, cfg.unit);
  if (typeof input === 'string') {
    const t = input.trim();
    if (t.startsWith('{')) return normalize(parseJson(t), cfg);
    const m = t.match(/^(\d+(?:\.\d+)?|\.\d+)\s*([a-z]*)$/i);
    if (!m) return null;
    return ok(Number(m[1]), m[2] ? unitOf(m[2]) : cfg.unit);
  }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    return ok(parseNumber(o.n), o.unit === undefined ? cfg.unit : unitOf(o.unit));
  }
  return null;
}

export const duration = base<DurationValue, DurationConfig>({
  id: 'duration',
  label: 'Duration',
  family: 'basic',
  description: 'A length of time in hours, days, weeks, months or years.',
  storage: 'values',
  kind: 'number',
  valueSchema: z.object({ n: z.number().finite().min(0), unit: z.enum(DURATION_UNITS) }),
  configSchema: z.object({ unit: z.enum(DURATION_UNITS) }),
  defaultConfig: () => ({ unit: 'days' }),
  defaultWidth: 100,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed', 'number_above', 'number_below'],
  normalize,
  parseText: (t, cfg) => normalize(t, cfg),
  isEmpty,
  toText: (v) => (isEmpty(v) ? '' : `${formatNumber(v!.n, 2)} ${v!.n === 1 ? v!.unit.slice(0, -1) : v!.unit}`),
  toNumber: (v) => (isEmpty(v) ? null : v!.n * DAYS_PER_UNIT[v!.unit]),
  compare: (a, b) =>
    emptyLast(a, b, isEmpty, (x, y) => cmpNumber(x.n * DAYS_PER_UNIT[x.unit], y.n * DAYS_PER_UNIT[y.unit])),
});
