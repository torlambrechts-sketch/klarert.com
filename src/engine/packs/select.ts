// Choosing parts of a bundle (docs/05 §4 Create, docs/11 Bundles). The Create wizard previews exactly what a pack
// (or a start shipped as a pack) creates and lets the person untick sheets, forms, automations and dashboards. The
// parts come from the same manifest the install plans; leaving a part out leaves out what depends on it (a form, an
// automation or a dashboard on that sheet, a sheet whose links point at it). Safety (the DPO's rule): a public form
// is flagged (forms install as drafts anyway) and an automation that sends anything out of the workspace (a webhook,
// an email) is flagged and installed off. Pure: the manifest in, parts or the chosen manifest out.
import type { Json } from '../types';
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
export const OUTBOUND_ACTIONS = new Set(['webhook', 'send_email', 'email']);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const localSheet = (raw: unknown): string | null =>
  typeof raw === 'string' && !raw.includes(':') ? raw : null;

export const partId = {
  sheet: (ref: string) => `sheet:${ref}`,
  form: (sheet: string, ref: string) => `form:${sheet}.${ref}`,
  automation: (ref: string) => `automation:${ref}`,
  dashboard: (ref: string) => `dashboard:${ref}`,
};

const isOutbound = (a: PackManifest['automations'][number]) =>
  a.actions.some((x) => OUTBOUND_ACTIONS.has(String(x.type)));

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
      detail: out || a.enabled === false ? 'Created off' : 'Created on',
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
  const sheets = choose
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
  const usesSheet = (t: { sheetRef?: string }) => !t.sheetRef || keptRefs.has(t.sheetRef);
  return {
    ...m,
    folders,
    sheets,
    automations: m.automations
      .filter((a) => !ex.has(partId.automation(a.ref)))
      .map((a) => (isOutbound(a) ? { ...a, enabled: false } : a)),
    dashboards: m.dashboards.filter((d) => !ex.has(partId.dashboard(d.ref))),
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

/** The apps the chosen parts carry and how many of their screens survive (docs/13: missing objects hide a screen). */
export function appsAfter(m: PackManifest, excluded: string[]): AppPreview[] {
  const ex = closeExclusions(bundleParts(m), excluded);
  const sheetOk = (ref: string) =>
    m.sheets.some((s) => s.ref === ref) && !ex.has(partId.sheet(ref));
  return (m.apps ?? []).flatMap((app) => {
    let n = 0;
    for (const sec of app.sections)
      for (const sc of sec.screens) {
        const s = sc as { kind: string; sheet?: string; form?: string; dashboard?: string };
        const ok =
          s.kind === 'dashboard'
            ? !!s.dashboard &&
              m.dashboards.some((d) => d.ref === s.dashboard) &&
              !ex.has(partId.dashboard(s.dashboard))
            : !!s.sheet &&
              sheetOk(s.sheet) &&
              (s.kind !== 'form' ||
                (!!s.form &&
                  m.sheets.find((x) => x.ref === s.sheet)?.forms.some((f) => f.ref === s.form) ===
                    true &&
                  !ex.has(partId.form(s.sheet, s.form))));
        if (ok) n += 1;
      }
    return n ? [{ title: app.title, screens: n }] : [];
  });
}
