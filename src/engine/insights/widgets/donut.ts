// Donut: the same breakdown as the bar list as shares of a ring, the total in the middle, a legend with percentages.
import {
  breakdown,
  formatFigure,
  round1,
  widgetGroupField,
  widgetItems,
  widgetNumberField,
} from '../source';
import type { InsightWidgetDef } from '../types';
import { bars, NO_GROUP_FIELD } from './bars';

export const donut: InsightWidgetDef = {
  ...bars,
  id: 'donut',
  label: 'Donut',
  compute(w, s) {
    const field = widgetGroupField(w, s);
    if (!field) return { kind: 'message', message: NO_GROUP_FIELD };
    const num = widgetNumberField(w, s);
    const slices = breakdown(widgetItems(w, s), field, num, w.agg, s.ctx, w.top || 8);
    const total = round1(slices.reduce((a, x) => a + x.value, 0));
    return {
      kind: 'donut',
      fieldName: field.name,
      fieldKey: field.key,
      slices: slices.map((x) => ({
        ...x,
        percent: total ? Math.round((x.value / total) * 100) : 0,
      })),
      total,
      totalDisplay: formatFigure(total),
      caption: num ? 'total' : 'items',
      filterable: s.current,
    };
  },
};
