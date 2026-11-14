// Helpers the widget types share. Pure.
import { matchesAll } from '../conditions';
import { addDays } from '../fields/helpers';
import { splitConditions } from '../views/apply';
import type { Item } from '../types';
import { hiddenFor } from '../values';
import type { DashboardData, SheetSource, WidgetConfig, WidgetResult } from './types';

/** "entry" → "entries", "process" → "processes"; otherwise an added s ("day" → "days"). */
export const pluralOf = (one: string) =>
  /[^aeiou]y$/i.test(one)
    ? `${one.slice(0, -1)}ies`
    : /(s|x|ch|sh)$/i.test(one)
      ? `${one}es`
      : `${one}s`;

export const plural = (n: number, one: string, many = pluralOf(one)) =>
  `${n} ${n === 1 ? one : many}`;

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

const filtered = (items: Item[], conditions: WidgetConfig['conditions'], source: SheetSource) => {
  const { valid } = splitConditions(conditions ?? [], source.ctx);
  return valid.length ? items.filter((i) => matchesAll(valid, i, source.ctx)) : items;
};

/** Items of the sheet the widget looks at: those in its scope, or every item (conditions on deleted fields skipped). */
export const scopedItems = (w: WidgetConfig, source: SheetSource): Item[] =>
  filtered(source.items, w.scope, source);

/** Items of the sheet in the widget's scope that match its conditions (conditions on deleted fields are skipped). */
export const matchingItems = (w: WidgetConfig, source: SheetSource): Item[] =>
  filtered(scopedItems(w, source), w.conditions, source);

/** The first day of the last `days` days, today included. */
export const sinceDay = (today: string, days: number) => addDays(today, -(days - 1));
