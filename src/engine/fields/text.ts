import { z } from 'zod';
import { base, cmpText, emptyLast, isBlank } from './helpers';

const MAX = 500;
const clean = (input: unknown): string | null => {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const s = String(input).replace(/\s+/g, ' ').trim();
  return s === '' || s.length > MAX ? null : s;
};

export const text = base<string, Record<string, never>>({
  id: 'text',
  label: 'Text',
  family: 'basic',
  description: 'A single line of text.',
  storage: 'values',
  kind: 'text',
  valueSchema: z.string().min(1).max(MAX),
  configSchema: z.object({}) as z.ZodType<Record<string, never>>,
  defaultConfig: () => ({}),
  defaultWidth: 180,
  formAllowed: true,
  publicConfigKeys: [],
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed'],
  normalize: clean,
  parseText: clean,
  isEmpty: isBlank,
  toText: (v) => v ?? '',
  compare: (a, b) => emptyLast(a, b, isBlank, cmpText),
});
