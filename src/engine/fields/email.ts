import { z } from 'zod';
import { base, cmpText, emptyLast, isBlank } from './helpers';

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;

/** Accepts "name@example.com", "mailto:…" and "Maria Pereira <maria@example.com>". */
function clean(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let t = input.trim();
  const angle = t.match(/<([^<>]+)>$/);
  if (angle) t = angle[1]!.trim();
  t = t.replace(/^mailto:/i, '').toLowerCase();
  return EMAIL.test(t) && t.length <= 254 ? t : null;
}

export const email = base<string, Record<string, never>>({
  id: 'email',
  label: 'Email',
  family: 'basic',
  description: 'An email address, opened as a mail link.',
  storage: 'values',
  kind: 'text',
  valueSchema: z.string().regex(EMAIL).max(254),
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
