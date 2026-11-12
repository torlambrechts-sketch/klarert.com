// The first dashboard of a workspace, built from whatever sheets exist (no hard-coded content), laid out like the
// design's "Compliance overview": key figures over the period, done by sheet, a risk heatmap of the first sheet with
// a risk matrix field (else the first sheet's items by the field that decides done) and follow-up health. Pure.
import { itemStatusField } from '../fields/item-status';
import type { Ctx, Field, Sheet } from '../types';
import { MAX_WIDGETS, type WidgetConfig } from './types';
import { WIDGET_TYPES, widgetFieldChoices } from './registry';

export const DEFAULT_DASHBOARD_NAME = 'Compliance overview';

export function defaultWidgets(
  sheets: { sheet: Sheet; fields: Field[]; ctx: Ctx }[],
  newId: (prefix: string) => string,
): WidgetConfig[] {
  const out: WidgetConfig[] = [];
  const add = (w: Omit<WidgetConfig, 'id'>) => out.push({ id: newId('w'), ...w });
  const title = (type: string, names: { sheet?: string; field?: string } = {}) =>
    WIDGET_TYPES[type]!.defaultTitle(names);

  add({ type: 'key_figures', title: title('key_figures') });
  if (sheets.some((s) => itemStatusField(s.ctx, s.fields)))
    add({ type: 'done_by_sheet', title: title('done_by_sheet') });

  const risk = sheets
    .map((s) => ({ s, f: widgetFieldChoices('risk_heatmap', s.fields, s.ctx)[0] }))
    .find((x) => x.f);
  if (risk)
    add({
      type: 'risk_heatmap',
      title: title('risk_heatmap'),
      sheetId: risk.s.sheet.id,
      fieldKey: risk.f!.key,
    });
  else {
    const s = sheets.find((x) => widgetFieldChoices('by_option', x.fields, x.ctx).length > 0);
    if (s) {
      const options = widgetFieldChoices('by_option', s.fields, s.ctx);
      const decides = itemStatusField(s.ctx, s.fields);
      const status = options.find((f) => f.id === decides?.id) ?? options[0]!;
      add({
        type: 'by_option',
        title: title('by_option', { sheet: s.sheet.name, field: status.name }),
        sheetId: s.sheet.id,
        fieldKey: status.key,
      });
    }
  }
  add({ type: 'follow_up', title: title('follow_up') });
  return out.slice(0, MAX_WIDGETS);
}
