// The first dashboard of a workspace, built from whatever sheets exist (no hard-coded content): per sheet (up to four)
// its items by the field that decides done and its overdue items by its first deadline date, then evidence status and
// automation runs for the workspace. Pure.
import { itemStatusField } from '../fields/item-status';
import type { Ctx, Field, Sheet } from '../types';
import { defOf } from '../values';
import { DEFAULT_DAYS, MAX_WIDGETS, type WidgetConfig } from './types';
import { WIDGET_TYPES, widgetFieldChoices } from './registry';

export const DEFAULT_DASHBOARD_NAME = 'Compliance overview';
const MAX_SHEETS = 4;

export function defaultWidgets(
  sheets: { sheet: Sheet; fields: Field[]; ctx: Ctx }[],
  newId: (prefix: string) => string,
): WidgetConfig[] {
  const out: WidgetConfig[] = [];
  const add = (w: Omit<WidgetConfig, 'id'>) => out.push({ id: newId('w'), ...w });
  for (const s of sheets.slice(0, MAX_SHEETS)) {
    const option = widgetFieldChoices('by_option', s.fields, s.ctx);
    const decides = itemStatusField(s.ctx, s.fields);
    const status = option.find((f) => f.id === decides?.id) ?? option[0];
    if (status)
      add({
        type: 'by_option',
        title: WIDGET_TYPES.by_option!.defaultTitle({ sheet: s.sheet.name, field: status.name }),
        sheetId: s.sheet.id,
        fieldKey: status.key,
      });
    const dates = widgetFieldChoices('overdue', s.fields, s.ctx);
    const due = dates.find((f) => defOf(f).isDeadline?.(f.config)) ?? dates[0];
    if (due)
      add({
        type: 'overdue',
        title: WIDGET_TYPES.overdue!.defaultTitle({ sheet: s.sheet.name, field: due.name }),
        sheetId: s.sheet.id,
        fieldKey: due.key,
      });
    if (!status && !due)
      add({
        type: 'count',
        title: WIDGET_TYPES.count!.defaultTitle({ sheet: s.sheet.name }),
        sheetId: s.sheet.id,
      });
  }
  add({ type: 'evidence_status', title: WIDGET_TYPES.evidence_status!.defaultTitle({}) });
  add({
    type: 'automation_runs',
    title: WIDGET_TYPES.automation_runs!.defaultTitle({ days: DEFAULT_DAYS }),
    days: DEFAULT_DAYS,
  });
  return out.slice(0, MAX_WIDGETS);
}
