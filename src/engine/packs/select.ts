// Choosing parts of a bundle (docs/05 §4 Create, docs/11 Bundles). The Create wizard previews exactly what a pack
// (or a start shipped as a pack) creates and lets the person untick sheets, forms, automations and dashboards. The
// parts come from the same manifest the install plans; leaving a part out leaves out what depends on it (a form, an
// automation or a dashboard on that sheet, a sheet whose links point at it). Safety (the DPO's rule): a public form
// is flagged (forms install as drafts anyway) and an automation that sends anything out of the workspace (a webhook,
// an email) is flagged and installed off. Pure: the manifest in, parts or the chosen manifest out.
import type { Json } from '../types';
import { isOutbound, OUTBOUND_ACTIONS, startsInTestMode } from './safety';
import type { PackManifest } from './types';

export type PartKind = 'sheet' | 'form' | 'automation' | 'dashboard';

export type FlagKind = 'public_form' | 'outbound' | 'restricted';

export interface PartFlag {
  kind: FlagKind;
  text: string;
}

export interface BundlePart {
  /** `sheet:<ref>`, `form:<sheet ref>.<form ref>`, `automation:<ref>`, `dashboard:<ref>`. */
  id: string;
  kind: PartKind;
  name: string;
  /** The sheet a form or automation belongs to (its name). */
  sheet: string | null;
  /** "12 fields · 4 example items", "3 widgets", "Public". */
  detail: string;
  /** Fields a sheet adds (sheets only), for the counts. */
  fields: number;
  /** Parts this one needs: leaving one of them out leaves this out too. */
  requires: string[];
  flags: PartFlag[];
}

/** Action types that send something out of the workspace. Installed off; turned on by a person after review. */
export { OUTBOUND_ACTIONS };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const localSheet = (raw: unknown): string | null =>
  typeof raw === 'string' && !raw.includes(':') ? raw : null;

export const partId = {
  sheet: (ref: string) => `sheet:${ref}`,
  form: (sheet: string, ref: string) => `form:${sheet}.${ref}`,
  automation: (ref: string) => `automation:${ref}`,
  dashboard: (ref: string) => `dashboard:${ref}`,
};

/** Every part of a manifest (already at the chosen level), sheets first, with what each needs and its flags. */
export function bundleParts(m: PackManifest): BundlePart[] {
  const sheetName = new Map(m.sheets.map((s) => [s.ref, s.name]));
  const sheets: BundlePart[] = m.sheets.map((s) => {
    const targets = new Set(
      s.fields
        .map((f) => localSheet((f.config as Record<string, Json> | undefined)?.targetSheetRef))
        .filter((r): r is string => !!r && r !== s.ref && sheetName.has(r)),
    );
    const items = s.items.length;
    const what =
      s.register === 'documents' ? 'document' : s.isLibrary ? 'library item' : 'example item';
    return {
      id: partId.sheet(s.ref),
      kind: 'sheet',
      name: s.name,
      sheet: null,
      detail: [
        plural(s.fields.length, 'field'),
        items ? plural(items, what) : null,
        s.subitems ? `sub-items "${s.subitems.label}"` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      fields: s.fields.length,
      requires: [...targets].map(partId.sheet),
      flags: s.restricted
        ? [
            {
              kind: 'restricted',
              text: 'Restricted: only you and the workspace owners see it until you share it.',
            },
          ]
        : [],
    };
  });
  const forms: BundlePart[] = m.sheets.flatMap((s) =>
    s.forms.map((f) => ({
      id: partId.form(s.ref, f.ref),
      kind: 'form' as const,
      name: f.name,
      sheet: s.name,
      detail:
        f.access === 'public' ? 'Public, anyone with the link' : 'Internal, signed-in members',
      fields: 0,
      requires: [partId.sheet(s.ref)],
      flags:
        f.access === 'public'
          ? [
              {
                kind: 'public_form' as const,
                text: 'Public form: created as a draft. Nobody outside the workspace can open it until an owner or admin reviews its privacy notice and publishes it.',
              },
            ]
          : [],
    })),
  );
  const automations: BundlePart[] = m.automations.map((a) => {
    const needs = new Set<string>([partId.sheet(a.sheet)]);
    for (const x of a.actions) {
      const r = localSheet(x.sheetRef);
      if (r && sheetName.has(r)) needs.add(partId.sheet(r));
    }
    const formRef = a.trigger.type === 'form_submitted' ? a.trigger.formId : null;
    if (typeof formRef === 'string') {
      const s = m.sheets.find((x) => x.ref === a.sheet);
      if (s?.forms.some((f) => f.ref === formRef)) needs.add(partId.form(a.sheet, formRef));
    }
    const out = isOutbound(a);
    return {
      id: partId.automation(a.ref),
      kind: 'automation',
      name: a.name,
      sheet: sheetName.get(a.sheet) ?? null,
      detail:
        out || a.enabled === false
          ? 'Created off'
          : startsInTestMode(a)
            ? 'Created in test mode'
            : 'Created on',
      fields: 0,
      requires: [...needs],
      flags: out
        ? [
            {
              kind: 'outbound',
              text: 'Sends data outside the workspace (a webhook or an email). Created off: turn it on after you have checked where it sends.',
            },
          ]
        : [],
    };
  });
  const dashboards: BundlePart[] = m.dashboards.map((d) => ({
    id: partId.dashboard(d.ref),
    kind: 'dashboard',
    name: d.name,
    sheet: null,
    detail: plural(d.widgets.length, 'widget'),
    fields: 0,
    requires: [
      ...new Set(
        d.widgets.flatMap((w) =>
          w.sheetRef && sheetName.has(w.sheetRef) ? [partId.sheet(w.sheetRef)] : [],
        ),
      ),
    ],
    flags: [],
  }));
  return [...sheets, ...forms, ...automations, ...dashboards];
}

export interface Selection {
  /** Part ids left out. */
  excluded: string[];
  /** Plain words about what else changed: "Also leaves out 2 automations on Suppliers." */
  note: string | null;
}

/** The parts that need `id`, directly or through others. */
function dependents(parts: BundlePart[], id: string): Set<string> {
  const out = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const p of parts)
      if (p.requires.includes(cur) && !out.has(p.id) && p.id !== id) {
        out.add(p.id);
        queue.push(p.id);
      }
  }
  return out;
}

