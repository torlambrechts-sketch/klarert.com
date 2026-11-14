// The pack manifest (docs/11): a sheet template grown into an installable bundle. Every object has a stable ref so an
// install can keep a ref → id map and later upgrades can find what they made: folders by ref, sheets with refs, link
// fields by `targetSheetRef` (a sheet of this pack, or `<pack>:<sheet>` of another), example items, documents and
// library items with refs (links name items by ref, never by name), automations and dashboards with refs. The sheet-
// level checks are the template's (sheetTemplateSchema runs on the manifest turned into a template).
import { z } from 'zod';
import { appManifestSchema, appProblems } from '@/lib/apps/manifest';
import { widgetType } from '@/engine/dashboards/registry';
import { MAX_WIDGETS } from '@/engine/dashboards/types';
import { isRequirementKey, parseRequirementKey } from '@/engine/frameworks/refs';
import { SEMVER, SEMVER_RANGE } from '@/engine/packs/semver';
import { packToTemplate } from '@/engine/packs/template';
import { SHEET_KINDS, SHEET_REF, splitSheetRef, type PackManifest } from '@/engine/packs/types';
import { levelProblems } from '@/engine/packs/levels';
import { extendsProblems } from '@/engine/packs/extend';
import { applyPackSettings, settingProblems } from '@/engine/packs/settings';
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
  /** requirement field key → requirement keys of a required framework's library (resolved at install). */
  requirements: z
    .record(
      fieldKey,
      z.array(z.string().refine(isRequirementKey, 'Use <framework>@<version>#<ref>.')).max(50),
    )
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
  /** The folder by ref (the manifest's `folders`), or `<pack>:<folder ref>` of a pack in `requires` (a domain). */
  folder: z
    .string()
    .regex(/^(?:[a-z0-9][a-z0-9-]{0,79}:)?[a-z][a-z0-9_]{0,39}$/, 'Use a folder ref.')
    .optional(),
  /** A library sheet (requirement and control link fields point at libraries). */
  isLibrary: z.boolean().default(false),
  /** A documents register (docs/02 §14): its items are controlled documents. */
  register: z.literal('documents').optional(),
  /** Restricted (docs/02 §16): only the installer (and owners) see it until people are given access. */
  restricted: z.boolean().optional(),
  /** What the sheet is for: decides the views it ships with (docs/11 Pack quality bar). */
  kind: z.enum(SHEET_KINDS).optional(),
  /** Personal data (docs/11 Pack quality bar): installed restricted; its personal fields say `personalData`. */
  personalData: z.boolean().optional(),
  /** A framework's library sheet (docs/12): stored in sheets.settings.framework. */
  framework: z
    .object({
      key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
      version: z.string().regex(/^[0-9A-Za-z.-]{1,20}$/),
      refFieldKey: fieldKey,
    })
    .optional(),
  items: z.array(packItem).max(500).default([]),
  /**
   * Two link fields of the sheet (keys): one live item per pair of targets, kept by the database
   * (sheets.settings.uniqueLinkPair, migration 0038), e.g. one check per supplier and requirement.
   */
  uniqueLinks: z.tuple([fieldKey, fieldKey]).optional(),
  /** The lowest level that installs this sheet (docs/11 Levels). */
  level: levelKey.optional(),
  forms: z
    .array(templateForm.extend({ level: levelKey.optional() }))
    .max(20)
    .default([]),
});

/** What a pack automation adds (docs/11 Pack quality bar): test mode at install, advanced with a description. */
const automationMeta = {
  startInTestMode: z.boolean().optional(),
  advanced: z.boolean().optional(),
  description: z.string().trim().min(1).max(400).optional(),
};

export const packAutomation = templateAutomation.extend({
  ref,
  level: levelKey.optional(),
  ...automationMeta,
});

const labelColor = templateSheet.shape.groups.element.shape.color;
const extensionOption = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use a short lower-case option id.'),
  label: z.string().trim().min(1).max(80),
  color: labelColor.optional(),
  done: z.boolean().optional(),
});

/** What a pack adds to a sheet of a pack it requires (docs/11 Extends). */
export const packExtension = z.object({
  pack: packKey,
  sheet: ref,
  fields: templateSheet.shape.fields.optional(),
  groups: z.array(templateSheet.shape.groups.element).max(20).optional(),
  views: z.array(templateSheet.shape.views.unwrap().element).max(20).optional(),
  forms: z.array(templateForm).max(10).optional(),
  items: z.array(packItem).max(100).optional(),
  automations: z
    .array(templateAutomation.omit({ sheet: true }).extend({ ref, ...automationMeta }))
    .max(50)
    .optional(),
  options: z.record(fieldKey, z.array(extensionOption).min(1).max(50)).optional(),
});

