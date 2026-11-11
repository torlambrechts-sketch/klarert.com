import { z } from 'zod';
import { base, cmpNumber, emptyLast, parseJson } from './helpers';

export interface RiskValue {
  l: number;
  i: number;
}

export interface RiskMatrixConfig {
  size: number;
  bands: [number, number, number];
  likelihoodLabels: string[];
  impactLabels: string[];
}

export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

/** Low ≤ b0 < Medium ≤ b1 < High ≤ b2 < Critical. */
export function riskLevel(score: number, bands: readonly number[]): RiskLevel {
  if (score <= (bands[0] ?? 4)) return 'Low';
  if (score <= (bands[1] ?? 9)) return 'Medium';
  if (score <= (bands[2] ?? 15)) return 'High';
  return 'Critical';
}

const inRange = (n: unknown, size: number): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= size;

function normalizeRisk(input: unknown, cfg: RiskMatrixConfig): RiskValue | null {
  let l: unknown;
  let i: unknown;
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    l = typeof o.l === 'string' ? Number(o.l) : o.l;
    i = typeof o.i === 'string' ? Number(o.i) : o.i;
  } else if (typeof input === 'string') {
    // "4x5", "4 × 5", "4/5", "L4 I5", "L4, I5"
    const t = input.trim();
    const m =
      t.match(/^l\s*(\d+)\s*[,;/x×*\s]\s*i\s*(\d+)$/i) ?? t.match(/^(\d+)\s*[x×*/,;]\s*(\d+)$/i);
    if (!m) return null;
    l = Number(m[1]);
    i = Number(m[2]);
  } else {
    return null;
  }
  return inRange(l, cfg.size) && inRange(i, cfg.size) ? { l, i } : null;
}

const isEmpty = (v: RiskValue | null) => !v || typeof v.l !== 'number' || typeof v.i !== 'number';
const scoreOf = (v: RiskValue) => v.l * v.i;

export const riskmatrix = base<RiskValue, RiskMatrixConfig>({
  id: 'riskmatrix',
  label: 'Risk matrix',
  family: 'compliance',
  description: 'Likelihood times impact, with a Low to Critical level.',
  storage: 'values',
  kind: 'number',
  defaultSummary: 'average',
  valueSchema: z.object({ l: z.number().int().min(1), i: z.number().int().min(1) }),
  configSchema: z.object({
    size: z.number().int().min(2),
    bands: z.tuple([z.number(), z.number(), z.number()]),
    likelihoodLabels: z.array(z.string()),
    impactLabels: z.array(z.string()),
  }),
  defaultConfig: () => ({ size: 5, bands: [4, 9, 15], likelihoodLabels: [], impactLabels: [] }),
  defaultWidth: 130,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed', 'number_above', 'number_below'],
  normalize: (input, cfg) => normalizeRisk(input, cfg),
  parseText: (t, cfg) => normalizeRisk(t.trim().startsWith('{') ? parseJson(t.trim()) : t, cfg),
  isEmpty,
  toText: (v, cfg) => (isEmpty(v) ? '' : `${scoreOf(v!)} · ${riskLevel(scoreOf(v!), cfg.bands)}`),
  toNumber: (v) => (isEmpty(v) ? null : scoreOf(v!)),
  compare: (a, b) =>
    emptyLast(a, b, isEmpty, (x, y) => cmpNumber(scoreOf(x), scoreOf(y)) || cmpNumber(x.l, y.l)),
});
