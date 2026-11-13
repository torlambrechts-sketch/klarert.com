import { z } from 'zod';
import { ACTION_IDS, TRIGGER_IDS } from '@/engine/automations';
import { isFieldTypeId } from '@/engine/fields/registry';
import type { Json } from '@/engine/types';
import { toViewType, viewTypeInput } from '@/engine/views/config';
import { MAX_TABS, tabLabelSchema } from '@/engine/views/tabs';
import { ID_PREFIX, LABEL_COLORS } from '@/lib/schemas/sheets';

// Sheet templates (templates/*.json, docs/07 Part B): people, a folder, sheets with fields, groups, views and items,
// and automations, all cross-referenced by `ref` and field `key`. The schema checks the shape and every reference so
// the importer can trust what it reads; tokens ($person:, $option:, $item:, $in:N, $today) are resolved by the
// planner (plan.ts).

const json: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(json), z.record(z.string(), json)]),
);
const ref = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use a short lower-case ref.');
const fieldKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'Use a lower-case field key.');
const color = z.enum(LABEL_COLORS);

const condition = z.object({ fieldKey, op: z.string().min(1), value: json.optional() });

export const templatePerson = z.object({
  ref,
  email: z.email(),
  name: z.string().min(1).max(120),
  initials: z.string().min(1).max(3),
  jobRole: z.string().min(1).max(120),
  team: z.string().min(1).max(120),
  role: z.enum(['owner', 'admin', 'editor', 'viewer']),
});

export const templateField = z.object({
  key: fieldKey,
  name: z.string().min(1).max(120),
  type: z.string().refine(isFieldTypeId, 'Unknown field type.'),
  required: z.boolean().optional(),
  locked: z.boolean().optional(),
  description: z.string().max(2000).optional(),
  config: z.record(z.string(), json).optional(),
  rules: z
    .array(
      z.object({
        id: z.string().min(1),
        whenFieldKey: fieldKey,
        whenValues: z.array(json).min(1),
        require: z.array(fieldKey).optional(),
        requireComment: z.boolean().optional(),
        message: z.string().optional(),
        fromDone: z.boolean().optional(),
      }),
    )
    .optional(),
  visibility: condition.optional(),
});

export const templateItem = z.object({
  group: ref,
  name: z.string().min(1).max(500),
  values: z.record(fieldKey, json).default({}),
  /** link field key → `$item:<sheetRef>:<name>` tokens */
  links: z.record(fieldKey, z.array(z.string())).optional(),
});

/**
 * A sheet's sub-item set (docs/02 §12): what its sub-items are called, the gates, the sub-items' own fields and the
 * template set "From template" adds (values by child field key; $in:N and $today resolve when it is applied).
 * Shared by sheet templates and the wizard's starts.
 */
export const subitemSetSchema = z
  .object({
    label: z.string().trim().min(1).max(40).default('Sub-items'),
    blockClose: z.boolean().default(false),
    lockCascade: z.boolean().default(false),
    fields: z.array(templateField).min(1).max(40),
    items: z
      .array(z.object({ name: z.string().min(1).max(500), values: z.record(fieldKey, json).default({}) }))
      .max(50)
      .default([]),
  })
  .superRefine((set, ctx) => {
    const keys = new Set(set.fields.map((f) => f.key));
    if (keys.size !== set.fields.length)
      ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Duplicate sub-item field key.' });
    for (const [fi, f] of set.fields.entries())
      for (const r of f.rules ?? [])
        for (const k of [r.whenFieldKey, ...(r.require ?? [])])
          if (!keys.has(k))
            ctx.addIssue({
              code: 'custom',
              path: ['fields', fi],
              message: `Rule names unknown sub-item field "${k}".`,
            });
    for (const [ii, item] of set.items.entries())
      for (const k of Object.keys(item.values))
        if (!keys.has(k))
          ctx.addIssue({ code: 'custom', path: ['items', ii], message: `Unknown sub-item field "${k}".` });
  });
export type SubitemSet = z.infer<typeof subitemSetSchema>;

/** A starting tab of a template sheet or a wizard start (resolved by resolveTemplateTabs). */
export const templateTab = z.object({
  ref: z.string().min(1).max(80),
  hidden: z.boolean().optional(),
  label: tabLabelSchema.optional(),
});

