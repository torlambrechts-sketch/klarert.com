// Saved view configuration (docs/01 FR-26, docs/02 views.config). Field references are field keys (stable, rule 5),
// so templates and copied sheets keep working. Pure; parsed with Zod wherever a config enters the app.
import { z } from 'zod';
import { insightsLayoutSchema, parseInsightsLayout } from '../insights/config';
import type { SummaryFn } from '../summaries';
import type { Condition, Json } from '../types';

/** The view types (a registry keyed by id, CLAUDE.md rule 1). */
export const VIEW_TYPES = ['table', 'insights', 'kanban', 'calendar', 'form'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const VIEW_TYPE_LABEL: Record<ViewType, string> = {
  table: 'Table',
  insights: 'Insights',
  kanban: 'Kanban',
  calendar: 'Calendar',
  form: 'Form',
};

/**
 * Former view ids, read as their replacement: the List and Grid views became the one Table view. Old `?view=list`
 * links, saved views and templates with these types open the Table.
 */
export const VIEW_TYPE_ALIASES: Readonly<Record<string, ViewType>> = {
  list: 'table',
  grid: 'table',
};

/** A stored or typed view type, aliases resolved. Null for anything else. */
export function toViewType(raw: string): ViewType | null {
  if ((VIEW_TYPES as readonly string[]).includes(raw)) return raw as ViewType;
  return VIEW_TYPE_ALIASES[raw] ?? null;
}

/**
 * The value written to `views.type`. The column's check constraint (0001_core.sql) predates the Table view and has
 * no 'table', so a Table view is stored as 'list' and read back as 'table' (toViewType).
 */
export const STORED_VIEW_TYPE: Record<ViewType, string> = {
  table: 'list',
  insights: 'insights',
  kanban: 'kanban',
  calendar: 'calendar',
  form: 'form',
};

/** A view type as an input accepts it: current ids and the former ones, read as current. */
export const viewTypeInput = z.string().transform((s, c) => {
  const t = toViewType(s);
  if (!t) {
    c.addIssue({ code: 'custom', message: 'Choose a view type.' });
    return z.NEVER;
  }
  return t;
});

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

/** A form's state as set by its owners: a draft takes nothing, open takes answers, closed stops them. */
export const FORM_STATUSES = ['draft', 'open', 'closed'] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];
/** Who may fill a form in: anyone with the link (public) or signed-in editors (internal). */
export const FORM_ACCESS = ['public', 'internal'] as const;
export type FormAccess = (typeof FORM_ACCESS)[number];
/** The six lawful bases (GDPR Art. 6); consent adds a consent checkbox to the public form. */
export const LEGAL_BASES = [
  'consent',
  'contract',
  'legal_obligation',
  'vital_interests',
  'public_task',
  'legitimate_interests',
] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];
export const LEGAL_BASIS_LABEL: Record<LegalBasis, string> = {
  consent: 'Consent',
  contract: 'Contract',
  legal_obligation: 'Legal obligation',
  vital_interests: 'Vital interests',
  public_task: 'Public task',
  legitimate_interests: 'Legitimate interests',
};

const noticeText = z.string().trim().max(2000);
/**
 * The privacy notice a public form shows (the controller is the workspace). `version` moves when its words change
 * and `reviewed*` is stamped by the database when an owner or admin marks it reviewed (0022_forms_v1.sql): a public
 * form opens only with reviewedVersion = version.
 */
export const privacyNoticeSchema = z.object({
  purpose: noticeText.optional(),
  legalBasis: z.enum(LEGAL_BASES).optional(),
  recipients: noticeText.optional(),
  retention: noticeText.optional(),
  rights: noticeText.optional(),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((u) => u === '' || /^https?:\/\/\S+$/.test(u), 'Enter a web address starting with https://')
    .optional(),
  version: z.number().int().min(1).optional(),
  reviewedVersion: z.number().int().min(1).optional(),
  reviewedAt: z.string().max(60).optional(),
  reviewedBy: z.string().max(60).nullable().optional(),
});
export type PrivacyNotice = z.infer<typeof privacyNoticeSchema>;

export const formPrefillSchema = z.object({ key, value: json });
export type FormPrefill = z.infer<typeof formPrefillSchema>;

