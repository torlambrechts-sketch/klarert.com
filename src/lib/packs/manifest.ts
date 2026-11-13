// The pack manifest (docs/11): a sheet template grown into an installable bundle. Every object has a stable ref so an
// install can keep a ref → id map and later upgrades can find what they made: folders by ref, sheets with refs, link
// fields by `targetSheetRef` (a sheet of this pack, or `<pack>:<sheet>` of another), example items, documents and
// library items with refs (links name items by ref, never by name), automations and dashboards with refs. The sheet-
// level checks are the template's (sheetTemplateSchema runs on the manifest turned into a template).
import { z } from 'zod';
import { widgetType } from '@/engine/dashboards/registry';
import { MAX_WIDGETS } from '@/engine/dashboards/types';
import { isRequirementKey } from '@/engine/frameworks/refs';
import { SEMVER, SEMVER_RANGE } from '@/engine/packs/semver';
import { packToTemplate } from '@/engine/packs/template';
import { SHEET_REF, splitSheetRef, type PackManifest } from '@/engine/packs/types';
import { levelProblems } from '@/engine/packs/levels';
import {
  sheetTemplateSchema,
  templateAutomation,
  templateForm,
  templateItem,
  templatePerson,
  templateSheet,
} from '@/engine/templates/schema';
import type { Json } from '@/engine/types';

const ref = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use a short lower-case ref.');
const fieldKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'Use a lower-case field key.');
export const packKey = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,79}$/, 'Use lower-case letters, digits and "-".');
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

export const packItem = templateItem.extend({
  ref,
  /** link field key → refs of items of the field's target sheet */
  links: z.record(fieldKey, z.array(ref)).optional(),
  /** A framework library item (docs/12): `<framework>@<version>#<ref>`, written once into items.requirement_ref. */
  requirementRef: z
    .string()
    .refine(isRequirementKey, 'Use <framework>@<version>#<ref>.')
    .optional(),
});

/** A level key (docs/11 Levels): `starter`, `full`. */
const levelKey = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/, 'Use a short lower-case level key.');
/** `<framework>@<version>`: a framework library the pack requires. */
const libraryRef = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}@[0-9A-Za-z.-]{1,20}$/, 'Use <framework>@<version>.');
const setupCondition = z.object({
  fieldKey,
  op: z.string().min(1).max(40),
  value: json.optional(),
});
const setupTarget = z.object({
  sheetRef: ref.optional(),
  library: libraryRef.optional(),
  view: z.string().trim().min(1).max(80).optional(),
});
const setupRule = setupTarget.extend({
  where: z.array(setupCondition).max(10).optional(),
  all: z.array(setupCondition).max(10).optional(),
  min: z.number().int().min(1).max(1000).optional(),
});
const setupText = z.object({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(400),
  target: setupTarget,
  rules: z.array(setupRule).min(1).max(5),
});

export const packSheet = templateSheet.omit({ folder: true, items: true, forms: true }).extend({
  /** The folder by ref (the manifest's `folders`). */
  folder: ref.optional(),
  /** A library sheet (requirement and control link fields point at libraries). */
  isLibrary: z.boolean().default(false),
  /** A documents register (docs/02 §14): its items are controlled documents. */
  register: z.literal('documents').optional(),
  /** Restricted (docs/02 §16): only the installer (and owners) see it until people are given access. */
  restricted: z.boolean().optional(),
  /** A framework's library sheet (docs/12): stored in sheets.settings.framework. */
  framework: z
    .object({
      key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
      version: z.string().regex(/^[0-9A-Za-z.-]{1,20}$/),
      refFieldKey: fieldKey,
    })
    .optional(),
  items: z.array(packItem).max(500).default([]),
  /** The lowest level that installs this sheet (docs/11 Levels). */
  level: levelKey.optional(),
  forms: z
    .array(templateForm.extend({ level: levelKey.optional() }))
    .max(20)
    .default([]),
});

export const packAutomation = templateAutomation.extend({ ref, level: levelKey.optional() });