/** The parts `id` needs, directly or through others. */
function requirements(parts: BundlePart[], id: string): Set<string> {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const out = new Set<string>();
  const queue = [...(byId.get(id)?.requires ?? [])];
  while (queue.length) {
    const cur = queue.shift()!;
    if (out.has(cur) || cur === id) continue;
    out.add(cur);
    queue.push(...(byId.get(cur)?.requires ?? []));
  }
  return out;
}

const KIND_WORD: Record<PartKind, [string, string]> = {
  sheet: ['sheet', 'sheets'],
  form: ['form', 'forms'],
  automation: ['automation', 'automations'],
  dashboard: ['dashboard', 'dashboards'],
};

const listed = (parts: BundlePart[]) => {
  const by = new Map<PartKind, number>();
  for (const p of parts) by.set(p.kind, (by.get(p.kind) ?? 0) + 1);
  const bits = (['sheet', 'form', 'automation', 'dashboard'] as PartKind[])
    .filter((k) => by.get(k))
    .map((k) => {
      const n = by.get(k)!;
      return `${n} ${KIND_WORD[k][n === 1 ? 0 : 1]}`;
    });
  return bits.length <= 1 ? (bits[0] ?? '') : `${bits.slice(0, -1).join(', ')} and ${bits.at(-1)}`;
};

/**
 * Tick or untick a part. Unticking leaves out everything that needs it (said in the note); ticking brings back what
 * it needs. Unknown ids change nothing.
 */
export function togglePart(
  parts: BundlePart[],
  excluded: string[],
  id: string,
  on: boolean,
): Selection {
  const part = parts.find((p) => p.id === id);
  if (!part) return { excluded, note: null };
  const out = new Set(excluded);
  const byId = new Map(parts.map((p) => [p.id, p]));
  if (!on) {
    out.add(id);
    const also = [...dependents(parts, id)].filter((d) => !out.has(d));
    for (const d of also) out.add(d);
    const alsoParts = also.map((d) => byId.get(d)!);
    return {
      excluded: [...out],
      note: also.length
        ? `Also leaves out ${listed(alsoParts)} that ${also.length === 1 ? 'needs' : 'need'} ${part.name}: ${alsoParts.map((p) => p.name).join(', ')}.`
        : null,
    };
  }
  out.delete(id);
  const back = [...requirements(parts, id)].filter((r) => out.has(r));
  for (const r of back) out.delete(r);
  const backParts = back.map((r) => byId.get(r)!);
  return {
    excluded: [...out],
    note: back.length
      ? `Also adds back ${listed(backParts)} that ${part.name} needs: ${backParts.map((p) => p.name).join(', ')}.`
      : null,
  };
}

