import { z } from 'zod';
import type { Ctx } from '../types';
import {
  base,
  cmpNumber,
  emptyLast,
  formatNumber,
  isIsoDate,
  parseDate,
  parseJson,
  parseNumber,
} from './helpers';

export interface Reading {
  at: string;
  v: number;
  by?: string;
  note?: string;
}

export interface MeasurementConfig {
  unit: string;
  target: number | null;
  direction: 'up' | 'down';
}

const readingSchema = z.object({
  at: z.string().refine(isIsoDate, 'Use YYYY-MM-DD'),
  v: z.number().finite(),
  by: z.string().optional(),
  note: z.string().optional(),
});

const isEmpty = (v: Reading[] | null) => !Array.isArray(v) || v.length === 0;
/** Most recent reading by date; on the same day the later entry wins. */
const latest = (v: Reading[] | null) =>
  isEmpty(v) ? null : v!.reduce((a, b) => (b.at >= a.at ? b : a));

function readingOf(x: unknown, ctx: Ctx): Reading | null {
  const n = parseNumber(x);
  if (n !== null) return { at: ctx.today, v: n, by: ctx.userId };
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const r = readingSchema.safeParse({ ...o, at: parseDate(o.at), v: parseNumber(o.v) });
  if (!r.success) return null;
  return Object.fromEntries(
    Object.entries(r.data).filter(([, y]) => y !== undefined),
  ) as unknown as Reading;
}

function normalizeReadings(input: unknown, ctx: Ctx): Reading[] | null {
  const arr = Array.isArray(input) ? input : [input];
  const out: Reading[] = [];
  for (const x of arr) {
    const r = readingOf(x, ctx);
    if (!r) return null;
    out.push(r);
  }
  // Stable sort keeps the entry order of readings taken on the same day.
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return out.length ? out : null;
}

/** Latest reading against the target: true on target, false off, null without a target or reading. */
export function onTarget(v: Reading[] | null, cfg: MeasurementConfig): boolean | null {
  const l = latest(v);
  if (!l || cfg.target === null) return null;
  return cfg.direction === 'up' ? l.v >= cfg.target : l.v <= cfg.target;
}

export const measurement = base<Reading[], MeasurementConfig>({
  id: 'measurement',
  label: 'Measurement',
  family: 'compliance',
  description: 'Dated readings of a metric, against an optional target.',
  storage: 'values',
  kind: 'number',
  valueSchema: z.array(readingSchema),
  configSchema: z.object({
    unit: z.string().max(12),
    target: z.number().finite().nullable(),
    direction: z.enum(['up', 'down']),
  }),
  defaultConfig: () => ({ unit: '', target: null, direction: 'down' }),
  defaultWidth: 150,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed', 'number_above', 'number_below'],
  normalize: (input, _cfg, ctx) => normalizeReadings(input, ctx),
  parseText: (t, _cfg, ctx) => {
    const s = t.trim();
    if (!s) return null;
    if (s.startsWith('[') || s.startsWith('{')) return normalizeReadings(parseJson(s), ctx);
    // "2026-11-01: 12.5; 2026-11-05: 11" or a single number
    const parts = s
      .split(/[;\n]/)
      .map((p) => p.trim())
      .filter(Boolean);
    const rows = parts.map((p) => {
      const m = p.match(/^(.+?)\s*[:=]\s*(.+)$/);
      return m ? { at: m[1], v: m[2] } : p;
    });
    return normalizeReadings(rows, ctx);
  },
  isEmpty,
  toText: (v, cfg) => {
    const l = latest(v);
    return l ? `${formatNumber(l.v)}${cfg.unit ? ` ${cfg.unit}` : ''}` : '';
  },
  toNumber: (v) => latest(v)?.v ?? null,
  compare: (a, b) => emptyLast(a, b, isEmpty, (x, y) => cmpNumber(latest(x)!.v, latest(y)!.v)),
});