export const templateSheet = z.object({
  ref,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  itemLabel: z.string().min(1).max(60),
  idPrefix: z.string().regex(ID_PREFIX),
  groups: z.array(z.object({ ref, name: z.string().min(1).max(80), color })).min(1),
  fields: z.array(templateField).max(200),
  views: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        type: viewTypeInput,
        config: z.record(z.string(), json).default({}),
      }),
    )
    .default([]),
  items: z.array(templateItem).default([]),
  /**
   * The sheet's starting tabs (sheets.settings.tabs): `ref` is a built-in view type or the name of a view above. The
   * built-in views left out are added hidden (they stay in More). Stored as the sheet's template default too.
   */
  tabs: z.array(templateTab).min(1).max(MAX_TABS).optional(),
  /** The tab that opens first (a `ref` as in `tabs`); default the Table. */
  defaultView: z.string().min(1).max(80).optional(),
  /** Sub-items for this sheet: a hidden child sheet with these fields (docs/02 §12). */
  subitems: subitemSetSchema.optional(),
});

export const templateAutomation = z.object({
  sheet: ref,
  name: z.string().min(1).max(200),
  enabled: z.boolean().default(true),
  trigger: z.object({ type: z.enum(TRIGGER_IDS as [string, ...string[]]) }).catchall(json),
  conditions: z.array(condition).max(20).default([]),
  actions: z
    .array(z.object({ type: z.enum(ACTION_IDS as [string, ...string[]]) }).catchall(json))
    .min(1)
    .max(10),
});

const ITEM_TOKEN = /^\$item:([a-z][a-z0-9_]*):(.+)$/;
const PERSON_TOKEN = /^\$person:(.+)$/;

/** Every `$person:<ref>` string anywhere in a JSON value. */
function personRefs(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') {
    const m = v.match(PERSON_TOKEN);
    if (m) out.push(m[1]!);
  } else if (Array.isArray(v)) v.forEach((x) => personRefs(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => personRefs(x, out));
  return out;
}