/** Exclusions closed over dependents (what the server applies, whatever the browser sent). */
export function closeExclusions(parts: BundlePart[], excluded: string[]): Set<string> {
  const out = new Set(excluded.filter((id) => parts.some((p) => p.id === id)));
  for (const id of [...out]) for (const d of dependents(parts, id)) out.add(d);
  return out;
}

/** What the chosen parts add up to (the preview's counts). */
export function selectionCounts(parts: BundlePart[], excluded: string[]) {
  const left = new Set(excluded);
  const kept = parts.filter((p) => !left.has(p.id));
  const n = (k: PartKind) => kept.filter((p) => p.kind === k).length;
  return {
    sheets: n('sheet'),
    fields: kept.reduce((s, p) => s + p.fields, 0),
    forms: n('form'),
    automations: n('automation'),
    dashboards: n('dashboard'),
  };
}

export type FolderChoice = { mode: 'pack' } | { mode: 'none' } | { mode: 'folder'; name: string };

/** A pack with a restricted folder keeps its own folders (moving its sheets elsewhere would widen who sees them). */
export const canChooseFolder = (m: PackManifest) => !m.folders.some((f) => f.restricted);

const FOLDER_REF = 'chosen_folder';

type Extension = NonNullable<PackManifest['extends']>[number];
const isObj = (v: unknown): v is Record<string, Json> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const KEY_PROPS = new Set([
  'fieldKey',
  'labelFieldKey',
  'dateFieldKey',
  'linkFieldKey',
  'whenFieldKey',
  'key',
]);
/** Whether a view, form field, trigger, condition or action names one of these field keys. */
function namesKey(v: unknown, keys: ReadonlySet<string>): boolean {
  if (Array.isArray(v)) return v.some((x) => namesKey(x, keys));
  if (!isObj(v)) return false;
  return Object.entries(v).some(([k, x]) =>
    KEY_PROPS.has(k) && typeof x === 'string' ? keys.has(x) : namesKey(x, keys),
  );
}

/**
 * An extends entry without what needs an own sheet left out: the columns that link to it, the roll-ups and lookups
 * through those columns, and the views, form fields, example values and links, workflows and automations that name
 * them or act on that sheet (Supplier management 3.0's checks columns on Core's Suppliers, when the checks are left
 * out).
 */
function withoutLeftOut(e: Extension, keptRefs: ReadonlySet<string>): Extension {
  const leftOut = (raw: unknown) =>
    typeof raw === 'string' && !raw.includes(':') && !keptRefs.has(raw);
  const dropped = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const f of e.fields ?? []) {
      const cfg = (f.config ?? {}) as Record<string, Json>;
      if (dropped.has(f.key)) continue;
      if (
        leftOut(cfg.targetSheetRef) ||
        (typeof cfg.linkFieldKey === 'string' && dropped.has(cfg.linkFieldKey))
      ) {
        dropped.add(f.key);
        grew = true;
      }
    }
  }
  const actsOnLeftOut = (a: NonNullable<Extension['automations']>[number]) =>
    a.actions.some((x) => leftOut(x.sheetRef));
  const automations = e.automations?.filter(
    (a) =>
      !actsOnLeftOut(a) &&
      !namesKey([a.trigger, ...a.conditions, ...a.actions] as unknown as Json, dropped),
  );
  if (!dropped.size && automations?.length === e.automations?.length) return e;
  const without = <T extends Record<string, Json>>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([k]) => !dropped.has(k))) as T;
  return {
    ...e,
    fields: e.fields?.filter((f) => !dropped.has(f.key)),
    views: e.views?.filter((v) => !namesKey(v.config as Json, dropped)),
    forms: e.forms?.map((f) => ({
      ...f,
      layout: { ...f.layout, fields: f.layout.fields.filter((x) => !dropped.has(x.key)) },
    })),
    items: e.items?.map((i) => ({
      ...i,
      values: without(i.values),
      ...(i.links ? { links: without(i.links as Record<string, Json>) as typeof i.links } : {}),
    })),
    workflows: e.workflows?.filter((w) => !namesKey(w as unknown as Json, dropped)),
    automations,
  };
}

/**
 * The manifest as the person chose it: parts left out (and what needs them), folders nobody uses dropped, the folder
 * choice applied, setup steps on a left-out sheet dropped, outbound automations installed off. Apps stay: a screen
 * whose sheet, form or dashboard the install does not have is not shown (docs/13).
 */
