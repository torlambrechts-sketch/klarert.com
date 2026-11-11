import { z } from 'zod';
import type { Field } from '../types';
import { base, cmpNumber, emptyLast, issue, parseNumber } from './helpers';

export interface RatingConfig {
  scale: number;
}

const isEmpty = (v: number | null) => v === null || v === undefined || Number.isNaN(v);
const inScale = (n: number | null, cfg: RatingConfig) =>
  n !== null && Number.isInteger(n) && n >= 1 && n <= cfg.scale ? n : null;

/** "4", "4 / 5", "★★★★☆". */
function read(input: unknown): number | null {
  if (typeof input === 'string') {
    const t = input.trim();
    if (/^[★☆]+$/.test(t)) return [...t].filter((c) => c === '★').length || null;
    const m = t.match(/^(\d+)\s*\/\s*\d+$/);
    if (m) return Number(m[1]);
  }
  return parseNumber(input);
}

export const rating = base<number, RatingConfig>({
  id: 'rating',
  label: 'Rating',
  family: 'basic',
  description: 'A rating in stars, from 1 to the scale you choose.',
  storage: 'values',
  kind: 'number',
  defaultSummary: 'average',
  valueSchema: z.number().int().min(1).max(10),
  configSchema: z.object({ scale: z.number().int().min(3).max(10) }),
  defaultConfig: () => ({ scale: 5 }),
  defaultWidth: 110,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed', 'number_above', 'number_below'],
  normalize: (input, cfg) => inScale(read(input), cfg),
  // Pasted and converted values are clamped to the scale (docs/03 §5: number ↔ rating, clamped).
  parseText: (t, cfg) => {
    const n = read(t);
    return n === null ? null : Math.min(cfg.scale, Math.max(1, Math.round(n)));
  },
  validate: (v, field: Field<RatingConfig>) =>
    v !== null && inScale(v, field.config) === null
      ? [issue(field, 'out_of_scale', `Choose a rating from 1 to ${field.config.scale}.`)]
      : [],
  isEmpty,
  toText: (v, cfg) => (isEmpty(v) ? '' : `${v} / ${cfg.scale}`),
  toNumber: (v) => (isEmpty(v) ? null : v),
  compare: (a, b) => emptyLast(a, b, isEmpty, cmpNumber),
});