export const sheetTemplateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,80}$/),
    version: z.number().int().min(1),
    description: z.string().max(2000).default(''),
    people: z.array(templatePerson).default([]),
    folder: z.string().min(1).max(120),
    sheets: z.array(templateSheet).min(1),
    automations: z.array(templateAutomation).default([]),
    tokens: z.record(z.string(), z.string()).optional(),
    importer: z.object({ rules: z.string(), order: z.string() }).optional(),
  })
  .superRefine((t, ctx) => {
    const problem = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const unique = (list: string[], path: (string | number)[], what: string) => {
      const seen = new Set<string>();
      for (const x of list) {
        if (seen.has(x)) problem(path, `Duplicate ${what} "${x}".`);
        seen.add(x);
      }
    };
    unique(
      t.people.map((p) => p.ref),
      ['people'],
      'person ref',
    );
    unique(
      t.sheets.map((s) => s.ref),
      ['sheets'],
      'sheet ref',
    );
    unique(
      t.sheets.map((s) => s.idPrefix),
      ['sheets'],
      'ID prefix',
    );
    const people = new Set(t.people.map((p) => p.ref));
    const sheets = new Map(t.sheets.map((s) => [s.ref, s]));

    for (const [si, s] of t.sheets.entries()) {
      const at = (...p: (string | number)[]) => ['sheets', si, ...p];
      unique(
        s.fields.map((f) => f.key),
        at('fields'),
        'field key',
      );
      unique(
        s.groups.map((g) => g.ref),
        at('groups'),
        'group ref',
      );
      const keys = new Map(s.fields.map((f) => [f.key, f]));
      const groups = new Set(s.groups.map((g) => g.ref));
      for (const [fi, f] of s.fields.entries()) {
        const cfg = (f.config ?? {}) as Record<string, Json>;
        if (typeof cfg.targetSheetRef === 'string') {
          const target = sheets.get(cfg.targetSheetRef);
          if (!target) problem(at('fields', fi), `Unknown sheet "${cfg.targetSheetRef}".`);
          else if (typeof cfg.inverseKey === 'string') {
            const inv = target.fields.find((x) => x.key === cfg.inverseKey);
            const back = (inv?.config ?? {}) as Record<string, Json>;
            if (!inv || back.targetSheetRef !== s.ref || back.inverseKey !== f.key)
              problem(at('fields', fi), `The inverse "${cfg.inverseKey}" must link back to "${f.key}".`);
          }
        }
        for (const k of ['sourceFieldKey', 'linkFieldKey'] as const)
          if (typeof cfg[k] === 'string' && !keys.has(cfg[k]))
            problem(at('fields', fi), `Unknown field "${cfg[k]}".`);
        for (const r of f.rules ?? [])
          for (const k of [r.whenFieldKey, ...(r.require ?? [])])
            if (!keys.has(k)) problem(at('fields', fi), `Rule names unknown field "${k}".`);
        if (f.visibility && !keys.has(f.visibility.fieldKey))
          problem(at('fields', fi), `Visibility names unknown field "${f.visibility.fieldKey}".`);
      }
      for (const [vi, v] of s.views.entries())
        for (const k of ['labelFieldKey', 'dateFieldKey'] as const) {
          const key = v.config[k];
          if (typeof key === 'string' && !keys.has(key))
            problem(at('views', vi), `Unknown field "${key}".`);
        }
      const viewNames = new Set(s.views.map((v) => v.name));
      const tabRef = (r: string) => toViewType(r) !== null || viewNames.has(r);
      for (const [ti, tab] of (s.tabs ?? []).entries())
        if (!tabRef(tab.ref)) problem(at('tabs', ti), `Unknown view "${tab.ref}".`);
      if (s.defaultView !== undefined) {
        const tab = s.tabs?.find((x) => x.ref === s.defaultView);
        if (!tabRef(s.defaultView)) problem(at('defaultView'), `Unknown view "${s.defaultView}".`);
        else if (tab?.hidden) problem(at('defaultView'), 'The view that opens first cannot be hidden.');
      }
      for (const [ii, item] of s.items.entries()) {
        if (!groups.has(item.group)) problem(at('items', ii), `Unknown group "${item.group}".`);
        for (const k of Object.keys(item.values))
          if (!keys.has(k)) problem(at('items', ii), `Unknown field "${k}".`);
        for (const [k, targets] of Object.entries(item.links ?? {})) {
          const f = keys.get(k);
          const target = (f?.config ?? {}) as Record<string, Json>;
          if (!f || typeof target.targetSheetRef !== 'string') {
            problem(at('items', ii), `"${k}" is not a link field.`);
            continue;
          }
          for (const token of targets) {
            const m = token.match(ITEM_TOKEN);
            const sheet = m && sheets.get(m[1]!);
            if (!m || m[1] !== target.targetSheetRef || !sheet?.items.some((x) => x.name === m[2]))
              problem(at('items', ii), `Unknown linked item "${token}".`);
          }
        }
        for (const p of personRefs(item.values))
          if (!people.has(p)) problem(at('items', ii), `Unknown person "${p}".`);
      }
    }

    for (const [ai, a] of t.automations.entries()) {
      const s = sheets.get(a.sheet);
      if (!s) {
        problem(['automations', ai], `Unknown sheet "${a.sheet}".`);
        continue;
      }
      for (const action of a.actions) {
        const target = typeof action.sheetRef === 'string' ? sheets.get(action.sheetRef) : s;
        if (!target) problem(['automations', ai], `Unknown sheet "${String(action.sheetRef)}".`);
        else if (
          typeof action.groupRef === 'string' &&
          !target.groups.some((g) => g.ref === action.groupRef)
        )
          problem(['automations', ai], `Unknown group "${action.groupRef}".`);
      }
      for (const p of personRefs([a.trigger, a.conditions, a.actions] as unknown as Json))
        if (!people.has(p)) problem(['automations', ai], `Unknown person "${p}".`);
    }
  });

export type SheetTemplate = z.infer<typeof sheetTemplateSchema>;
export type TemplateSheet = SheetTemplate['sheets'][number];
export type TemplateField = TemplateSheet['fields'][number];
export type TemplateAutomation = SheetTemplate['automations'][number];

/** Parse a template file's JSON; throws with every problem listed. */
export function parseTemplate(raw: unknown): SheetTemplate {
  const r = sheetTemplateSchema.safeParse(raw);
  if (r.success) return r.data;
  throw new Error(
    `Template is not valid:\n${r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
  );
}
