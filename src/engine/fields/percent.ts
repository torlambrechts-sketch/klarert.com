import { z } from 'zod';
import { base, cmpNumber, emptyLast, formatNumber, parseNumber } from './helpers';

export interface PercentConfig {
  bar: boolean;
}

const isEmpty = (v: number | null) => v === null || v === undefined || Number.isNaN(v);
const inRange = (n: number | null) => (n !== null && n >= 0 && n <= 100 ? n : null);

export const percent = base<number, PercentConfig>({
  id: 'percent',
  label: 'Percentage',
  family: 'basic',
  description: 'A percentage from 0 to 100, with an optional bar.',
  storage: 'values',
  kind: 'number',
  defaultSummary: 'average',
  valueSchema: z.number().min(0).max(100),
  configSchema: z.object({ bar: z.boolean() }),
  defaultConfig: () => ({ bar: true }),
  defaultWidth: 96,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed', 'number_above', 'number_below'],
  normalize: (input) => inRange(parseNumber(input)),
  parseText: (t) => inRange(parseNumber(t)),
  isEmpty,
  toText: (v) => (isEmpty(v) ? '' : `${formatNumber(v!, 2)}%`),
  toNumber: (v) => (isEmpty(v) ? null : v),
  compare: (a, b) => emptyLast(a, b, isEmpty, cmpNumber),
});
