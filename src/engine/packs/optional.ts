// Optional requirements (docs/11 Optional requirements): one pack version that works on another pack's registers when
// that pack is live and on its own sheets when it is not (owner decision 15 Nov 2026: CAPA on Core's Nonconformities
// and CAPA). A requirement with `optional: true` is never installed for you. `sheets[].onlyWithout: <pack>` marks the
// sheets the pack makes only without it. The two cases are derived from data, as a level is (levels.ts):
// - with the pack live: its `onlyWithout` sheets are left out, and with them everything that needs them (the same
//   closure as leaving a part out in Create, select.ts); the requirement becomes an ordinary one;
// - without it: the requirement is dropped, and everything that names that pack (`<pack>:<sheet>` in widgets,
//   actions and app screens, its extends entries, setup steps on its sheets) is left out.
// Apps follow: a screen whose sheet, form or dashboard the case leaves out is dropped, and an app with none left too,
// so two apps may share a key when each belongs to one case. The case an install was made in is read from its ref
// map: it was made with the pack when it has none of the `onlyWithout` sheets. Pure.
import { bundleParts, closeExclusions, partId, withoutLeftOut } from './select';
import type { PackManifest } from './types';

/** The keys of the pack's optional requirements, in manifest order. */
export const optionalPacks = (m: Pick<PackManifest, 'requires'>): string[] =>
  m.requires.filter((r) => r.optional).map((r) => r.pack);

/**
 * The optional requirements live in a workspace: what a new install of the pack works on. A live install out of the
 * range still counts, so the planner says to update it instead of making a second register.
 */
export function liveOptional(
  m: Pick<PackManifest, 'requires'>,
  installs: readonly { packKey: string; status?: string }[],
): string[] {
  return optionalPacks(m).filter((k) =>
    installs.some((i) => i.packKey === k && (i.status ?? 'installed') === 'installed'),
  );
}

/** The optional packs an install was made with: none of the sheets made only without them is in its ref map. */
export function installCase(
  m: Pick<PackManifest, 'requires' | 'sheets'>,
  refMap: Record<string, string>,
): string[] {
  return optionalPacks(m).filter((k) => {
    const own = m.sheets.filter((s) => s.onlyWithout === k);
    return own.length > 0 && own.every((s) => typeof refMap[`sheet:${s.ref}`] !== 'string');
  });
}

/**
 * The case a pack is in for a workspace: the case its live install was made in, or else (a new install) the optional
 * packs live there. Installs without a ref map count as made without them.
 */
export function workspaceCase(
  m: Pick<PackManifest, 'key' | 'requires' | 'sheets'>,
  installs: readonly { packKey: string; status?: string; refMap?: Record<string, string> | null }[],
): string[] {
  const own = installs.find(
    (i) => i.packKey === m.key && (i.status ?? 'installed') === 'installed',
  );
  return own ? installCase(m, own.refMap ?? {}) : liveOptional(m, installs);
}

/** Every case of a manifest: one per subset of its optional requirements (a single case, [], when it has none). */
export function packCases(m: Pick<PackManifest, 'requires'>): string[][] {
  let out: string[][] = [[]];
  for (const k of optionalPacks(m)) out = out.flatMap((c) => [c, [...c, k]]);
  return out;
}

/** A case in words for manifest problems: "with core", "without core". */
export function caseWords(m: Pick<PackManifest, 'requires'>, withPacks: readonly string[]): string {
  const opt = optionalPacks(m);
  const on = opt.filter((k) => withPacks.includes(k));
  const off = opt.filter((k) => !withPacks.includes(k));
  return [on.length ? `with ${on.join(', ')}` : '', off.length ? `without ${off.join(', ')}` : '']
    .filter(Boolean)
    .join(' and ');
}

const namesPack = (raw: unknown, packs: ReadonlySet<string>) => {
  if (typeof raw !== 'string') return false;
  const colon = raw.indexOf(':');
  return colon > 0 && packs.has(raw.slice(0, colon));
};

/**
 * The manifest in one case: `withPacks` are the optional requirements that are live. A pack without optional
 * requirements is returned as it is; the result has none (each is kept as an ordinary requirement or dropped).
 */
