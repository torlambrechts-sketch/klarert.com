// Helpers the widget types share. Pure.
import { matchesAll } from '../conditions';
import { addDays } from '../fields/helpers';
import { splitConditions } from '../views/apply';
import type { Item } from '../types';
import { hiddenFor } from '../values';
import type { DashboardData, SheetSource, WidgetConfig, WidgetResult } from './types';

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The widget's sheet, or a problem result when it is missing or no longer readable. */
export function sourceOf(
  w: WidgetConfig,
  data: DashboardData,
): { source: SheetSource } | { problem: WidgetResult } {
  const source = w.sheetId ? data.sheet(w.sheetId) : undefined;
  if (!source && w.sheetId && data.noAccess?.(w.sheetId))
    return {
      problem: { kind: 'problem', message: 'No access: this widget reads a sheet you cannot see.' },
    };
  if (!source)
    return {
      problem: { kind: 'problem', message: 'The sheet of this widget no longer exists.' },
    };
  // a restricted field the person may not see (docs/02 §16)
  const field = w.fieldKey ? source.fields.find((f) => f.key === w.fieldKey) : undefined;
  if (field && hiddenFor(field, source.ctx))
    return {
      problem: {
        kind: 'problem',
        message: 'Restricted: this widget reads a field you cannot see.',
      },
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
