// Number: how many items match the widget's filter, or the sum or average of a number field over them.
import { filterLabel } from '../config';
import { aggregate, formatFigure, widgetItems, widgetNumberField } from '../source';
import type { InsightWidgetDef } from '../types';

const items = (n: number) => `${n.toLocaleString('en-GB')} ${n === 1 ? 'item' : 'items'}`;

export const kpi: InsightWidgetDef = {
  id: 'kpi',
  label: 'Number',
  showsFilter: false,
  rowHeight: 's',
  autoTitle(w, s) {
    const num = s ? widgetNumberField(w, s) : null;
    if (num) return `${w.agg === 'avg' ? 'Average' : 'Total'} ${num.name.toLowerCase()}`;
    return filterLabel(w.filter ?? 'all');
  },
  editor: {
    source: true,
    filter: true,
    aggregation: true,
    groupBy: false,
    date: 'filtered',
    top: null,
    columns: false,
    text: false,
  },
  compute(w, s) {
    const list = widgetItems(w, s);
    const num = widgetNumberField(w, s);
    const value = aggregate(list, num, w.agg, s.ctx);
    const filtered = (w.filter ?? 'all') !== 'all';
    const caption = num
      ? `${num.name} · ${items(list.length)}`
      : filtered
        ? `of ${items(s.items.length)}`
        : value === 1
          ? 'item'
          : 'items';
    return {
      kind: 'figure',
      value,
      display: formatFigure(value),
      caption,
      alert: w.filter === 'overdue' && !num && value > 0,
    };
  },
};
