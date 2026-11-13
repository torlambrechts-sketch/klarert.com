import { matchingItems, plural, pluralOf, sourceOf } from '../shared';
import type { WidgetTypeDef } from '../types';

/** count: items in a sheet that match conditions. */
export const count: WidgetTypeDef = {
  id: 'count',
  label: 'Item count',
  description: 'How many items of a sheet match the conditions you set.',
  needs: { sheet: 'required', field: null, conditions: true, days: false },
  data: { items: true },
  defaultTitle: ({ sheet }) => (sheet ? `${sheet}: items` : 'Items'),
  compute(w, data) {
    const s = sourceOf(w, data);
    if ('problem' in s) return s.problem;
    const n = matchingItems(w, s.source).length;
    const total = s.source.items.length;
    return {
      kind: 'stat',
      value: n,
      caption:
        (w.conditions?.length ?? 0) > 0
          ? `of ${plural(total, s.source.sheet.itemLabel.toLowerCase())} in ${s.source.sheet.name}`
          : `${pluralOf(s.source.sheet.itemLabel.toLowerCase())} in ${s.source.sheet.name}`,
      tone: 'neutral',
    };
  },
};
