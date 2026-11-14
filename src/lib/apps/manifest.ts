// The app manifest (docs/13), validated by Zod at load: an app inside a pack manifest (`apps`) or a templates/apps
// file that names the pack it needs. `appProblems` checks every ref against the pack: sheets, sub-items, saved views,
// forms, dashboards and the field keys filters, sorts and rows name.
import { z } from 'zod';
import { OPERATORS, SPECIAL_KEYS } from '@/engine/conditions';
import {
  APP_ICONS,
  APP_ROLES,
  type AppFile,
  type AppManifest,
  type AppScreen,
} from '@/engine/apps/types';
import { SEMVER_RANGE } from '@/engine/packs/semver';
import type { PackManifest } from '@/engine/packs/types';
import type { Json } from '@/engine/types';

const appKey = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Use lower-case letters, digits and "-".');
const screenKey = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,39}$/, 'Use a short lower-case screen key (letters, digits, "-").');
/** A sheet of the pack, or `<pack>:<sheet>` of a pack it requires (an add-on's app over the Core registers). */
const sheetRef = z
  .string()
  .regex(
    /^(?:[a-z0-9][a-z0-9-]{0,79}:)?[a-z][a-z0-9_]{0,39}$/,
    'Use a sheet ref of the pack or <pack>:<sheet> of a pack it requires.',
  );
const fieldKey = z
  .string()
  .regex(/^(?:[a-z][a-z0-9_]{0,63}|__name|__group|__id|__missing)$/, 'Use a field key.');
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
const roles = z.array(z.enum(APP_ROLES)).min(1).max(APP_ROLES.length).optional();
const KNOWN_OPS = new Set(Object.values(OPERATORS).flat());

const base = {
  key: screenKey,
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().max(400).optional(),
  roles,
};
const filter = z.object({
  fieldKey,
  op: z.string().refine((op) => KNOWN_OPS.has(op), 'Unknown operator.'),
  value: json.optional(),
});
const sort = z.object({ fieldKey, direction: z.enum(['asc', 'desc']).optional() });

export const appScreenSchema = z.discriminatedUnion('kind', [
  z.object({
    ...base,
    kind: z.literal('view'),
    sheet: sheetRef,
    subitems: z.boolean().optional(),
    view: z.string().trim().min(1).max(80).optional(),
  }),
  z.object({
    ...base,
    kind: z.literal('item'),
    sheet: sheetRef,
    subitems: z.boolean().optional(),
    filters: z.array(filter).max(10),
    sort: z.array(sort).max(3).optional(),
    show: z.array(fieldKey).max(6).optional(),
    empty: z.string().trim().min(1).max(200).optional(),
  }),
  z.object({ ...base, kind: z.literal('form'), sheet: sheetRef, form: sheetRef }),
  z.object({ ...base, kind: z.literal('dashboard'), dashboard: sheetRef }),
  z.object({
    ...base,
    kind: z.literal('workflow'),
    sheet: sheetRef,
    fieldKey: fieldKey.optional(),
  }),
]);

export const appManifestSchema = z
  .object({
    key: appKey,
    title: z.string().trim().min(1).max(60),
    description: z.string().trim().max(400).optional(),
    icon: z.enum(APP_ICONS),
    roles,
    sections: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(40),
          screens: z.array(appScreenSchema).min(1).max(12),
        }),
      )
      .min(1)
      .max(6),
  })
  .superRefine((a, ctx) => {
    const seen = new Set<string>();
    a.sections.forEach((s, si) =>
      s.screens.forEach((sc, i) => {
        if (seen.has(sc.key))
          ctx.addIssue({
            code: 'custom',
            path: ['sections', si, 'screens', i, 'key'],
            message: `Duplicate screen "${sc.key}".`,
          });
        seen.add(sc.key);
      }),
    );
  });

export const appFileSchema = z.object({
  requires: z.object({
    pack: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
    range: z.string().regex(SEMVER_RANGE, 'Use a range like ^1.0.0.'),
  }),
  app: appManifestSchema,
});

/** The schemas' types are the engine's (a compile-time check that the two stay the same). */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameApp: Same<z.output<typeof appManifestSchema>, AppManifest> = true;
const sameFile: Same<z.output<typeof appFileSchema>, AppFile> = true;
void sameApp;
void sameFile;

export interface AppProblem {
  path: (string | number)[];
  message: string;
}

type AppSheet = Pick<PackManifest['sheets'][number], 'fields' | 'views' | 'forms' | 'subitems'>;

