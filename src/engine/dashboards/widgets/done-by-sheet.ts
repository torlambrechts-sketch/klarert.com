import { itemStatusField } from '../../fields/item-status';
import { isItemDone } from '../../values';
import { plural } from '../shared';
import type { WidgetRow, WidgetTypeDef } from '../types';
import { countItems } from '../../nouns';

/** Sheets listed at most: the first in menu order that have a field that decides done. */
const MAX_SHEETS = 6;

/** done_by_sheet: per sheet with a field that decides done, the share of its items that are done. */
export const doneBySheet: WidgetTypeDef = {
  id: 'done_by_sheet',
  label: 'Done by sheet',
  description:
    'The first six sheets with a status field and the share of their items that are done.',
  needs: { sheet: 'none', field: null, conditions: false, days: false },
  data: { allSheets: true },
  defaultTitle: () => 'Done by sheet',
  compute(_w, data) {
    const rows: { row: WidgetRow; pct: number; order: number }[] = [];
    const deciding = data.sheets().filter((s) => itemStatusField(s.ctx, s.fields));
    deciding.slice(0, MAX_SHEETS).forEach((s, order) => {
      const total = s.items.length;
      const done = s.items.filter((i) => isItemDone(i, s.ctx)).length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      rows.push({
        pct,
        order,
        row: {
          key: s.sheet.id,
          label: s.sheet.name,
          sub: `${done} of ${countItems(total, s.sheet.itemLabel)} done`,
          value: `${pct}%`,
          fill: pct,
          link: { to: 'sheet', sheetId: s.sheet.id },
        },
      });
    });
    rows.sort((a, b) => b.pct - a.pct || a.order - b.order);
    return {
      kind: 'rows',
      rows: rows.map((r) => r.row),
      columns: ['Sheet', 'Done'],
      meta:
        deciding.length > rows.length
          ? `${rows.length} of ${deciding.length} sheets`
          : plural(rows.length, 'sheet'),
      empty: 'No sheet has a status field yet.',
    };
  },
};
