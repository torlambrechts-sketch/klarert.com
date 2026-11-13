// The layout an Insights view shows before anyone changes it, worked out from the sheet's fields (no sheet-specific
// content): key figures, the status breakdown and items per month, then items per owner and the overdue items.
import type { InsightRow, InsightsLayout, InsightWidget, Span } from './config';
import { defaultDateField, personField, statusField, type InsightSource } from './source';

type Draft = Omit<InsightWidget, 'id' | 'span'> & { span?: Span };

export function defaultLayout(
  s: Pick<InsightSource, 'fields' | 'ctx' | 'sheet'>,
  newId: (prefix: string) => string,
): InsightsLayout {
  const src = s as InsightSource;
  const status = statusField(src);
  const date = defaultDateField(src);
  const person = personField(src);

  const figures: Draft[] = [{ type: 'kpi', filter: 'all', title: 'Total items' }];
  if (status) figures.push({ type: 'kpi', filter: 'done', title: 'Completed' });
  if (date) {
    figures.push({ type: 'kpi', filter: 'overdue', title: 'Overdue', date: date.key });
    figures.push({ type: 'kpi', filter: 'soon', title: 'Due in 30 days', date: date.key });
  }
  const charts: Draft[] = [];
  if (status) charts.push({ type: 'bars', filter: 'all', by: status.key });
  if (date) charts.push({ type: 'cols', filter: 'all', date: date.key });
  const lists: Draft[] = [];
  if (person)
    lists.push({
      type: 'bars',
      filter: 'all',
      by: person.key,
      top: 6,
      title: `By ${person.name.toLowerCase()}`,
    });
  if (date)
    lists.push({
      type: 'list',
      filter: 'overdue',
      date: date.key,
      top: 6,
      title: 'Overdue · oldest first',
    });

  const row = (height: 's' | 'm', drafts: Draft[]): InsightRow => ({
    id: newId('r'),
    height,
    widgets: drafts.map((d) => ({
      ...d,
      id: newId('w'),
      span: (12 / drafts.length) as Span,
    })),
  });
  const rows = [row('s', figures)];
  if (charts.length) rows.push(row('m', charts));
  if (lists.length) rows.push(row('m', lists));
  return { rows };
}
