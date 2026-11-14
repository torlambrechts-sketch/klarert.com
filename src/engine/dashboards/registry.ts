// The widget registry (CLAUDE.md rule 1): widget types keyed by string id. A new widget type is one file in widgets/
// plus one line here. Pure.
import type { Ctx, Field } from '../types';
import { automationRuns } from './widgets/automation-runs';
import { byOption } from './widgets/by-option';
import { count } from './widgets/count';
import { doneBySheet } from './widgets/done-by-sheet';
import { evidenceStatusWidget } from './widgets/evidence-status';
import { followUp } from './widgets/follow-up';
import { keyFigures } from './widgets/key-figures';
import { overdue } from './widgets/overdue';
import { riskHeatmap } from './widgets/risk-heatmap';
import type { DashboardData, WidgetConfig, WidgetResult, WidgetTypeDef } from './types';

export const WIDGET_TYPES: Record<string, WidgetTypeDef> = {
  key_figures: keyFigures,
  done_by_sheet: doneBySheet,
  risk_heatmap: riskHeatmap,
  follow_up: followUp,
  count,
  by_option: byOption,
  overdue,
  evidence_status: evidenceStatusWidget,
  automation_runs: automationRuns,
};

export const WIDGET_ORDER = Object.keys(WIDGET_TYPES);

export const widgetType = (id: string): WidgetTypeDef | undefined =>
  Object.prototype.hasOwnProperty.call(WIDGET_TYPES, id) ? WIDGET_TYPES[id] : undefined;

/** The widget's result; unknown types and failures become a problem the card shows. */
export function computeWidget(w: WidgetConfig, data: DashboardData): WidgetResult {
  const def = widgetType(w.type);
  if (!def) return { kind: 'problem', message: 'This kind of widget is no longer available.' };
  try {
    return def.compute(w, data);
  } catch {
    return { kind: 'problem', message: 'This widget could not be calculated.' };
  }
}

/** Fields of a sheet a widget type can use (empty when it needs none). */
export function widgetFieldChoices(type: string, fields: Field[], ctx: Ctx): Field[] {
  const def = widgetType(type);
  return def?.needs.field && def.fieldChoices ? def.fieldChoices(fields, ctx) : [];
}

/** What is wrong with a widget before it is saved, or null. `sheet` looks up a readable sheet's fields and Ctx. */
export function widgetProblem(
  w: WidgetConfig,
  sheet: (id: string) => { fields: Field[]; ctx: Ctx } | undefined,
): string | null {
  const def = widgetType(w.type);
  if (!def) return 'Choose a kind of widget.';
  if (def.needs.sheet === 'none' && w.sheetId) return 'This widget does not use a sheet.';
  if (def.needs.sheet === 'required' && !w.sheetId) return 'Choose a sheet.';
  const s = w.sheetId ? sheet(w.sheetId) : undefined;
  if (w.sheetId && !s) return 'Choose a sheet of this workspace.';
  if (def.needs.field) {
    if (!w.fieldKey)
      return def.needs.field === 'date'
        ? 'Choose a date field.'
        : def.needs.field === 'matrix'
          ? 'Choose a risk matrix field.'
          : 'Choose a field.';
    if (!s || !widgetFieldChoices(w.type, s.fields, s.ctx).some((f) => f.key === w.fieldKey))
      return 'Choose a field of this sheet that the widget can use.';
  } else if (w.fieldKey) return 'This widget does not use a field.';
  if (!def.needs.conditions && ((w.conditions?.length ?? 0) > 0 || (w.scope?.length ?? 0) > 0))
    return 'This widget does not use conditions.';
  if (!def.needs.days && w.days != null) return 'This widget does not use a period.';
  return null;
}
