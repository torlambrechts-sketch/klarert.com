import { z } from 'zod';
import { base, cmpNumber, emptyLast } from './helpers';
import type { LabelOption } from './types';

export type MaturityConfig = Record<string, never>;

export const MATURITY_LEVELS: LabelOption[] = [
  { id: '0', label: 'None', color: 'grey' },
  { id: '1', label: 'Initial', color: 'red' },
  { id: '2', label: 'Repeatable', color: 'orange' },
  { id: '3', label: 'Defined', color: 'yellow', done: true },
  { id: '4', label: 'Managed', color: 'teal', done: true },
  { id: '5', label: 'Optimised', color: 'green', done: true },
];

const isLevel = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 5;
const isEmpty = (v: number | null) => !isLevel(v);

function normalizeMaturity(input: unknown): number | null {
  if (typeof input === 'number') return isLevel(input) ? input : null;
  if (typeof input !== 'string') return null;
  const t = input.trim().toLowerCase();
  const m = t.match(/^(?:level\s*|l)?(\d)(?:\s*[-–·:]?\s*[a-z]+)?$/);
  if (m) return normalizeMaturity(Number(m[1]));
  const i = MATURITY_LEVELS.findIndex((o) => o.label.toLowerCase() === t);
  return i >= 0 ? i : null;
}

export const maturity = base<number, MaturityConfig>({
  id: 'maturity',
  label: 'Maturity',
  family: 'compliance',
  description: 'A maturity level from 0 None to 5 Optimised.',
  storage: 'values',
  kind: 'ordered',
  valueSchema: z.number().int().min(0).max(5),
  configSchema: z.object({}) as unknown as z.ZodType<MaturityConfig>,
  defaultConfig: () => ({}),
  defaultWidth: 130,
  formAllowed: true,
  publicConfigKeys: [],
  kanbanCapable: true,
  calendarCapable: false,
  triggers: ['field_changed', 'field_becomes'],
  normalize: (input) => normalizeMaturity(input),
  parseText: (t) => normalizeMaturity(t),
  isEmpty,
  isDone: (v) => isLevel(v) && v >= 3,
  toText: (v) => (isLevel(v) ? `${v} ${MATURITY_LEVELS[v]!.label}` : ''),
  toNumber: (v) => (isLevel(v) ? v : null),
  compare: (a, b) => emptyLast(a, b, isEmpty, cmpNumber),
  rank: (v) => (isLevel(v) ? v : null),
  keyOf: (v) => (isLevel(v) ? String(v) : null),
  options: () => MATURITY_LEVELS,
});
