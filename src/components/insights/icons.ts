import {
  ChartBar,
  ChartColumn,
  ChartPie,
  Gauge,
  Hash,
  List,
  Type,
  type LucideIcon,
} from 'lucide-react';
import type { InsightWidgetType } from '@/engine/insights';

/** The icon of each Insights widget type in the type picker (a map keyed by the registry's ids). */
export const WIDGET_ICONS: Record<InsightWidgetType, LucideIcon> = {
  kpi: Hash,
  bars: ChartBar,
  cols: ChartColumn,
  donut: ChartPie,
  progress: Gauge,
  list: List,
  note: Type,
};
