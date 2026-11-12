// Calendar view (docs/05 §3.3, FR-24): a month grid, Monday first, and items placed on the days they span. Pure:
// dates are ISO strings (YYYY-MM-DD); "today" comes from the Ctx.
import { addDays } from '../fields/helpers';
import { calendarSpan } from '../fields/view-support';
import type { Ctx, Field, Item } from '../types';

export interface CalendarDay {
  date: string;
  /** Day of the month, 1–31. */
  day: number;
  inMonth: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Weeks (Monday → Sunday) covering the month; `month` is 1–12. Leading/trailing days belong to the next months. */
export function monthGrid(year: number, month: number): CalendarDay[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const start = addDays(iso(year, month, 1), -lead);
  const cells = Math.ceil((lead + days) / 7) * 7;
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < cells; i += 1) {
    const date = addDays(start, i);
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    if (i % 7 === 0) weeks.push([]);
    weeks.at(-1)!.push({ date, day: d, inMonth: y === year && m === month });
  }
  return weeks;
}

export const monthOf = (date: string) => {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return { year: y, month: m };
};

export function shiftMonth(year: number, month: number, by: number) {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export interface CalendarEntry {
  item: Item;
  start: string;
  end: string;
}

/** Items with a span on this field, sorted by start then name. Items without a date are left out. */
export function calendarEntries(items: Item[], field: Field, ctx: Ctx): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const item of items) {
    const span = calendarSpan(item, field, ctx);
    if (span) out.push({ item, start: span.start, end: span.end });
  }
  return out.sort((a, b) =>
    a.start !== b.start
      ? a.start < b.start
        ? -1
        : 1
      : a.item.name.localeCompare(b.item.name, 'en-GB'),
  );
}

/** date → entries that cover it, for the visible days only (a span shows on every day it covers). */
export function entriesByDay(
  entries: CalendarEntry[],
  weeks: CalendarDay[][],
): Map<string, CalendarEntry[]> {
  const map = new Map<string, CalendarEntry[]>();
  const first = weeks[0]?.[0]?.date;
  const last = weeks.at(-1)?.at(-1)?.date;
  if (!first || !last) return map;
  for (const day of weeks.flat()) map.set(day.date, []);
  for (const e of entries) {
    if (e.end < first || e.start > last) continue;
    let d = e.start < first ? first : e.start;
    const stop = e.end > last ? last : e.end;
    while (d <= stop) {
      map.get(d)?.push(e);
      d = addDays(d, 1);
    }
  }
  return map;
}
