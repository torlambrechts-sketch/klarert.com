import { z } from 'zod';
import { base, cmpNumber, emptyLast } from './helpers';

const TRUE = new Set(['true', 'yes', 'y', '1', 'x', '✓', '✔', 'checked', 'on']);
const FALSE = new Set(['false', 'no', 'n', '0', 'unchecked', 'off']);

function normalize(input: unknown): boolean | null {
  if (typeof input === 'boolean') return input;
  if (input === 1 || input === 0) return input === 1;
  if (typeof input !== 'string') return null;
  const t = input.trim().toLowerCase();
  return TRUE.has(t) ? true : FALSE.has(t) ? false : null;
}

const isEmpty = (v: boolean | null) => v === null || v === undefined;

export const check = base<boolean, Record<string, never>>({
  id: 'check',
  label: 'Checkbox',
  family: 'basic',
  description: 'Ticked or not.',
  storage: 'values',
  kind: 'boolean',
  valueSchema: z.boolean(),
  configSchema: z.object({}) as z.ZodType<Record<string, never>>,
  defaultConfig: () => ({}),
  defaultWidth: 76,
  formAllowed: true,
  publicConfigKeys: [],
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed', 'field_becomes'],
  normalize,
  parseText: (t) => normalize(t),
  isEmpty,
  isDone: (v) => v === true,
  toText: (v) => (isEmpty(v) ? '' : v ? 'Yes' : 'No'),
  toNumber: (v) => (isEmpty(v) ? null : v ? 1 : 0),
  compare: (a, b) => emptyLast(a, b, isEmpty, (x, y) => cmpNumber(Number(x), Number(y))),
});