/**
 * A required pack's sheet as the app sees it: what the pack's extends adds to it (forms, views, columns), plus the
 * dependency's own columns and views when its manifest is given (the catalogue checks; the schema has only the pack).
 */
function foreignSheet(
  pack: PackManifest,
  depKey: string,
  ref: string,
  deps: readonly PackManifest[] | undefined,
): { sheet: AppSheet; checked: boolean } | null {
  if (!pack.requires.some((r) => r.pack === depKey)) return null;
  const e = (pack.extends ?? []).find((x) => x.pack === depKey && x.sheet === ref);
  const dep = deps?.find((d) => d.key === depKey);
  const base = dep?.sheets.find((s) => s.ref === ref);
  if (dep && !base) return null;
  return {
    sheet: {
      fields: [...(base?.fields ?? []), ...(e?.fields ?? [])],
      views: [...(base?.views ?? []), ...(e?.views ?? [])],
      forms: [...(base?.forms ?? []), ...(e?.forms ?? [])],
    },
    checked: !!dep,
  };
}

/**
 * Every ref of an app that the pack does not have, with a path inside the app. A screen may read a sheet of a pack
 * the pack requires (`core:nc`, docs/13): its forms and views are the pack's extends of that sheet; its field keys are
 * checked when `deps` (the required packs' manifests) are given.
 */
export function appProblems(
  app: AppManifest,
  pack: PackManifest,
  deps?: readonly PackManifest[],
): AppProblem[] {
  const out: AppProblem[] = [];
  const own = new Map<string, AppSheet>(pack.sheets.map((s) => [s.ref, s]));
  const dashboards = new Set(pack.dashboards.map((d) => d.ref));
  app.sections.forEach((section, si) =>
    section.screens.forEach((screen: AppScreen, i) => {
      const at = (...p: (string | number)[]) => ['sections', si, 'screens', i, ...p];
      const problem = (path: (string | number)[], message: string) => out.push({ path, message });
      if (screen.kind === 'dashboard') {
        if (!dashboards.has(screen.dashboard))
          problem(at('dashboard'), `Unknown dashboard "${screen.dashboard}".`);
        return;
      }
      const colon = screen.sheet.indexOf(':');
      const foreign =
        colon > 0
          ? foreignSheet(pack, screen.sheet.slice(0, colon), screen.sheet.slice(colon + 1), deps)
          : null;
      const s = colon > 0 ? foreign?.sheet : own.get(screen.sheet);
      if (!s)
        return problem(
          at('sheet'),
          colon > 0
            ? `"${screen.sheet}" is not a sheet of a pack this one requires.`
            : `Unknown sheet "${screen.sheet}".`,
        );
      const sub = (screen.kind === 'view' || screen.kind === 'item') && screen.subitems;
      if (sub && !s.subitems) return problem(at('subitems'), `"${screen.sheet}" has no sub-items.`);
      const keys = new Set(
        (sub && s.subitems ? s.subitems.fields : s.fields).map((f) => f.key as string),
      );
      // a required pack's columns are known only with its manifest (the catalogue checks them)
      const unchecked = colon > 0 && !foreign?.checked;
      const known = (k: string) => unchecked || keys.has(k) || k in SPECIAL_KEYS;
      if (screen.kind === 'view' && screen.view && !s.views.some((v) => v.name === screen.view))
        problem(at('view'), `Unknown view "${screen.view}" on "${screen.sheet}".`);
      if (screen.kind === 'form' && !s.forms.some((f) => f.ref === screen.form))
        problem(at('form'), `Unknown form "${screen.form}" on "${screen.sheet}".`);
      const column = (k: string) => unchecked || keys.has(k);
      if (screen.kind === 'workflow' && screen.fieldKey && !column(screen.fieldKey))
        problem(at('fieldKey'), `Unknown field "${screen.fieldKey}".`);
      if (screen.kind === 'item') {
        screen.filters.forEach((f, fi) => {
          if (!known(f.fieldKey)) problem(at('filters', fi), `Unknown field "${f.fieldKey}".`);
        });
        (screen.sort ?? []).forEach((f, fi) => {
          if (!column(f.fieldKey)) problem(at('sort', fi), `Unknown field "${f.fieldKey}".`);
        });
        (screen.show ?? []).forEach((k, fi) => {
          if (!column(k)) problem(at('show', fi), `Unknown field "${k}".`);
        });
      }
    }),
  );
  return out;
}

/** Parse an app file (templates/apps/*.json); throws with every problem listed. */
export function parseAppFile(raw: unknown): AppFile {
  const r = appFileSchema.safeParse(raw);
  if (r.success) return r.data;
  throw new Error(
    `App is not valid:\n${r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
  );
}
