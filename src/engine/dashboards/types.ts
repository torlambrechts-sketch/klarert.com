// Dashboards as data (docs/05 §4, docs/02 §1): a dashboard is a list of widget configs stored in dashboards.config.
// Widget types are a registry keyed by string id (registry.ts); each computes a result from fetched data. Pure.
import { z } from 'zod';
import type { LabelOption } from '../fields/types';
import type { Condition, Ctx, Field, Item, Sheet } from '../types';

export const MAX_WIDGETS = 24;
export const MAX_DAYS = 365;
export const DEFAULT_DAYS = 30;

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
  sheet(id: string): SheetSource | undefined;
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

export type WidgetResult =
  | { kind: 'stat'; value: number; caption: string; tone: Tone }
  | { kind: 'bars'; bars: Bar[]; total: number; caption: string }
  | { kind: 'problem'; message: string };

export type FieldNeed = 'option' | 'date' | null;

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
  /** Which data the repository must fetch. */
  data: { items?: boolean; evidence?: boolean; runs?: boolean };
  /** Fields of a sheet the widget can use, when it needs one. */
  fieldChoices?(fields: Field[], ctx: Ctx): Field[];
  /** A title for a new widget, from the chosen sheet and field names. */
  defaultTitle(names: { sheet?: string; field?: string; days?: number }): string;
  compute(widget: WidgetConfig, data: DashboardData): WidgetResult;
}
