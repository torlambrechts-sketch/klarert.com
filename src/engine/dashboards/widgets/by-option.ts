import { stageFields } from '../../workflow';
import { laneOptions } from '../../fields/view-support';
import { keysOf } from '../../values';
import { matchingItems, sourceOf } from '../shared';
import type { Bar, WidgetTypeDef } from '../types';
import { countItems } from '../../nouns';

/** by_option: items per option of a label field (status, dropdown, priority …), as bars. */
export const byOption: WidgetTypeDef = {
  id: 'by_option',
  label: 'Items by label',
  description: 'Bars with the number of items per option of a status or label field.',
  needs: { sheet: 'required', field: 'option', conditions: true, days: false },
  data: { items: true },
  fieldChoices: stageFields,
  defaultTitle: ({ sheet, field }) =>
    sheet && field ? `${sheet} by ${field.toLowerCase()}` : 'Items by label',
  compute(w, data) {
    const s = sourceOf(w, data);
    if ('problem' in s) return s.problem;
    const { ctx } = s.source;
    const field = w.fieldKey ? ctx.fieldsByKey.get(w.fieldKey) : undefined;
    const options = field ? laneOptions(field, ctx) : null;
    if (!field || !options)
      return { kind: 'problem', message: 'The field of this widget no longer exists.' };
    const items = matchingItems(w, s.source);
    const bars: Bar[] = options.map((o) => ({ key: o.id, label: o.label, value: 0, option: o }));
    const byKey = new Map(bars.map((b) => [b.key, b]));
    let none = 0;
    for (const item of items) {
      const bar = byKey.get(keysOf(item, field, ctx)[0] ?? '');
      if (bar) bar.value += 1;
      else none += 1;
    }
    if (none > 0) bars.push({ key: '__none', label: 'No value', value: none, tone: 'neutral' });
    return {
      kind: 'bars',
      bars,
      total: items.length,
      caption: `${countItems(items.length, s.source.sheet.itemLabel)} in ${s.source.sheet.name}`,
    };
  },
};
