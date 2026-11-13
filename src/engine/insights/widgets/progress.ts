// Progress: the share of items done (decided by the item status field), with the split by status.
import { defOf, keysOf } from '../../values';
import { isDone, statusField, widgetItems } from '../source';
import type { InsightWidgetDef } from '../types';

export const NO_STATUS_FIELD = 'This sheet has no status field.';

export const progress: InsightWidgetDef = {
  id: 'progress',
  label: 'Progress',
  showsFilter: true,
  rowHeight: 'm',
  autoTitle: () => 'Completion',
  editor: {
    source: true,
    filter: false,
    aggregation: false,
    groupBy: false,
    date: 'filtered',
    top: null,
    columns: false,
    text: false,
    hint(_w, s) {
      const f = statusField(s);
      return `Share of completed items, split by ${(f?.name ?? 'status').toLowerCase()}.`;
    },
  },
  compute(w, s) {
    const field = statusField(s);
    if (!field) return { kind: 'message', message: NO_STATUS_FIELD };
    const list = widgetItems(w, s);
    const done = list.filter((it) => isDone(it, s)).length;
    const counts = new Map<string, number>();
    for (const it of list)
      for (const k of keysOf(it, field, s.ctx)) counts.set(k, (counts.get(k) ?? 0) + 1);
    const segments = (defOf(field).options?.(field.config, s.ctx) ?? [])
      .map((o) => ({
        key: o.id,
        label: o.label,
        value: counts.get(o.id) ?? 0,
        color: o.color,
        option: o,
      }))
      .filter((x) => x.value > 0);
    return {
      kind: 'progress',
      percent: list.length ? Math.round((done / list.length) * 100) : 0,
      done,
      total: list.length,
      fieldName: field.name,
      segments,
    };
  },
};
