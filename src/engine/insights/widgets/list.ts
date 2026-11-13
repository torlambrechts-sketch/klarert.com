// Item list: the first items by a date field (soonest or oldest first), with up to three fields after the name.
import type { Field, Item } from '../../types';
import { compareItems, defOf, keysOf, kindOf, textOf } from '../../values';
import { MAX_LIST_COLUMNS, filterLabel } from '../config';
import {
  listFields,
  personField,
  statusField,
  widgetDateField,
  widgetItems,
  type InsightSource,
} from '../source';
import type { InsightWidgetDef, ListCell } from '../types';
import { TOP_CHOICES } from './bars';

/** The fields a list shows when it names none: status, the date it sorts by, the owner. */
export function defaultListColumns(s: InsightSource, date: Field | null): string[] {
  const out: string[] = [];
  for (const f of [statusField(s), date, personField(s)])
    if (f && !out.includes(f.key)) out.push(f.key);
  return out.slice(0, MAX_LIST_COLUMNS);
}

function cell(item: Item, field: Field, s: InsightSource): ListCell {
  const text = textOf(item, field, s.ctx);
  const kind = kindOf(field, s.ctx);
  if (kind === 'option' || kind === 'ordered') {
    const k = keysOf(item, field, s.ctx)[0];
    const option = k
      ? defOf(field)
          .options?.(field.config, s.ctx)
          .find((o) => o.id === k)
      : undefined;
    if (option) return { text: option.label, option };
  }
  return { text };
}

export const list: InsightWidgetDef = {
  id: 'list',
  label: 'Item list',
  showsFilter: false,
  rowHeight: 'm',
  autoTitle: (w) => filterLabel(w.filter ?? 'all'),
  editor: {
    source: true,
    filter: true,
    aggregation: false,
    groupBy: false,
    date: 'always',
    top: { label: 'Rows', choices: TOP_CHOICES, fallback: 5 },
    columns: true,
    text: false,
  },
  compute(w, s) {
    const date = widgetDateField(w, s);
    const allowed = listFields(s);
    const keys = w.columns ?? defaultListColumns(s, date);
    const columns = keys
      .map((k) => allowed.find((f) => f.key === k))
      .filter((f): f is Field => !!f)
      .slice(0, MAX_LIST_COLUMNS);
    const sorted = [...widgetItems(w, s)];
    if (date) sorted.sort(compareItems(date, s.ctx, 'asc'));
    const n = w.top || 5;
    return {
      kind: 'list',
      columns: columns.map((f) => ({ key: f.key, name: f.name })),
      rows: sorted.slice(0, n).map((it) => ({
        itemId: it.id,
        displayId: it.displayId,
        name: it.name,
        cells: columns.map((f) => cell(it, f, s)),
      })),
      more: Math.max(0, sorted.length - n),
      sheetId: s.sheet.id,
      current: s.current,
    };
  },
};
