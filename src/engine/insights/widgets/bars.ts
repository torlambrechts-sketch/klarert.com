// Bar list: items per value of a field (status, dropdown, people, checkbox …), longest bar = largest figure.
import { breakdown, widgetGroupField, widgetItems, widgetNumberField } from '../source';
import type { InsightWidgetDef } from '../types';

export const NO_GROUP_FIELD =
  'This sheet has no status, dropdown, people or checkbox field to group by.';
export const TOP_CHOICES = [
  { value: 5, label: '5' },
  { value: 8, label: '8' },
  { value: 12, label: '12' },
];

export const bars: InsightWidgetDef = {
  id: 'bars',
  label: 'Bar list',
  showsFilter: true,
  rowHeight: 'm',
  autoTitle(w, s) {
    const f = s ? widgetGroupField(w, s) : null;
    return f ? `By ${f.name.toLowerCase()}` : 'Breakdown';
  },
  editor: {
    source: true,
    filter: true,
    aggregation: true,
    groupBy: true,
    date: 'filtered',
    top: { label: 'Show top', choices: TOP_CHOICES, fallback: 8 },
    columns: false,
    text: false,
  },
  compute(w, s) {
    const field = widgetGroupField(w, s);
    if (!field) return { kind: 'message', message: NO_GROUP_FIELD };
    const slices = breakdown(
      widgetItems(w, s),
      field,
      widgetNumberField(w, s),
      w.agg,
      s.ctx,
      w.top || 8,
    );
    return {
      kind: 'bars',
      fieldName: field.name,
      fieldKey: field.key,
      slices,
      max: Math.max(1, ...slices.map((x) => x.value)),
      filterable: s.current,
    };
  },
};