export const packWidget = z.object({
  ref: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  type: z.string().min(1).max(40),
  title: z.string().trim().min(1).max(80),
  /** A sheet of this pack, or `<pack>:<sheet>` of a pack in `requires` (an add-on's widget on a Core register). */
  sheetRef: z.string().regex(SHEET_REF, 'Use a sheet ref.').optional(),
  /** A required framework's library (`<framework>@<version>`) in place of sheetRef. */
  library: libraryRef.optional(),
  fieldKey: fieldKey.optional(),
  conditions: z
    .array(z.object({ fieldKey, op: z.string().min(1).max(40), value: json.optional() }))
    .max(10)
    .optional(),
  days: z.number().int().min(1).max(365).optional(),
});

const settingKey = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use a short lower-case key.');
/** A pack setting (docs/11 Pack settings): choices shipped as data that set defaults in the pack's own sheets. */
export const packSetting = z.object({
  key: settingKey,
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(600),
  values: z
    .array(z.object({ key: settingKey, label: z.string().trim().min(1).max(80) }))
    .min(1)
    .max(20),
  choices: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'Use a short lower-case id.'),
        label: z.string().trim().min(1).max(80),
        group: z.string().trim().min(1).max(60).optional(),
        values: z.record(settingKey, z.string().max(1000)),
        verified: z.boolean().default(false),
        checkedOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        note: z.string().trim().max(800).optional(),
        sources: z
          .array(z.object({ title: z.string().trim().min(1).max(200), url: z.string().url() }))
          .max(6)
          .default([]),
      }),
    )
    .min(1)
    .max(60),
  default: z.string().max(40).optional(),
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
          /** A domain folder of shared registers (docs/11 Core registers): listed under Registers. */
          domain: z
            .string()
            .regex(/^[a-z][a-z0-9_-]{0,39}$/, 'Use a short lower-case domain key.')
            .optional(),
        }),
      )
      .max(20)
      .default([]),
    sheets: z.array(packSheet).max(50),
    automations: z.array(packAutomation).max(200).default([]),
    dashboards: z
      .array(
        z.object({
          ref,
          name: z.string().trim().min(1).max(80),
          widgets: z.array(packWidget).max(MAX_WIDGETS),
          level: levelKey.optional(),
          /** The pack's headline dashboard (docs/11 Pack quality bar). */
          headline: z.boolean().optional(),
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
          /**
           * Soft: never adopted for you. Example links into it are written only where the workspace has adopted
           * it; widgets and setup steps may not read it.
           */
          optional: z.boolean().optional(),
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
    /** Apps (docs/13): navigation over the pack's sheets, forms and dashboards. */
    apps: z.array(appManifestSchema).max(5).optional(),
    /** A system pack (Core registers): shared registers with system columns (docs/11 Core registers). */
    system: z.boolean().optional(),
    /** The standard an add-on stands for: a Standards option and a saved view on the sheets it extends. */
    standard: z
      .object({
        id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use a short lower-case id.'),
        label: z.string().trim().min(1).max(40),
        color: labelColor.optional(),
      })
      .optional(),
    /** What this pack adds to sheets of packs it requires (docs/11 Extends). */
    extends: z.array(packExtension).max(30).optional(),
    /** Why the pack ships no intake forms (docs/11 Pack quality bar). */
    formsNotApplicable: z.string().trim().min(1).max(200).optional(),
    /** Choices a workspace makes for the pack (docs/11 Pack settings). */
    settings: z.array(packSetting).max(5).optional(),
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
    const libraries = new Set((m.frameworks ?? []).map((f) => `${f.key}@${f.version}`));
    for (const r of m.requires)
      if (r.pack === m.key) problem(['requires'], 'A pack cannot require itself.');

    for (const [si, s] of m.sheets.entries()) {
      const at = (...p: (string | number)[]) => ['sheets', si, ...p];
      if (s.folder && s.folder.includes(':')) {
        const [pack] = s.folder.split(':');
        if (!required.has(pack!))
          problem(
            at('folder'),
            `"${s.folder}" names the pack "${pack}", which is not in requires.`,
          );
      } else if (s.folder && !folders.has(s.folder))
        problem(at('folder'), `Unknown folder "${s.folder}".`);
      if (s.uniqueLinks) {
        const linkTypes = new Set(['link', 'requirement', 'controllink']);
        if (s.uniqueLinks[0] === s.uniqueLinks[1])
          problem(at('uniqueLinks'), 'Name two different link fields.');
        for (const k of s.uniqueLinks)
          if (!s.fields.some((f) => f.key === k && linkTypes.has(f.type)))
            problem(at('uniqueLinks'), `"${k}" is not a link field of the sheet.`);
      }
      if (s.personalData) {
        if (s.restricted === false)
          problem(at('restricted'), 'A sheet with personal data is always installed restricted.');
        if (!s.fields.some((f) => (f.config as { personalData?: unknown })?.personalData === true))
          problem(
            at('personalData'),
            'Mark the fields that hold personal data with config.personalData.',
          );
      }
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
        for (const [key, keys] of Object.entries(item.requirements ?? {})) {
          const f = s.fields.find((x) => x.key === key);
          if (!f || (f.type !== 'requirement' && f.type !== 'controllink')) {
            problem(at('items', ii), `"${key}" is not a requirement field.`);
            continue;
          }
          for (const k of keys) {
            const id = parseRequirementKey(k);
            if (!id || !libraries.has(`${id.framework}@${id.version}`))
              problem(
                at('items', ii),
                `"${k}" is not in a framework the pack builds on (frameworks).`,
              );
          }
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

    // example links of extension items into a required library: through a requirement field the entry adds
    for (const [ei, e] of (m.extends ?? []).entries())
      for (const [ii, item] of (e.items ?? []).entries())
        for (const [key, keys] of Object.entries(item.requirements ?? {})) {
          const at = ['extends', ei, 'items', ii];
          const f = (e.fields ?? []).find((x) => x.key === key);
          if (!f || (f.type !== 'requirement' && f.type !== 'controllink')) {
            problem(at, `"${key}" is not a requirement field this entry adds.`);
            continue;
          }
          for (const k of keys) {
            const id = parseRequirementKey(k);
            if (!id || !libraries.has(`${id.framework}@${id.version}`))
              problem(at, `"${k}" is not in a framework the pack builds on (frameworks).`);
          }
        }

    // an advanced automation says what it does in plain words
    const allAutomations = [
      ...m.automations.map((a, i) => ({ a, path: ['automations', i] })),
      ...(m.extends ?? []).flatMap((e, ei) =>
        (e.automations ?? []).map((a, i) => ({ a, path: ['extends', ei, 'automations', i] })),
      ),
    ];
    for (const { a, path } of allAutomations)
      if (a.advanced && !a.description)
        problem(path, 'An advanced automation needs a description in plain words.');

    for (const [di, d] of m.dashboards.entries()) {
      unique(
        d.widgets.map((w) => w.ref),
        ['dashboards', di, 'widgets'],
        'widget ref',
      );
      for (const [wi, w] of d.widgets.entries()) {
        const at = ['dashboards', di, 'widgets', wi];
        if (!widgetType(w.type)) problem(at, `Unknown widget "${w.type}".`);
        const split = w.sheetRef ? splitSheetRef(w.sheetRef, m.key) : null;
        const s = split && !split.pack ? sheets.get(split.ref) : undefined;
        if (split?.pack && !required.has(split.pack))
          problem(at, `"${w.sheetRef}" names the pack "${split.pack}", which is not in requires.`);
        else if (w.sheetRef && !split?.pack && !s) problem(at, `Unknown sheet "${w.sheetRef}".`);
        if (w.sheetRef && w.library) problem(at, 'Name a sheetRef or a library, not both.');
        if (w.fieldKey && s && !s.fields.some((f) => f.key === w.fieldKey))
          problem(at, `Unknown field "${w.fieldKey}" on "${w.sheetRef}".`);
        if (w.fieldKey && !w.sheetRef && !w.library)
          problem(at, `"${w.fieldKey}" needs a sheetRef or a library.`);
      }
    }

    // apps: keys once each, every ref one of the pack's
    unique(
      (m.apps ?? []).map((a) => a.key),
      ['apps'],
      'app key',
    );
    for (const [ai, app] of (m.apps ?? []).entries())
      for (const p of appProblems(app, m as PackManifest))
        problem(['apps', ai, ...p.path], p.message);

    // levels, required frameworks and the setup checklist: every reference resolves, nothing needs a higher level
    for (const p of levelProblems(m as PackManifest)) problem(p.path, p.message);

    // extends: into required packs only, in the pack's namespace, links and inverses that resolve
    if (!m.sheets.length && !m.extends?.length)
      problem(['sheets'], 'A pack needs a sheet or an extends entry.');
    for (const p of extendsProblems(m as PackManifest)) problem(p.path, p.message);

    // settings: unique keys and choices, tokens that name a setting value, on the pack's own text fields
    for (const p of settingProblems(m as PackManifest)) problem(p.path, p.message);

    // everything a template checks: field refs, rules, views, tabs, forms, column groups, items, automations (with
    // each setting at its first choice, so `$setting:` tokens are checked as the values they become)
    if (m.sheets.length) {
      const first = Object.fromEntries(
        (m.settings ?? []).map((s) => [s.key, s.default ?? s.choices[0]!.id]),
      );
      const asTemplate = sheetTemplateSchema.safeParse(
        packToTemplate(applyPackSettings(m as PackManifest, first)),
      );
      if (!asTemplate.success)
        for (const issue of asTemplate.error.issues)
          problem(issue.path as (string | number)[], issue.message);
    }
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