export const packWidget = z.object({
  ref: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  type: z.string().min(1).max(40),
  title: z.string().trim().min(1).max(80),
  sheetRef: ref.optional(),
  /** A required framework's library (`<framework>@<version>`) in place of sheetRef. */
  library: libraryRef.optional(),
  fieldKey: fieldKey.optional(),
  conditions: z
    .array(z.object({ fieldKey, op: z.string().min(1).max(40), value: json.optional() }))
    .max(10)
    .optional(),
  days: z.number().int().min(1).max(365).optional(),
});

export const packManifestSchema = z
  .object({
    key: packKey,
    version: z.string().regex(SEMVER, 'Use a version like 1.0.0.'),
    title: z.string().trim().min(1).max(120),
    description: z.string().max(2000).default(''),
    requires: z
      .array(
        z.object({
          pack: packKey,
          range: z.string().regex(SEMVER_RANGE, 'Use a range like ^1.0.0.'),
        }),
      )
      .max(20)
      .default([]),
    people: z.array(templatePerson).default([]),
    folders: z
      .array(
        z.object({
          ref,
          name: z.string().trim().min(1).max(80),
          /** Restricted (docs/02 §16): its sheets are seen by the installer (and owners) until shared. */
          restricted: z.boolean().optional(),
          level: levelKey.optional(),
        }),
      )
      .max(20)
      .default([]),
    sheets: z.array(packSheet).min(1).max(50),
    automations: z.array(packAutomation).max(200).default([]),
    dashboards: z
      .array(
        z.object({
          ref,
          name: z.string().trim().min(1).max(80),
          widgets: z.array(packWidget).max(MAX_WIDGETS),
          level: levelKey.optional(),
        }),
      )
      .max(10)
      .default([]),
    levels: z
      .array(
        z.object({
          key: levelKey,
          name: z.string().trim().min(1).max(40),
          description: z.string().trim().max(400),
        }),
      )
      .min(2)
      .max(5)
      .optional(),
    frameworks: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
          version: z.string().regex(/^[0-9A-Za-z.-]{1,20}$/),
        }),
      )
      .max(5)
      .optional(),
    setup: z
      .object({
        title: z.string().trim().min(1).max(80),
        description: z.string().trim().max(400),
        steps: z
          .array(
            setupText.extend({
              ref,
              levels: z.record(levelKey, setupText.partial()).optional(),
            }),
          )
          .min(1)
          .max(12),
      })
      .optional(),
  })
  .superRefine((m, ctx) => {
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
      m.folders.map((f) => f.ref),
      ['folders'],
      'folder ref',
    );
    unique(
      m.automations.map((a) => a.ref),
      ['automations'],
      'automation ref',
    );
    unique(
      m.dashboards.map((d) => d.ref),
      ['dashboards'],
      'dashboard ref',
    );
    const folders = new Set(m.folders.map((f) => f.ref));
    const sheets = new Map(m.sheets.map((s) => [s.ref, s]));
    const required = new Set(m.requires.map((r) => r.pack));
    for (const r of m.requires)
      if (r.pack === m.key) problem(['requires'], 'A pack cannot require itself.');

    for (const [si, s] of m.sheets.entries()) {
      const at = (...p: (string | number)[]) => ['sheets', si, ...p];
      if (s.folder && !folders.has(s.folder))
        problem(at('folder'), `Unknown folder "${s.folder}".`);
      if (s.register === 'documents' && !s.fields.some((f) => f.type === 'status'))
        problem(at('register'), 'A documents register needs a status field.');
      if (s.framework) {
        if (!s.isLibrary) problem(at('framework'), 'A framework sheet is a library.');
        if (!s.fields.some((f) => f.key === s.framework!.refFieldKey && f.type === 'text'))
          problem(
            at('framework'),
            `"${s.framework.refFieldKey}" is not a text field of the sheet.`,
          );
      }
      const prefix = s.framework ? `${s.framework.key}@${s.framework.version}#` : null;
      const seenRefs = new Set<string>();
      for (const [ii, item] of s.items.entries()) {
        if (!item.requirementRef) continue;
        if (!prefix || !item.requirementRef.startsWith(prefix))
          problem(at('items', ii), "A requirement ref belongs to the sheet's framework.");
        if (seenRefs.has(item.requirementRef))
          problem(at('items', ii), `Duplicate requirement "${item.requirementRef}".`);
        seenRefs.add(item.requirementRef);
      }
      unique(
        s.items.map((i) => i.ref),
        at('items'),
        'item ref',
      );
      const targets = new Map<string, string | null>(); // link field key → own target sheet ref (null: other pack)
      for (const [fi, f] of s.fields.entries()) {
        const raw = (f.config as Record<string, Json> | undefined)?.targetSheetRef;
        if (raw === undefined) continue;
        const split = typeof raw === 'string' ? splitSheetRef(raw, m.key) : null;
        if (!split || typeof raw !== 'string' || !SHEET_REF.test(raw)) {
          problem(at('fields', fi), `"${String(raw)}" is not a sheet ref.`);
          continue;
        }
        if (split.pack && !required.has(split.pack))
          problem(
            at('fields', fi),
            `"${raw}" names the pack "${split.pack}", which is not in requires.`,
          );
        targets.set(f.key, split.pack ? null : split.ref);
      }
      for (const [ii, item] of s.items.entries())
        for (const [key, refs] of Object.entries(item.links ?? {})) {
          if (!targets.has(key)) {
            problem(at('items', ii), `"${key}" is not a link field.`);
            continue;
          }
          const target = targets.get(key);
          if (target === null) {
            problem(
              at('items', ii),
              `"${key}" links to another pack: example links to it are not allowed.`,
            );
            continue;
          }
          const sheet = sheets.get(target!);
          for (const r of refs)
            if (!sheet?.items.some((x) => x.ref === r))
              problem(at('items', ii), `Unknown linked item "${r}" on "${target}".`);
        }
    }

    for (const [di, d] of m.dashboards.entries()) {
      unique(
        d.widgets.map((w) => w.ref),
        ['dashboards', di, 'widgets'],
        'widget ref',
      );
      for (const [wi, w] of d.widgets.entries()) {
        const at = ['dashboards', di, 'widgets', wi];
        if (!widgetType(w.type)) problem(at, `Unknown widget "${w.type}".`);
        const s = w.sheetRef ? sheets.get(w.sheetRef) : undefined;
        if (w.sheetRef && !s) problem(at, `Unknown sheet "${w.sheetRef}".`);
        if (w.sheetRef && w.library) problem(at, 'Name a sheetRef or a library, not both.');
        if (w.fieldKey && s && !s.fields.some((f) => f.key === w.fieldKey))
          problem(at, `Unknown field "${w.fieldKey}" on "${w.sheetRef}".`);
        if (w.fieldKey && !w.sheetRef && !w.library)
          problem(at, `"${w.fieldKey}" needs a sheetRef or a library.`);
      }
    }

    // levels, required frameworks and the setup checklist: every reference resolves, nothing needs a higher level
    for (const p of levelProblems(m as PackManifest)) problem(p.path, p.message);

    // everything a template checks: field refs, rules, views, tabs, forms, column groups, items, automations
    const asTemplate = sheetTemplateSchema.safeParse(packToTemplate(m as PackManifest));
    if (!asTemplate.success)
      for (const issue of asTemplate.error.issues)
        problem(issue.path as (string | number)[], issue.message);
  });

export type PackManifestInput = z.input<typeof packManifestSchema>;

/** Parse a pack manifest; throws with every problem listed. */
export function parsePack(raw: unknown): PackManifest {
  const r = packManifestSchema.safeParse(raw);
  if (r.success) return r.data;
  throw new Error(
    `Pack is not valid:\n${r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
  );
}

/** The manifest's own type is the engine's (a compile-time check that the two stay the same). */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameType: Same<z.output<typeof packManifestSchema>, PackManifest> = true;
void sameType;