export const formLayoutSchema = z.object({
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  /** The group new items go into; default the sheet's first group. */
  groupId: z.uuid().nullable().optional(),
  /** Label of the name question; default the sheet's item label. */
  nameLabel: z.string().trim().max(200).optional(),
  fields: z.array(formFieldSchema).max(100),
  /** Absent: draft. */
  status: z.enum(FORM_STATUSES).optional(),
  /** Absent: public (the stricter one: it needs a reviewed notice to open). */
  access: z.enum(FORM_ACCESS).optional(),
  /** ISO date-times; outside them the form takes no answers. Checked by the database too. */
  opensAt: z.string().max(40).nullable().optional(),
  closesAt: z.string().max(40).nullable().optional(),
  maxResponses: z.number().int().min(1).max(1_000_000).nullable().optional(),
  /** Shown after sending (never the answers). */
  confirmation: z.string().trim().max(1000).optional(),
  /** People told about each new answer (user ids). */
  notify: z.array(z.guid()).max(50).optional(),
  /** Hidden values set on every answer by the database, never sent by the person filling it in. */
  prefill: z.array(formPrefillSchema).max(50).optional(),
  notice: privacyNoticeSchema.optional(),
});
export type FormLayout = z.infer<typeof formLayoutSchema>;

export const SUMMARY_FNS = [
  'sum',
  'average',
  'median',
  'min',
  'max',
  'count_filled',
  'distribution',
  'distinct',
  'range',
  'count_overdue',
  'percent_checked',
  'count_checked',
  'freshness',
  'count_with_files',
  'total_links',
  'items_with_links',
] as const satisfies readonly SummaryFn[];
const summaryFnSchema = z.enum(SUMMARY_FNS);

export const viewConfigSchema = z.object({
  filters: z.array(conditionSchema).max(30).default([]),
  sort: z.array(sortSchema).max(5).default([]),
  hidden: z.array(key).max(500).default([]),
  labelFieldKey: key.optional(),
  dateFieldKey: key.optional(),
  /**
   * Table: columns with a chosen group summary, field key → function. Number, option and date columns show their
   * default summary unless listed in `summaryOff`; other columns only when listed here.
   */
  summaries: z.record(key, summaryFnSchema).optional(),
  /** Table: columns whose group summary was switched off. */
  summaryOff: z.array(key).max(500).optional(),
  form: formLayoutSchema.optional(),
  /** Insights: rows of widgets (src/engine/insights). Absent = the default layout worked out from the fields. */
  insights: insightsLayoutSchema.optional(),
});
export type ViewConfig = z.infer<typeof viewConfigSchema>;

export const emptyConfig = (): ViewConfig => ({ filters: [], sort: [], hidden: [] });

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
  const summaries = part(z.record(key, summaryFnSchema).optional(), o.summaries, undefined);
  if (summaries && Object.keys(summaries).length) cfg.summaries = summaries;
  const off = part(z.array(key).max(500).optional(), o.summaryOff, undefined);
  if (off && off.length) cfg.summaryOff = off;
  const form = part(formLayoutSchema.optional(), o.form, undefined);
  if (form) cfg.form = form;
  const insights = parseInsightsLayout(o.insights);
  if (insights) cfg.insights = insights;
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
      summaries: Object.fromEntries(
        Object.entries(c.summaries ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)),
      ),
      summaryOff: [...(c.summaryOff ?? [])].sort(),
      form: c.form ?? null,
      insights: c.insights ?? null,
    });
  return norm(a) === norm(b);
}

/**
 * The built-in views every sheet has, addressed as ?view=table … (saved views use their uuid). The former ids
 * (?view=list, ?view=grid) count too and open the Table.
 */
export const isBuiltinViewId = (id: string): boolean => toViewType(id) !== null;

/** Turn a column's group summary on (with a function) or off (also a column that shows one by default). */
export function setSummary(cfg: ViewConfig, fieldKey: string, fn: SummaryFn | null): ViewConfig {
  const next = { ...(cfg.summaries ?? {}) };
  const off = new Set(cfg.summaryOff ?? []);
  if (fn) {
    next[fieldKey] = fn;
    off.delete(fieldKey);
  } else {
    delete next[fieldKey];
    off.add(fieldKey);
  }
  const { summaries: _drop, summaryOff: _off, ...rest } = cfg;
  void _drop;
  void _off;
  return {
    ...rest,
    ...(Object.keys(next).length ? { summaries: next } : {}),
    ...(off.size ? { summaryOff: [...off].sort() } : {}),
  };
}

/** A row of `views` as the app uses it. ownerId null = shared with every member. */
export interface SavedView {
  id: string;
  sheetId: string;
  name: string;
  type: ViewType;
  config: ViewConfig;
  ownerId: string | null;
  position: string;
  /** The type the row was stored with when it is a former one ('list', 'grid'). */
  legacyType?: string;
  /** Forms: the version the database keeps (bumped by every saved change, 0022). */
  formVersion?: number;
}
