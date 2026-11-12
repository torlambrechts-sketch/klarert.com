import { dateOf, isItemDone, kindOf } from '../../values';
import { matchingItems, plural, sourceOf } from '../shared';
import type { WidgetTypeDef } from '../types';

/** overdue: items whose chosen date is before today and that are not done. */
export const overdue: WidgetTypeDef = {
  id: 'overdue',
  label: 'Overdue items',
  description: 'Items whose date has passed and that are not done.',
  needs: { sheet: 'required', field: 'date', conditions: true, days: false },
  data: { items: true },
  fieldChoices: (fields, ctx) => fields.filter((f) => kindOf(f, ctx) === 'date'),
  defaultTitle: ({ sheet, field }) =>
    sheet ? `${sheet}: overdue${field ? ` by ${field.toLowerCase()}` : ''}` : 'Overdue items',
  compute(w, data) {
    const s = sourceOf(w, data);
    if ('problem' in s) return s.problem;
    const { ctx } = s.source;
    const field = w.fieldKey ? ctx.fieldsByKey.get(w.fieldKey) : undefined;
    if (!field || kindOf(field, ctx) !== 'date')
      return { kind: 'problem', message: 'The date field of this widget no longer exists.' };
    const open = matchingItems(w, s.source).filter((i) => !isItemDone(i, ctx));
    const late = open.filter((i) => {
      const d = dateOf(i, field, ctx);
      return !!d && d < data.today;
    });
    return {
      kind: 'stat',
      value: late.length,
      caption: `of ${plural(open.length, 'open item')} · ${field.name} has passed`,
      tone: late.length > 0 ? 'crit' : 'good',
    };
  },
};
