// The Insights view's layout (docs/05 §3.6, docs/02 views.config.insights): rows of widgets on a 12-column grid. Field
// references are field keys (stable, CLAUDE.md rule 5); another source sheet is referenced by id. Pure; parsed with
// Zod wherever a layout enters the app.
import { z } from 'zod';

/** Widget types, in the order the editor offers them. The registry (registry.ts) implements every one. */
export const INSIGHT_WIDGET_TYPES = [
  'kpi',
  'bars',
  'cols',
  'donut',
  'progress',
  'list',
  'note',
] as const;
export type InsightWidgetType = (typeof INSIGHT_WIDGET_TYPES)[number];

/** Widths a widget may take, in twelfths of the row, with their names. */
export const SPANS = [
  { span: 3, label: '1/4' },
  { span: 4, label: '1/3' },
  { span: 6, label: '1/2' },
  { span: 8, label: '2/3' },
  { span: 9, label: '3/4' },
  { span: 12, label: 'Full' },
] as const;
export type Span = (typeof SPANS)[number]['span'];
export const SPAN_VALUES = SPANS.map((s) => s.span) as readonly Span[];
export const spanLabel = (span: number) =>
  SPANS.find((s) => s.span === span)?.label ?? `${span}/12`;

/** Column layouts a row can switch to (the add-row picker and each row's layout control). */
export const ROW_LAYOUTS: readonly (readonly Span[])[] = [
  [12],
  [6, 6],
  [4, 4, 4],
  [3, 3, 3, 3],
  [8, 4],
  [4, 8],
];
export const layoutLabel = (spans: readonly number[]) => spans.map(spanLabel).join(' + ');

/** Row heights: small rows suit numbers, large rows long lists. */
export const ROW_HEIGHTS = [
  { id: 's', label: 'S', name: 'Small' },
  { id: 'm', label: 'M', name: 'Medium' },
  { id: 'l', label: 'L', name: 'Large' },
] as const;
export type RowHeight = (typeof ROW_HEIGHTS)[number]['id'];

/** Which items a widget counts. */
export const INSIGHT_FILTERS = [
  { id: 'all', label: 'All items' },
  { id: 'open', label: 'Open items' },
  { id: 'done', label: 'Completed' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'soon', label: 'Due in 30 days' },
] as const;
export type InsightFilter = (typeof INSIGHT_FILTERS)[number]['id'];
export const filterLabel = (f: InsightFilter) =>
  INSIGHT_FILTERS.find((x) => x.id === f)?.label ?? 'All items';
/** Filters that read a date field. */
export const DATED_FILTERS: readonly InsightFilter[] = ['overdue', 'soon'];
export const SOON_DAYS = 30;

export const AGGREGATIONS = [
  { id: 'count', label: 'Count of items' },
  { id: 'sum', label: 'Sum of a number' },
  { id: 'avg', label: 'Average of a number' },
] as const;
export type Aggregation = (typeof AGGREGATIONS)[number]['id'];

export const MAX_ROWS = 12;
export const MAX_WIDGETS_PER_ROW = 4;
export const MAX_NOTE = 2000;
export const MAX_TITLE = 80;
export const MAX_LIST_COLUMNS = 3;
export const MAX_TOP = 50;

const key = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'Choose a field.');
const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

const spanSchema = z.custom<Span>(
  (v) => typeof v === 'number' && (SPAN_VALUES as readonly number[]).includes(v),
  'Choose a width.',
);

export const insightWidgetSchema = z.object({
  id,
  type: z.enum(INSIGHT_WIDGET_TYPES),
  span: spanSchema,
  title: z.string().trim().max(MAX_TITLE).optional(),
  /** Another sheet's id; absent = the sheet the view belongs to. */
  src: z.uuid().optional(),
  filter: z.enum(['all', 'open', 'done', 'overdue', 'soon']).default('all'),
  agg: z.enum(['count', 'sum', 'avg']).optional(),
  /** The number field summed or averaged. */
  num: key.optional(),
  /** The field bars and donuts group by. */
  by: key.optional(),
  /** The date field of the overdue/soon filters, the column chart and the list's order. */
  date: key.optional(),
  /** Bars, donuts and lists: how many entries; column charts: the last N months (0 = all). */
  top: z.number().int().min(0).max(MAX_TOP).optional(),
  /** Item list: the fields shown after the name. */
  columns: z.array(key).max(MAX_LIST_COLUMNS).optional(),
  /** Note: plain text. */
  text: z.string().max(MAX_NOTE, `Keep a note under ${MAX_NOTE} characters.`).optional(),
});
export type InsightWidget = z.infer<typeof insightWidgetSchema>;

export const rowPlanSchema = z
  .array(spanSchema)
  .min(1)
  .max(MAX_WIDGETS_PER_ROW)
  .refine((l) => l.reduce((a, b) => a + b, 0) <= 12, 'The columns are wider than the row.');

export const insightRowSchema = z
  .object({
    id,
    height: z.enum(['s', 'm', 'l']).optional(),
    /** The column plan chosen for the row: empty places show "Add widget" at these widths. */
    layout: rowPlanSchema.optional(),
    widgets: z
      .array(insightWidgetSchema)
      .max(MAX_WIDGETS_PER_ROW, `A row holds at most ${MAX_WIDGETS_PER_ROW} widgets.`),
  })
  .refine((r) => rowWidth(r.widgets) <= 12, {
    message: 'The widgets of a row are wider than the row.',
    path: ['widgets'],
  });
export type InsightRow = z.infer<typeof insightRowSchema>;

export const insightsLayoutSchema = z.object({
  rows: z.array(insightRowSchema).max(MAX_ROWS, `A layout holds at most ${MAX_ROWS} rows.`),
});
export type InsightsLayout = z.infer<typeof insightsLayoutSchema>;

export const rowWidth = (widgets: readonly { span: number }[]) =>
  widgets.reduce((n, w) => n + w.span, 0);

/**
 * Read a stored layout leniently: a broken widget is dropped, a row that no longer fits loses its last widgets, and
 * anything past the limits is cut. Null when there is no layout at all (the view then shows the default).
 */
export function parseInsightsLayout(raw: unknown): InsightsLayout | null {
  const whole = insightsLayoutSchema.safeParse(raw);
  if (whole.success) return whole.data;
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { rows?: unknown }).rows))
    return null;
  const rows: InsightRow[] = [];
  for (const r of ((raw as { rows: unknown[] }).rows ?? []).slice(0, MAX_ROWS)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const rid = id.safeParse(o.id);
    if (!rid.success) continue;
    const widgets: InsightWidget[] = [];
    for (const w of Array.isArray(o.widgets) ? o.widgets : []) {
      const p = insightWidgetSchema.safeParse(w);
      if (!p.success) continue;
      if (widgets.length >= MAX_WIDGETS_PER_ROW || rowWidth(widgets) + p.data.span > 12) break;
      widgets.push(p.data);
    }
    const height = z.enum(['s', 'm', 'l']).safeParse(o.height);
    const plan = rowPlanSchema.safeParse(o.layout);
    rows.push({
      id: rid.data,
      ...(height.success ? { height: height.data } : {}),
      ...(plan.success && plan.data ? { layout: plan.data } : {}),
      widgets,
    });
  }
  return { rows };
}

/** Plain-language problems of a layout, for a toast; empty when it is valid. */
export function layoutProblems(layout: unknown): string[] {
  const p = insightsLayoutSchema.safeParse(layout);
  return p.success ? [] : [...new Set(p.error.issues.map((i) => i.message))];
}
