// Done over time for trend widgets (docs/02 §6: the activity log keeps every earlier value). An item's value of the
// field that decides done, at the end of a day, is the value before the first change after that day, else its value
// now; an item counts from the day it was created. Pure: the time zone and dates come in.
import { itemStatusField } from '../fields/item-status';
import { isoDateInZone } from '../fields/helpers';
import type { Item } from '../types';
import { isItemDone } from '../values';
import type { DashboardData, SheetSource } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Points for a trend over `months` months: the last day of each month, oldest first, ending today. */
export function monthPoints(today: string, months: number): { date: string; label: string }[] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const out: { date: string; label: string }[] = [];
  for (let back = months - 1; back >= 0; back -= 1) {
    const idx = y * 12 + (m - 1) - back;
    const yy = Math.floor(idx / 12);
    const mm = (idx % 12) + 1;
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    out.push({
      date: back === 0 ? today : `${yy}-${pad(mm)}-${pad(last)}`,
      label: MONTHS[mm - 1]!,
    });
  }
  return out;
}

/** "Dec 2025 to Nov 2026" for a trend's points. */
export function periodLabel(points: { date: string }[]): string {
  const fmt = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
  return points.length ? `${fmt(points[0]!.date)} to ${fmt(points[points.length - 1]!.date)}` : '';
}

export interface SheetHistory {
  /** Items that existed at the end of `date`, and how many of them were done then. */
  at(date: string): { total: number; done: number; open: number; added: (from: string) => number };
  /** Whether the sheet has a field that decides done. */
  decides: boolean;
}

/** The history of one sheet: its items at any day of the period, from the changes in `data`. */
export function sheetHistory(source: SheetSource, data: DashboardData): SheetHistory {
  const field = itemStatusField(source.ctx, source.fields);
  const created = new Map(
    source.items.map((i) => [i.id, isoDateInZone(i.createdAt, data.timeZone)] as const),
  );
  const changes = new Map<string, { date: string; old: unknown }[]>();
  if (field)
    for (const c of data.changes) {
      if (c.fieldId !== field.id || !created.has(c.itemId)) continue;
      const list = changes.get(c.itemId) ?? [];
      list.push({ date: c.date, old: c.old });
      changes.set(c.itemId, list);
    }
  for (const list of changes.values()) list.sort((a, b) => (a.date < b.date ? -1 : 1));

  const doneAt = (item: Item, date: string) => {
    if (!field) return false;
    const later = changes.get(item.id)?.find((c) => c.date > date);
    const then = later
      ? { ...item, values: { ...item.values, [field.id]: later.old as Item['values'][string] } }
      : item;
    return isItemDone(then, source.ctx);
  };

  return {
    decides: !!field,
    at(date) {
      let total = 0;
      let done = 0;
      for (const item of source.items) {
        if ((created.get(item.id) ?? '') > date) continue;
        total += 1;
        if (doneAt(item, date)) done += 1;
      }
      return {
        total,
        done,
        open: total - done,
        added: (from) =>
          source.items.filter((i) => {
            const c = created.get(i.id) ?? '';
            return c >= from && c <= date;
          }).length,
      };
    },
  };
}
