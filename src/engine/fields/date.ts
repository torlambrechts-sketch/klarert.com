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
  defaultWidth: 160,
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
  isDeadline: (cfg) => cfg.relative === true,
});

/** "in 3 days" / "today" / "2 days overdue" — the cell suffix when the item is not done (docs/03 §3.1). */
export function relativeDue(iso: string, today: string): string {
  const d = Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000,
  );
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d > 1) return `in ${d} days`;
  return d === -1 ? '1 day overdue' : `${-d} days overdue`;
}

export interface DateCountdown {
  /** "in 65d", "today", "late 3d" or "done". */
  text: string;
  /** done: the item is done; late: the date has passed; soon: within 14 days; far: later. */
  tone: 'done' | 'late' | 'soon' | 'far';
  /** Width of the bar under the date, 0–100: full when done or late, filling up over the last 90 days. */
  pct: number;
}

/** The Table's countdown under a date (docs/05 §3.1): how long until the date, from an injected today. */
export function dateCountdown(iso: string, today: string, done: boolean): DateCountdown {
  const d = Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000,
  );
  if (done) return { text: 'done', tone: 'done', pct: 100 };
  if (d < 0) return { text: `late ${-d}d`, tone: 'late', pct: 100 };
  if (d === 0) return { text: 'today', tone: 'soon', pct: 100 };
  return {
    text: `in ${d}d`,
    tone: d <= 14 ? 'soon' : 'far',
    pct: Math.round(Math.max(6, Math.min(100, 100 - (d / 90) * 100))),
  };
}
