// Column chart: items per month of a date field (timelines by their end), oldest month first.
import { formatDate } from '../../fields/helpers';
import { dateOf } from '../../values';
import { widgetDateField, widgetItems } from '../source';
import type { InsightWidgetDef } from '../types';

export const NO_DATE_FIELD = 'This sheet has no date field.';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const cols: InsightWidgetDef = {
  id: 'cols',
  label: 'Column chart',
  showsFilter: true,
  rowHeight: 'm',
  autoTitle(w, s) {
    const d = s ? widgetDateField(w, s) : null;
    return `By month${d ? ` · ${d.name.toLowerCase()}` : ''}`;
  },
  editor: {
    source: true,
    filter: true,
    aggregation: false,
    groupBy: false,
    date: 'always',
    top: {
      label: 'Months',
      choices: [
        { value: 6, label: 'Last 6' },
        { value: 12, label: 'Last 12' },
        { value: 0, label: 'All' },
      ],
      fallback: 0,
    },
    columns: false,
    text: false,
  },
  compute(w, s) {
    const field = widgetDateField(w, s);
    if (!field) return { kind: 'message', message: NO_DATE_FIELD };
    const months = new Map<string, number>();
    for (const it of widgetItems(w, s)) {
      const d = dateOf(it, field, s.ctx);
      if (!d) continue;
      const k = d.slice(0, 7);
      months.set(k, (months.get(k) ?? 0) + 1);
    }
    let keys = [...months.keys()].sort();
    if (w.top) keys = keys.slice(-w.top);
    if (!keys.length) return { kind: 'message', message: 'No dates in range.' };
    const columns = keys.map((k) => ({
      key: k,
      label: `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`,
      // "Nov 2026", for screen readers and tooltips
      name: formatDate(`${k}-01`).replace(/^1 /, ''),
      value: months.get(k)!,
    }));
    return {
      kind: 'columns',
      fieldName: field.name,
      columns,
      max: Math.max(1, ...columns.map((c) => c.value)),
    };
  },
};
