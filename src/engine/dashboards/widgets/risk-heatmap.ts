import { defOf } from '../../values';
import { matchingItems, sourceOf } from '../shared';
import type { HeatCell, WidgetTypeDef } from '../types';
import { countItems } from '../../nouns';

/** risk_heatmap: items placed on the grid of a matrix field (likelihood by impact), counted per cell. */
export const riskHeatmap: WidgetTypeDef = {
  id: 'risk_heatmap',
  label: 'Risk heatmap',
  description: 'Items on the grid of a risk matrix field, counted per cell and per level.',
  needs: { sheet: 'required', field: 'matrix', conditions: true, days: false },
  data: { items: true },
  fieldPrompt: { label: 'Risk matrix field', none: 'This sheet has no risk matrix field' },
  fieldChoices: (fields) => fields.filter((f) => !!defOf(f).matrix),
  defaultTitle: ({ sheet }) => (sheet ? `${sheet}: risk heatmap` : 'Risk heatmap'),
  compute(w, data) {
    const s = sourceOf(w, data);
    if ('problem' in s) return s.problem;
    const { ctx } = s.source;
    const field = w.fieldKey ? ctx.fieldsByKey.get(w.fieldKey) : undefined;
    const matrix = field ? defOf(field).matrix : undefined;
    if (!field || !matrix)
      return { kind: 'problem', message: 'The risk matrix field of this widget no longer exists.' };
    const size = Math.max(1, Math.min(10, matrix.size(field.config)));
    const counts = new Map<string, number>();
    let total = 0;
    for (const item of matchingItems(w, s.source)) {
      const c = matrix.cell((item.values[field.id] ?? null) as never);
      if (!c || c.x < 1 || c.y < 1 || c.x > size || c.y > size) continue;
      counts.set(`${c.x}:${c.y}`, (counts.get(`${c.x}:${c.y}`) ?? 0) + 1);
      total += 1;
    }
    const levels = new Map<number, { rank: 1 | 2 | 3 | 4; label: string; count: number }>();
    const rows: HeatCell[][] = [];
    for (let y = size; y >= 1; y -= 1) {
      const row: HeatCell[] = [];
      for (let x = 1; x <= size; x += 1) {
        const { rank, label } = matrix.level(x, y, field.config);
        const count = counts.get(`${x}:${y}`) ?? 0;
        const lv = levels.get(rank) ?? { rank, label, count: 0 };
        lv.count += count;
        levels.set(rank, lv);
        row.push({ x, y, count, rank, level: label });
      }
      rows.push(row);
    }
    return {
      kind: 'heatmap',
      size,
      axes: matrix.axes,
      rows,
      levels: [...levels.values()].sort((a, b) => a.rank - b.rank),
      total,
      meta: `${field.name} · ${countItems(total, s.source.sheet.itemLabel)}`,
      link: { to: 'sheet', sheetId: s.source.sheet.id },
    };
  },
};
