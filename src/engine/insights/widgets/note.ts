// Note: plain text for context, targets or instructions. Reads no data.
import type { InsightWidgetDef } from '../types';

export const note: InsightWidgetDef = {
  id: 'note',
  label: 'Note',
  showsFilter: false,
  static: true,
  rowHeight: 'm',
  autoTitle: () => 'Note',
  editor: {
    source: false,
    filter: false,
    aggregation: false,
    groupBy: false,
    date: false,
    top: null,
    columns: false,
    text: true,
  },
  compute: (w) => ({ kind: 'note', text: w.text?.trim() ?? '' }),
};
