import { z } from 'zod';
import { base, cmpText, emptyLast, isBlank } from './helpers';

const MAX = 20000;

/** Excel/Sheets wrap multi-line cells in quotes with doubled inner quotes. */
const unquote = (s: string) =>
  /^"[\s\S]*"$/.test(s) && /\n/.test(s) ? s.slice(1, -1).replace(/""/g, '"') : s;

const clean = (input: unknown): string | null => {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const s = unquote(String(input).replace(/\r\n?/g, '\n').trim()).trim();
  return s === '' || s.length > MAX ? null : s;
};

export const longtext = base<string, Record<string, never>>({
  id: 'longtext',
  label: 'Long text',
  family: 'basic',
  description: 'Several lines of text, such as a description or notes.',
  storage: 'values',
  kind: 'text',
  valueSchema: z.string().min(1).max(MAX),
  configSchema: z.object({}).strict() as z.ZodType<Record<string, never>>,
  defaultConfig: () => ({}),
  defaultWidth: 220,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed'],
  normalize: clean,
  parseText: clean,
  isEmpty: isBlank,
  toText: (v) => v ?? '',
  compare: (a, b) => emptyLast(a, b, isBlank, cmpText),
});

/** The first line, for the grid cell ("…" marks hidden lines). */
export function firstLine(v: string | null): string {
  if (!v) return '';
  const i = v.indexOf('\n');
  return i < 0 ? v : `${v.slice(0, i)}…`;
}
