import { z } from 'zod';
import type { Field } from '../types';
import {
  base,
  cmpText,
  emptyLast,
  formatDate,
  isIsoDate,
  issue,
  parseDate,
  parseJson,
} from './helpers';

export interface TimelineValue {
  start: string;
  end: string;
}

const isEmpty = (v: TimelineValue | null) => !v || !v.start || !v.end;

function range(start: string | null, end: string | null): TimelineValue | null {
  if (!start && !end) return null;
  const s = start ?? end!;
  const e = end ?? start!;
  return e < s ? null : { start: s, end: e };
}

function parseRange(text: string): TimelineValue | null {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('{')) return normalize(parseJson(t));
  // "1 Nov 2026 – 20 Nov 2026", "01/11/2026 - 20/11/2026", "1 Nov 2026 to 20 Nov 2026"
  let parts = t.split(/\s+(?:[–—-]|to)\s+/i);
  // "2026-11-01/2026-11-20" (ISO 8601 interval), "2026-11-01–2026-11-20"
  if (parts.length === 1)
    parts = t.split(/(?<=^\d{4}-\d{2}-\d{2})\s*[/–—]\s*(?=\d{4}-\d{2}-\d{2}$)/);
  if (parts.length > 2) return null;
  const start = parseDate(parts[0]);
  const end = parts.length === 2 ? parseDate(parts[1]) : start;
  return start && end ? range(start, end) : null;
}

function normalize(input: unknown): TimelineValue | null {
  if (typeof input === 'string') return parseRange(input);
  if (typeof input === 'number') return range(parseDate(input), null);
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    const start =
      o.start === undefined || o.start === null || o.start === '' ? null : parseDate(o.start);
    const end = o.end === undefined || o.end === null || o.end === '' ? null : parseDate(o.end);
    if ((o.start && !start) || (o.end && !end)) return null;
    return range(start, end);
  }
  return null;
}

export const timeline = base<TimelineValue, Record<string, never>>({
  id: 'timeline',
  label: 'Timeline',
  family: 'basic',
  description: 'A start and end date, shown as a bar.',
  storage: 'values',
  kind: 'daterange',
  valueSchema: z
    .object({ start: z.string().refine(isIsoDate), end: z.string().refine(isIsoDate) })
    .refine((v) => v.end >= v.start, 'End is before start.'),
  configSchema: z.object({}).strict() as z.ZodType<Record<string, never>>,
  defaultConfig: () => ({}),
  defaultWidth: 170,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: true,
  triggers: ['field_changed', 'date_arrives'],
  normalize: (input) => normalize(input),
  parseText: (t) => parseRange(t),
  validate: (v, field: Field) =>
    v && v.start && v.end && v.end < v.start
      ? [issue(field, 'end_before_start', 'End is before start.')]
      : [],
  isEmpty,
  toText: (v) =>
    isEmpty(v)
      ? ''
      : v!.start === v!.end
        ? formatDate(v!.start)
        : `${formatDate(v!.start)} – ${formatDate(v!.end)}`,
  toDate: (v) => (isEmpty(v) ? null : v!.end),
  compare: (a, b) =>
    emptyLast(a, b, isEmpty, (x, y) => cmpText(x.start, y.start) || cmpText(x.end, y.end)),
});