export function manifestFor(m: PackManifest, withPacks: readonly string[]): PackManifest {
  const optional = optionalPacks(m);
  if (!optional.length) return m;
  const on = new Set(optional.filter((k) => withPacks.includes(k)));
  const off = new Set(optional.filter((k) => !on.has(k)));

  // own sheets made only without a live pack, and what needs them (forms, automations, dashboards, linking sheets)
  const ex = closeExclusions(
    bundleParts(m),
    m.sheets.filter((s) => s.onlyWithout && on.has(s.onlyWithout)).map((s) => partId.sheet(s.ref)),
  );
  const sheets = m.sheets
    .filter((s) => !ex.has(partId.sheet(s.ref)))
    .map((s) => {
      const { onlyWithout: _w, ...rest } = s;
      void _w;
      return { ...rest, forms: s.forms.filter((f) => !ex.has(partId.form(s.ref, f.ref))) };
    });
  const kept = new Set(sheets.map((s) => s.ref));
  // a folder only the left-out sheets used goes with them
  const folders = m.folders.filter(
    (f) =>
      sheets.some((s) => s.folder === f.ref) ||
      !m.sheets.some((s) => !kept.has(s.ref) && s.folder === f.ref),
  );
  const automations = m.automations.filter(
    (a) => !ex.has(partId.automation(a.ref)) && !a.actions.some((x) => namesPack(x.sheetRef, off)),
  );
  const dashboards = m.dashboards
    .filter((d) => !ex.has(partId.dashboard(d.ref)))
    .map((d) => ({ ...d, widgets: d.widgets.filter((w) => !namesPack(w.sheetRef, off)) }))
    .filter((d) => d.widgets.length > 0);
  // only what this case left out goes: a ref the pack never had stays, so the manifest checks still name it
  const dashboardGone = (ref: string) =>
    m.dashboards.some((d) => d.ref === ref) && !dashboards.some((d) => d.ref === ref);
  const sheetGone = (ref: string | undefined) =>
    !!ref &&
    (namesPack(ref, off) ||
      (!ref.includes(':') && m.sheets.some((s) => s.ref === ref) && !kept.has(ref)));
  const extensions = m.extends?.filter((e) => !off.has(e.pack)).map((e) => withoutLeftOut(e, kept));
  const formGone = (sheet: string, form: string) =>
    !!m.sheets.find((s) => s.ref === sheet)?.forms.some((f) => f.ref === form) &&
    !sheets.find((s) => s.ref === sheet)?.forms.some((f) => f.ref === form);
  const apps = m.apps
    ?.map((app) => ({
      ...app,
      sections: app.sections
        .map((sec) => ({
          ...sec,
          screens: sec.screens.filter((sc) =>
            sc.kind === 'dashboard'
              ? !dashboardGone(sc.dashboard)
              : !sheetGone(sc.sheet) && (sc.kind !== 'form' || !formGone(sc.sheet, sc.form)),
          ),
        }))
        .filter((sec) => sec.screens.length > 0),
    }))
    .filter((app) => app.sections.length > 0);
  const steps = m.setup?.steps.filter(
    (st) =>
      !sheetGone(st.target.sheetRef) &&
      st.rules.every((r) => !sheetGone(r.sheetRef)) &&
      Object.values(st.levels ?? {}).every(
        (l) =>
          !sheetGone(l.target?.sheetRef) && (l.rules ?? []).every((r) => !sheetGone(r.sheetRef)),
      ),
  );
  const { setup: _s, extends: _e, ...rest } = m;
  void _s;
  void _e;
  return {
    ...rest,
    requires: m.requires
      .filter((r) => !off.has(r.pack))
      .map((r) => ({ pack: r.pack, range: r.range })),
    folders,
    sheets,
    automations,
    dashboards,
    ...(extensions?.length ? { extends: extensions } : {}),
    ...(apps ? { apps } : {}),
    ...(m.setup && steps?.length ? { setup: { ...m.setup, steps } } : {}),
  };
}

/** The manifest's own problems with optional requirements (each case is then checked as a whole manifest). */
export function optionalProblems(
  m: PackManifest,
): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const optional = new Set(optionalPacks(m));
  m.sheets.forEach((s, si) => {
    if (s.onlyWithout && !optional.has(s.onlyWithout))
      out.push({
        path: ['sheets', si, 'onlyWithout'],
        message: `"${s.onlyWithout}" is not an optional requirement of the pack.`,
      });
  });
  m.requires.forEach((r, ri) => {
    if (r.optional && !m.sheets.some((s) => s.onlyWithout === r.pack))
      out.push({
        path: ['requires', ri],
        message: `An optional requirement needs a sheet made only without it (onlyWithout: "${r.pack}"): an install's ref map says which case it was made in.`,
      });
  });
  return out;
}
