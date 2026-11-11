import { z } from 'zod';
import { base, cmpText, emptyLast, formatDate, isBlank, isIsoDate, parseDate } from './helpers';

export interface DateConfig {
  relative: boolean;
}

export const date = base<string, DateConfig>({
  id: 'date',
  label: 'Date',
  family: 'basic',
  description: 'A calendar date, such as a due date.',
  storage: 'values',
  kind: 'date',
  valueSchema: z.string().refine(isIsoDate, 'Use YYYY-MM-DD'),
  configSchema: z.object({ relative: z.boolean() }),
  defaultConfig: () => ({ relative: true }),
  defaultWidth: 120,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: true,
  triggers: ['field_changed', 'date_arrives'],
  normalize: (input) => parseDate(input),
  parseText: (t) => parseDate(t),
  isEmpty: isBlank,
  toText: (v) => (v ? formatDate(v) : ''),
  toDate: (v) => v ?? null,
  compare: (a, b) => emptyLast(a, b, isBlank, cmpText),
});

/** "in 3 days" / "today" / "2 days overdue" — the cell suffix when the item is not done (docs/03 §3.1). */
export function relativeDue(iso: string, today: string): string {
  const d = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d > 1) return `in ${d} days`;
  return d === -1 ? '1 day overdue' : `${-d} days overdue`;
}
