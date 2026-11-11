import { z } from 'zod';
import { base, cmpNumber, emptyLast, formatNumber, parseNumber } from './helpers';

export interface NumberConfig {
  unit: string;
  decimals: number;
}

const isEmpty = (v: number | null) => v === null || v === undefined || Number.isNaN(v);

export const number = base<number, NumberConfig>({
  id: 'number',
  label: 'Number',
  family: 'basic',
  description: 'A number, with an optional unit.',
  storage: 'values',
  kind: 'number',
  valueSchema: z.number().finite(),
  configSchema: z.object({ unit: z.string().max(12), decimals: z.number().int().min(0).max(6) }),
  defaultConfig: () => ({ unit: '', decimals: 2 }),
  defaultWidth: 96,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed', 'number_above', 'number_below'],
  normalize: (input) => parseNumber(input),
  parseText: (t) => parseNumber(t),
  isEmpty,
  toText: (v, cfg) => (isEmpty(v) ? '' : `${formatNumber(v!, cfg.decimals)}${cfg.unit ? ` ${cfg.unit}` : ''}`),
  toNumber: (v) => (isEmpty(v) ? null : v),
  compare: (a, b) => emptyLast(a, b, isEmpty, cmpNumber),
});
