// Helpers the widget types share. Pure.
import { matchesAll } from '../conditions';
import { addDays } from '../fields/helpers';
import { splitConditions } from '../views/apply';
import type { Item } from '../types';
import type { DashboardData, SheetSource, WidgetConfig, WidgetResult } from './types';

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The widget's sheet, or a problem result when it is missing or no longer readable. */
export function sourceOf(
  w: WidgetConfig,
  data: DashboardData,
): { source: SheetSource } | { problem: WidgetResult } {
  const source = w.sheetId ? data.sheet(w.sheetId) : undefined;
  if (!source)
    return {
      problem: { kind: 'problem', message: 'The sheet of this widget no longer exists.' },
    };
  return { source };
}

/** Items of the sheet that match the widget's conditions (conditions on deleted fields are skipped). */
export function matchingItems(w: WidgetConfig, source: SheetSource): Item[] {
  const { valid } = splitConditions(w.conditions ?? [], source.ctx);
  return valid.length ? source.items.filter((i) => matchesAll(valid, i, source.ctx)) : source.items;
}

/** The first day of the last `days` days, today included. */
export const sinceDay = (today: string, days: number) => addDays(today, -(days - 1));
