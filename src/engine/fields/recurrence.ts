import { z } from 'zod';
import type { Ctx } from '../types';
import {
  addDays,
  addMonths,
  base,
  cmpText,
  daysBetween,
  emptyLast,
  formatDate,
  isIsoDate,
  parseDate,
  parseJson,
} from './helpers';

export const RECURRENCE_UNITS = ['days', 'weeks', 'months', 'years'] as const;
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];
export interface RecurrenceValue {
  every: number;
  unit: RecurrenceUnit;
  start: string;
}

const ADJECTIVES: Record<string, [number, RecurrenceUnit]> = {
  daily: [1, 'days'],
  weekly: [1, 'weeks'],
  fortnightly: [2, 'weeks'],
  monthly: [1, 'months'],
  quarterly: [3, 'months'],
  yearly: [1, 'years'],
  annually: [1, 'years'],
  annual: [1, 'years'],
};

const unitOf = (s: unknown): RecurrenceUnit | undefined => {
  if (typeof s !== 'string') return undefined;
  const t = s.trim().toLowerCase();
  const u = (t.endsWith('s') ? t : `${t}s`) as RecurrenceUnit;
  return RECURRENCE_UNITS.includes(u) ? u : undefined;
};

const isEmpty = (v: RecurrenceValue | null) => !v || !v.every || !v.unit || !v.start;

/** The first occurrence on or after `today`. */
export function nextOccurrence(v: RecurrenceValue, today: string): string {
  if (v.start >= today) return v.start;
  if (v.unit === 'days' || v.unit === 'weeks') {
    const step = v.every * (v.unit === 'weeks' ? 7 : 1);
    return addDays(v.start, Math.ceil(daysBetween(today, v.start) / step) * step);
  }
  // Months and years count from the start, so 31 Jan stays the 31st where the month allows.
  const months = v.every * (v.unit === 'years' ? 12 : 1);
  const [sy, sm] = v.start.split('-').map(Number) as [number, number];
  const [ty, tm] = today.split('-').map(Number) as [number, number];
  let k = Math.max(0, Math.floor(((ty - sy) * 12 + (tm - sm)) / months) - 1);
  while (addMonths(v.start, k * months) < today) k += 1;
  return addMonths(v.start, k * months);
}

function make(
  every: unknown,
  unit: RecurrenceUnit | undefined,
  start: string | null,
): RecurrenceValue | null {
  const n = typeof every === 'string' ? Number(every) : every;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || !unit || !start) return null;
  return { every: n, unit, start };
}

function normalize(input: unknown, ctx: Ctx): RecurrenceValue | null {
  if (typeof input === 'string') return parseRule(input, ctx);
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    const start =
      o.start === undefined || o.start === null || o.start === '' ? ctx.today : parseDate(o.start);
    return make(o.every ?? 1, unitOf(o.unit), start);
  }
  return null;
}

/** "Every month", "every 2 weeks from 1 Dec 2026", "Quarterly", "Every month · next 15 Dec 2026". */
function parseRule(text: string, ctx: Ctx): RecurrenceValue | null {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('{')) return normalize(parseJson(t), ctx);
  const m = t.match(/^(.*?)(?:\s*[·,]?\s*\b(?:from|starting(?:\s+on)?|next|start)\s+(.+))?$/i);
  if (!m) return null;
  const rule = m[1]!.trim().toLowerCase();
  const start = m[2] ? parseDate(m[2]) : ctx.today;
  if (!start) return null;
  const adj = ADJECTIVES[rule];
  if (adj) return make(adj[0], adj[1], start);
  const r = rule.match(/^every\s+(?:(\d+)\s+)?(day|week|month|quarter|year)s?$/);
  if (!r) return null;
  const n = r[1] ? Number(r[1]) : 1;
  return r[2] === 'quarter' ? make(n * 3, 'months', start) : make(n, unitOf(r[2]), start);
}

export const recurrence = base<RecurrenceValue, Record<string, never>>({
  id: 'recurrence',
  label: 'Recurrence',
  family: 'basic',
  description: 'A repeating date, such as a monthly review.',
  storage: 'values',
  kind: 'date',
  valueSchema: z.object({
    every: z.number().int().min(1),
    unit: z.enum(RECURRENCE_UNITS),
    start: z.string().refine(isIsoDate),
  }),
  configSchema: z.object({}) as z.ZodType<Record<string, never>>,
  defaultConfig: () => ({}),
  defaultWidth: 170,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: true,
  triggers: ['field_changed', 'date_arrives'],
  normalize: (input, _cfg, ctx) => normalize(input, ctx),
  parseText: (t, _cfg, ctx) => parseRule(t, ctx),
  isEmpty,
  toText: (v, _cfg, ctx) => {
    if (isEmpty(v)) return '';
    const rule = v!.every === 1 ? v!.unit.slice(0, -1) : `${v!.every} ${v!.unit}`;
    return `Every ${rule} · next ${formatDate(nextOccurrence(v!, ctx.today))}`;
  },
  toDate: (v, _cfg, ctx) => (isEmpty(v) ? null : nextOccurrence(v!, ctx.today)),
  compare: (a, b, _cfg, ctx) =>
    emptyLast(a, b, isEmpty, (x, y) =>
      cmpText(nextOccurrence(x, ctx.today), nextOccurrence(y, ctx.today)),
    ),
});