export function selectManifest(
  m: PackManifest,
  excludedIn: string[],
  folder: FolderChoice = { mode: 'pack' },
): PackManifest {
  const parts = bundleParts(m);
  const ex = closeExclusions(parts, excludedIn);
  const keptSheets = m.sheets
    .filter((s) => !ex.has(partId.sheet(s.ref)))
    .map((s) => ({ ...s, forms: s.forms.filter((f) => !ex.has(partId.form(s.ref, f.ref))) }));
  const keptRefs = new Set(keptSheets.map((s) => s.ref));
  const choose = folder.mode !== 'pack' && canChooseFolder(m);
  const sheets: PackManifest['sheets'] = choose
    ? keptSheets.map((s) => {
        const { folder: _f, ...rest } = s;
        void _f;
        return folder.mode === 'folder' ? { ...rest, folder: FOLDER_REF } : rest;
      })
    : keptSheets;
  const usedFolders = new Set(sheets.map((s) => s.folder).filter(Boolean));
  const folders = choose
    ? folder.mode === 'folder'
      ? [{ ref: FOLDER_REF, name: folder.name.trim().slice(0, 80) }]
      : []
    : m.folders.filter((f) => usedFolders.has(f.ref));
  // a step on a required pack's sheet (core:suppliers) stays
  const usesSheet = (t: { sheetRef?: string }) =>
    !t.sheetRef || t.sheetRef.includes(':') || keptRefs.has(t.sheetRef);
  return {
    ...m,
    folders,
    sheets,
    automations: m.automations
      .filter((a) => !ex.has(partId.automation(a.ref)))
      .map((a) => (isOutbound(a) ? { ...a, enabled: false } : a)),
    dashboards: m.dashboards.filter((d) => !ex.has(partId.dashboard(d.ref))),
    // what it adds to other packs' sheets (docs/11 Extends) keeps nothing that needs one of its own sheets left out
    ...(m.extends ? { extends: m.extends.map((e) => withoutLeftOut(e, keptRefs)) } : {}),
    ...(m.setup
      ? {
          setup: {
            ...m.setup,
            steps: m.setup.steps.filter(
              (st) =>
                usesSheet(st.target) &&
                st.rules.every(usesSheet) &&
                Object.values(st.levels ?? {}).every(
                  (l) => (!l.target || usesSheet(l.target)) && (l.rules ?? []).every(usesSheet),
                ),
            ),
          },
        }
      : {}),
  };
}

export interface AppPreview {
  title: string;
  screens: number;
}

export interface AppNeeds {
  /** The app's key (docs/13): the App card in Create follows one app. */
  key: string;
  title: string;
  /** Per screen, the part ids it shows (all of them must be created for the screen to show). */
  screens: string[][];
}

/** The apps of a manifest and, per screen, the parts it needs (docs/13: a screen without its objects is hidden). */
export function appNeeds(m: PackManifest): AppNeeds[] {
  return (m.apps ?? []).map((app) => ({
    key: app.key,
    title: app.title,
    screens: app.sections.flatMap((sec) =>
      sec.screens.flatMap((sc) => {
        const s = sc as { kind: string; sheet?: string; form?: string; dashboard?: string };
        // a screen over a required pack's sheet (`core:nc`, docs/13) reads that pack's live install, installed or
        // raised first: none of this pack's own parts can leave it out
        const other = s.sheet?.includes(':') ? s.sheet.split(':')[0] : null;
        if (other) return m.requires.some((r) => r.pack === other) ? [[]] : [];
        if (s.kind === 'dashboard')
          return s.dashboard && m.dashboards.some((d) => d.ref === s.dashboard)
            ? [[partId.dashboard(s.dashboard)]]
            : [];
        const sheet = s.sheet ? m.sheets.find((x) => x.ref === s.sheet) : undefined;
        if (!sheet) return [];
        if (s.kind !== 'form') return [[partId.sheet(sheet.ref)]];
        return s.form && sheet.forms.some((f) => f.ref === s.form)
          ? [[partId.sheet(sheet.ref), partId.form(sheet.ref, s.form)]]
          : [];
      }),
    ),
  }));
}

/** The apps the chosen parts carry and how many of their screens stay. */
export function appsFor(needs: AppNeeds[], excluded: Iterable<string>): AppPreview[] {
  const ex = new Set(excluded);
  return needs.flatMap((a) => {
    const n = a.screens.filter((ids) => ids.every((id) => !ex.has(id))).length;
    return n ? [{ title: a.title, screens: n }] : [];
  });
}

/** The apps the chosen parts carry and how many of their screens survive (docs/13: missing objects hide a screen). */
export function appsAfter(m: PackManifest, excluded: string[]): AppPreview[] {
  return appsFor(appNeeds(m), closeExclusions(bundleParts(m), excluded));
}
