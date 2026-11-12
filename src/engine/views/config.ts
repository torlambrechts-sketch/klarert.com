// Saved view configuration (docs/01 FR-26, docs/02 views.config). Field references are field keys (stable, rule 5),
// so templates and copied sheets keep working. Pure; parsed with Zod wherever a config enters the app.
import { z } from 'zod';
import type { Condition, Json } from '../types';

export const VIEW_TYPES = ['list', 'grid', 'kanban', 'calendar', 'form'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const VIEW_TYPE_LABEL: Record<ViewType, string> = {
  list: 'List',
  grid: 'Grid',
  kanban: 'Kanban',
  calendar: 'Calendar',
  form: 'Form',
};

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

const key = z.string().min(1).max(64);
const json: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(json),
    z.record(z.string(), json),
  ]),
);

export const conditionSchema = z.object({
  fieldKey: key,
  op: z.string().min(1).max(40),
  value: json.optional(),
});

export const sortSchema = z.object({ fieldKey: key, dir: z.enum(['asc', 'desc']) });
export type SortRule = z.infer<typeof sortSchema>;

export const formFieldSchema = z.object({
  key,
  label: z.string().trim().max(200).optional(),
  help: z.string().trim().max(1000).optional(),
  required: z.boolean().optional(),
});
export type FormFieldLayout = z.infer<typeof formFieldSchema>;

export const formLayoutSchema = z.object({
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  /** The group new items go into; default the sheet's first group. */
  groupId: z.uuid().nullable().optional(),
  /** Label of the name question; default the sheet's item label. */
  nameLabel: z.string().trim().max(200).optional(),
  fields: z.array(formFieldSchema).max(100),
});
export type FormLayout = z.infer<typeof formLayoutSchema>;

export const viewConfigSchema = z.object({
  filters: z.array(conditionSchema).max(30).default([]),
  sort: z.array(sortSchema).max(5).default([]),
  hidden: z.array(key).max(500).default([]),
  labelFieldKey: key.optional(),
  dateFieldKey: key.optional(),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(25),
  form: formLayoutSchema.optional(),
});
export type ViewConfig = z.infer<typeof viewConfigSchema>;

export const emptyConfig = (): ViewConfig => ({ filters: [], sort: [], hidden: [], pageSize: 25 });

/**
 * Read a stored config. Unknown keys are dropped; a broken part falls back to its default instead of losing the
 * whole view (a template written by hand, a field deleted since).
 */
export function parseViewConfig(raw: unknown): ViewConfig {
  const whole = viewConfigSchema.safeParse(raw ?? {});
  if (whole.success) return whole.data;
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const part = <T>(schema: z.ZodType<T>, v: unknown, fallback: T): T => {
    const r = schema.safeParse(v);
    return r.success ? r.data : fallback;
  };
  const cfg = emptyConfig();
  cfg.filters = part(z.array(conditionSchema).max(30), o.filters, []) as Condition[];
  cfg.sort = part(z.array(sortSchema).max(5), o.sort, []);
  cfg.hidden = part(z.array(key).max(500), o.hidden, []);
  const label = part(key.optional(), o.labelFieldKey, undefined);
  if (label) cfg.labelFieldKey = label;
  const date = part(key.optional(), o.dateFieldKey, undefined);
  if (date) cfg.dateFieldKey = date;
  cfg.pageSize = part(z.union([z.literal(25), z.literal(50), z.literal(100)]), o.pageSize, 25);
  const form = part(formLayoutSchema.optional(), o.form, undefined);
  if (form) cfg.form = form;
  return cfg;
}

/** Same config, ignoring key order: decides whether a draft differs from what is saved. */
export function sameConfig(a: ViewConfig, b: ViewConfig): boolean {
  const norm = (c: ViewConfig) =>
    JSON.stringify({
      filters: c.filters,
      sort: c.sort,
      hidden: [...c.hidden].sort(),
      labelFieldKey: c.labelFieldKey ?? null,
      dateFieldKey: c.dateFieldKey ?? null,
      pageSize: c.pageSize,
      form: c.form ?? null,
    });
  return norm(a) === norm(b);
}

/** The built-in views every sheet has, addressed as ?view=list … (saved views use their uuid). */
export const isBuiltinViewId = (id: string): id is ViewType =>
  (VIEW_TYPES as readonly string[]).includes(id);

/** A row of `views` as the app uses it. ownerId null = shared with every member. */
export interface SavedView {
  id: string;
  sheetId: string;
  name: string;
  type: ViewType;
  config: ViewConfig;
  ownerId: string | null;
  position: string;
}
