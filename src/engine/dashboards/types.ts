// Dashboards as data (docs/05 §4, docs/02 §1): a dashboard is a list of widget configs stored in dashboards.config.
// Widget types are a registry keyed by string id (registry.ts); each computes a result from fetched data. Pure.
import { z } from 'zod';
import type { LabelOption } from '../fields/types';
import type { Condition, Ctx, Field, Item, Json, Sheet } from '../types';

export const MAX_WIDGETS = 24;
export const MAX_DAYS = 365;
export const DEFAULT_DAYS = 30;
/** The periods a dashboard's trends can show, in months (the toolbar's switch); the first is not the default. */
export const PERIODS = [3, 6, 12] as const;
export type Period = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: Period = 12;
export const toPeriod = (raw: unknown): Period =>
  PERIODS.find((p) => String(p) === String(raw)) ?? DEFAULT_PERIOD;

const condition = z.object({
  fieldKey: z.string().min(1).max(64),
  op: z.string().min(1).max(40),
  value: z.json().optional(),
});

/** One widget as stored. Sheets by id, fields by key (keys are stable, CLAUDE.md rule 5). */
export const widgetConfigSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  type: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  title: z.string().trim().min(1).max(80),
  sheetId: z
    .string()
    .regex(/^[0-9A-Za-z-]{1,64}$/)
    .nullable()
    .optional(),
  fieldKey: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,39}$/)
    .nullable()
    .optional(),
  conditions: z.array(condition).max(10).optional(),
  days: z.number().int().min(1).max(MAX_DAYS).nullable().optional(),
});

export type WidgetConfig = z.infer<typeof widgetConfigSchema> & { conditions?: Condition[] };

export const dashboardConfigSchema = z.object({
  widgets: z.array(widgetConfigSchema).max(MAX_WIDGETS),
});

export interface DashboardConfig {
  widgets: WidgetConfig[];
}

/** A stored config read leniently: unknown shapes become an empty dashboard, broken widgets are dropped. */
export function parseDashboardConfig(raw: unknown): DashboardConfig {
  const list =
    raw && typeof raw === 'object' && Array.isArray((raw as { widgets?: unknown }).widgets)
      ? ((raw as { widgets: unknown[] }).widgets as unknown[])
      : [];
  const widgets: WidgetConfig[] = [];
  for (const w of list.slice(0, MAX_WIDGETS)) {
    const p = widgetConfigSchema.safeParse(w);
    if (p.success) widgets.push(p.data as WidgetConfig);
  }
  return { widgets };
}

/** One sheet as widgets read it: its fields, non-archived items and the Ctx built from them. */
export interface SheetSource {
  sheet: Sheet;
  fields: Field[];
  items: Item[];
  ctx: Ctx;
}

/** Everything widgets compute from. The repository fetches only what the widgets of a dashboard need. */
export interface DashboardData {
  /** ISO date in the workspace time zone. */
  today: string;
  /** The workspace time zone (item creation times become dates in it). */
  timeZone: string;
  /** The period trends show, in months. */
  months: number;
  sheet(id: string): SheetSource | undefined;
  /** Every sheet of the workspace in menu order (fetched when a widget needs `allSheets`). */
  sheets(): SheetSource[];
  /**
   * Earlier values of the fields that decide done, from the activity log (value.changed since the period began):
   * the value before the change and the ISO date of the change (workspace time zone).
   */
  changes: { itemId: string; fieldId: string; old: Json; date: string }[];
  /** Current file versions: their sheet and expiry. */
  evidence: { sheetId: string; validUntil: string | null }[];
  /** Automation runs with the ISO date they started (workspace time zone). */
  runs: { sheetId: string | null; status: string; date: string }[];
}

export type Tone = 'good' | 'warn' | 'crit' | 'neutral';

export interface Bar {
  key: string;
  label: string;
  value: number;
  /** An option of the sheet: shown with its colour dot and marks. */
  option?: LabelOption;
  /** Otherwise a tone; the label carries the meaning (colour is never the only signal). */
  tone?: Tone;
}

/** Where a row or figure leads: a sheet, the evidence library or the automations page. */
export type WidgetLink =
  { to: 'sheet'; sheetId: string } | { to: 'evidence' } | { to: 'automations' };

/** One key figure: its value now, the change over the period and the points of its line. */
export interface Figure {
  key: string;
  label: string;
  value: number;
  unit: 'percent' | 'count';
  /** The value as shown: "70%", "24". */
  display: string;
  /** Change since the start of the period; the arrow and words carry the direction, the tone says if it is good. */
  delta: { direction: 'up' | 'down' | 'flat'; text: string; spoken: string; tone: Tone };
  /** One point per month (the last is today), oldest first. */
  series: { date: string; label: string; value: number }[];
  /** A line over the chart: "Across 3 sheets · 12 of 20 items done". */
  note: string;
  link?: WidgetLink;
}

/** One row of a list widget: label, a quieter line, the value; `fill` (0-100) draws a bar behind the label. */
export interface WidgetRow {
  key: string;
  label: string;
  sub: string;
  value: string;
  /** The number the value counts, when it is a count (rows with more than 0 need attention). */
  count?: number;
  fill?: number;
  tone?: Tone;
  link?: WidgetLink;
}

export interface HeatCell {
  x: number;
  y: number;
  count: number;
  rank: 1 | 2 | 3 | 4;
  level: string;
}

export type WidgetResult =
  | { kind: 'stat'; value: number; caption: string; tone: Tone }
  | { kind: 'bars'; bars: Bar[]; total: number; caption: string }
  | { kind: 'figures'; figures: Figure[]; period: string; empty?: string }
  | {
      kind: 'rows';
      rows: WidgetRow[];
      /** Column headings over the rows, e.g. ["Sheet", "Done"]. */
      columns?: [string, string];
      /** The quiet text on the right of the card heading. */
      meta: string;
      empty?: string;
    }
  | {
      kind: 'heatmap';
      size: number;
      axes: { x: string; y: string };
      /** Rows from the top (highest y) down; each row's cells from x = 1. */
      rows: HeatCell[][];
      levels: { rank: 1 | 2 | 3 | 4; label: string; count: number }[];
      total: number;
      meta: string;
      link?: WidgetLink;
    }
  | { kind: 'problem'; message: string };

export type FieldNeed = 'option' | 'date' | 'matrix' | null;

/** The contract of one widget type. A new widget type is one file plus one registry line. */
export interface WidgetTypeDef {
  id: string;
  label: string;
  description: string;
  needs: {
    sheet: 'required' | 'optional' | 'none';
    field: FieldNeed;
    conditions: boolean;
    days: boolean;
  };
  /** Which data the repository must fetch: the widget's sheet, every sheet, files, runs, done history. */
  data: {
    items?: boolean;
    allSheets?: boolean;
    evidence?: boolean;
    runs?: boolean;
    history?: boolean;
  };
  /** Wide widgets take the whole row of the grid. Default: one column. */
  wide?: boolean;
  /** Widgets that follow the dashboard's period switch (3, 6 or 12 months). */
  usesPeriod?: boolean;
  /** The field picker's label and what it says when the sheet has no such field. */
  fieldPrompt?: { label: string; none: string };
  /** Fields of a sheet the widget can use, when it needs one. */
  fieldChoices?(fields: Field[], ctx: Ctx): Field[];
  /** A title for a new widget, from the chosen sheet and field names. */
  defaultTitle(names: { sheet?: string; field?: string; days?: number }): string;
  compute(widget: WidgetConfig, data: DashboardData): WidgetResult;
}
