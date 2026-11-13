// The Insights widget types, keyed by string id (CLAUDE.md rule 1): a new widget type is one file in widgets/ plus one
// line here. `computeWidget` resolves the widget's sheet and hands it to its type.
import type { InsightWidget, InsightWidgetType } from './config';
import type { InsightsData, InsightSource } from './source';
import type { InsightModel, InsightWidgetDef } from './types';
import { bars } from './widgets/bars';
import { cols } from './widgets/cols';
import { donut } from './widgets/donut';
import { kpi } from './widgets/kpi';
import { list } from './widgets/list';
import { note } from './widgets/note';
import { progress } from './widgets/progress';

export const INSIGHT_WIDGETS: Record<InsightWidgetType, InsightWidgetDef> = {
  kpi,
  bars,
  cols,
  donut,
  progress,
  list,
  note,
};

export const widgetDef = (type: InsightWidgetType): InsightWidgetDef => INSIGHT_WIDGETS[type];

/** The sheet a widget reads: its own source, else the view's sheet. */
export function widgetSource(
  w: InsightWidget,
  data: InsightsData,
): InsightSource | 'loading' | null {
  if (!w.src || w.src === data.current.sheet.id) return data.current;
  return data.sheet(w.src);
}

export function computeWidget(w: InsightWidget, data: InsightsData): InsightModel {
  const def = widgetDef(w.type);
  if (def.static) return def.compute(w, data.current);
  const s = widgetSource(w, data);
  if (s === 'loading') return { kind: 'loading' };
  if (!s) return { kind: 'unavailable' };
  return def.compute(w, s);
}

/** The widget's title: its own, else what its type calls it. */
export function widgetTitle(w: InsightWidget, data: InsightsData): string {
  if (w.title?.trim()) return w.title.trim();
  const s = widgetSource(w, data);
  return widgetDef(w.type).autoTitle(w, s && s !== 'loading' ? s : undefined);
}
