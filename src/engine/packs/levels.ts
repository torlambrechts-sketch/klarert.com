// Pack levels (docs/11 Levels): a pack may offer levels (Starter, Full …), lowest first. Every folder, sheet, form,
// automation and dashboard may name the lowest level that installs it; without one it installs at every level. A
// level installs everything of the levels before it, so installing a higher level later adds only what is missing.
// Pure: the manifest in, the manifest at a level (or the problems with its levels) out.
import type { Json } from '../types';
import type { PackManifest, SetupRule, SetupStep, SetupStepText } from './types';

type Obj = Record<string, Json>;

export interface LevelProblem {
  path: (string | number)[];
  message: string;
}

/** The level installed when none is chosen: the lowest, or null for a pack without levels. */
export const defaultLevel = (m: Pick<PackManifest, 'levels'>): string | null =>
  m.levels?.[0]?.key ?? null;

/** The rank of a level (0 = lowest); an object without a level is at rank 0. Unknown levels rank -1. */
export function levelRank(
  m: Pick<PackManifest, 'levels'>,
  level: string | null | undefined,
): number {
  if (!level) return 0;
  return m.levels?.findIndex((l) => l.key === level) ?? -1;
}

/** Is an object with this lowest level part of an install at `level`? */
export const atLevel = (
  m: Pick<PackManifest, 'levels'>,
  objectLevel: string | null | undefined,
  level: string | null,
) => levelRank(m, objectLevel) <= Math.max(0, levelRank(m, level));

/** The library key of a required framework. */
export const libraryKey = (f: { key: string; version: string }) => `${f.key}@${f.version}`;

/** A setup step as it reads at a level (its `levels` entry replaces parts of it). */
export function stepAt(step: SetupStep, level: string | null): SetupStepText & { ref: string } {
  const over = (level && step.levels?.[level]) || {};
  return {
    ref: step.ref,
    title: over.title ?? step.title,
    body: over.body ?? step.body,
    target: over.target ?? step.target,
    rules: over.rules ?? step.rules,
  };
}

/**
 * The manifest as installed at a level: only the folders, sheets, forms, automations and dashboards whose lowest
 * level is at or below it. A pack without levels is returned as it is.
 */
export function manifestAtLevel(m: PackManifest, level: string | null): PackManifest {
  if (!m.levels?.length) return m;
  const keep = (l: string | undefined) => atLevel(m, l, level);
  return {
    ...m,
    folders: m.folders.filter((f) => keep(f.level)),
    sheets: m.sheets
      .filter((s) => keep(s.level))
      .map((s) => ({ ...s, forms: s.forms.filter((f) => keep(f.level ?? s.level)) })),
    automations: m.automations.filter((a) => keep(a.level)),
    dashboards: m.dashboards.filter((d) => keep(d.level)),
  };
}

export interface LevelSummary {
  key: string;
  name: string;
  description: string;
  /** Sheets this level installs, the ones of lower levels included. */
  sheets: string[];
  /** Sheets this level adds to the level before it. */
  adds: string[];
  automations: number;
  dashboards: number;
}

/** What each level installs (the install dialog's choice). Empty for a pack without levels. */
export function levelSummaries(m: PackManifest): LevelSummary[] {
  const out: LevelSummary[] = [];
  let before = new Set<string>();
  for (const l of m.levels ?? []) {
    const at = manifestAtLevel(m, l.key);
    const sheets = at.sheets.map((s) => s.name);
    out.push({
      key: l.key,
      name: l.name,
      description: l.description,
      sheets,
      adds: sheets.filter((s) => !before.has(s)),
      automations: at.automations.length,
      dashboards: at.dashboards.length,
    });
    before = new Set(sheets);
  }
  return out;
}

/** Problems with a manifest's levels, required frameworks and setup steps (manifest.ts reports them). */
export function levelProblems(m: PackManifest): LevelProblem[] {
  const out: LevelProblem[] = [];
  const problem = (path: (string | number)[], message: string) => out.push({ path, message });
  const levels = m.levels ?? [];
  const keys = new Set<string>();
  for (const l of levels) {
    if (keys.has(l.key)) problem(['levels'], `Duplicate level "${l.key}".`);
    keys.add(l.key);
  }
  const rank = (l: string | undefined, path: (string | number)[]): number => {
    if (!l) return 0;
    if (!levels.length) {
      problem(path, `"${l}" names a level, but the pack has no levels.`);
      return 0;
    }
    const r = levels.findIndex((x) => x.key === l);
    if (r < 0) problem(path, `Unknown level "${l}".`);
    return Math.max(0, r);
  };
  const name = (r: number) => levels[r]?.name ?? 'the lowest level';

  const folderRank = new Map(m.folders.map((f, i) => [f.ref, rank(f.level, ['folders', i])]));
  const sheetRank = new Map<string, number>();
  m.sheets.forEach((s, si) => sheetRank.set(s.ref, rank(s.level, ['sheets', si])));
  // widgets and setup steps read only libraries the pack adopts (an optional one may be missing)
  const libraries = new Set((m.frameworks ?? []).filter((f) => !f.optional).map(libraryKey));

  // a sheet only uses what is installed at its level: its folder and the sheets its links point at
  m.sheets.forEach((s, si) => {
    const r = sheetRank.get(s.ref)!;
    if (s.folder && (folderRank.get(s.folder) ?? 0) > r)
      problem(
        ['sheets', si, 'folder'],
        `The folder "${s.folder}" is installed only from ${name(folderRank.get(s.folder)!)}.`,
      );
    s.fields.forEach((f, fi) => {
      const target = (f.config as Obj | undefined)?.targetSheetRef;
      if (typeof target !== 'string' || target.includes(':')) return;
      const tr = sheetRank.get(target);
      if (tr !== undefined && tr > r)
        problem(
          ['sheets', si, 'fields', fi],
          `"${f.key}" links to "${target}", which is installed only from ${name(tr)}.`,
        );
      // two-way links join sheets of one level: a higher level cannot add a field to a sheet already installed
      if (tr !== undefined && tr !== r && typeof (f.config as Obj).inverseKey === 'string')
        problem(
          ['sheets', si, 'fields', fi],
          `"${f.key}" links both ways to a sheet of another level. Link one way.`,
        );
    });
    s.forms.forEach((f, fi) => {
      if (rank(f.level, ['sheets', si, 'forms', fi]) < r)
        problem(
          ['sheets', si, 'forms', fi],
          `The form "${f.ref}" cannot install before its sheet.`,
        );
    });
  });

  m.automations.forEach((a, ai) => {
    const r = rank(a.level, ['automations', ai]);
    const sheetsUsed = [
      a.sheet,
      ...a.actions.flatMap((x) => (typeof x.sheetRef === 'string' ? [x.sheetRef] : [])),
    ];
    for (const ref of sheetsUsed)
      if ((sheetRank.get(ref) ?? 0) > r)
        problem(
          ['automations', ai],
          `"${a.ref}" uses "${ref}", which is installed only from ${name(sheetRank.get(ref)!)}.`,
        );
  });

  m.dashboards.forEach((d, di) => {
    const r = rank(d.level, ['dashboards', di]);
    d.widgets.forEach((w, wi) => {
      if (w.sheetRef && (sheetRank.get(w.sheetRef) ?? 0) > r)
        problem(
          ['dashboards', di, 'widgets', wi],
          `"${w.ref}" uses "${w.sheetRef}", which is installed only from ${name(sheetRank.get(w.sheetRef)!)}.`,
        );
      if (w.library && !libraries.has(w.library))
        problem(
          ['dashboards', di, 'widgets', wi],
          `"${w.library}" is not one of the pack's frameworks.`,
        );
    });
  });

  // the setup checklist: at every level, each step names sheets, fields and views installed at that level
  if (m.setup) {
    const steps = m.setup.steps;
    const seen = new Set<string>();
    steps.forEach((step, si) => {
      const at = ['setup', 'steps', si];
      if (seen.has(step.ref)) problem(at, `Duplicate step "${step.ref}".`);
      seen.add(step.ref);
      for (const l of Object.keys(step.levels ?? {}))
        if (!keys.has(l)) problem(at, `Unknown level "${l}".`);
      const each = levels.length
        ? levels.map((l, r) => ({ key: l.key, r }))
        : [{ key: null, r: 0 }];
      for (const { key, r } of each) {
        const s = stepAt(step, key);
        const targets: SetupRule[] = [s.target, ...s.rules];
        for (const t of targets) {
          const where = key ? ` at ${name(r)}` : '';
          if (!!t.sheetRef === !!t.library) {
            problem(at, `"${step.ref}" names a sheetRef or a library${where}.`);
            continue;
          }
          if (t.library) {
            if (!libraries.has(t.library))
              problem(at, `"${t.library}" is not one of the pack's frameworks.`);
            continue;
          }
          const sheet = m.sheets.find((x) => x.ref === t.sheetRef);
          if (!sheet) {
            problem(at, `Unknown sheet "${t.sheetRef}".`);
            continue;
          }
          if (sheetRank.get(sheet.ref)! > r)
            problem(at, `"${step.ref}" uses "${sheet.ref}"${where}, which is not installed there.`);
          // a saved view, or a form (a form opens in the sheet's Forms tab), installed at this level
          const form = t.view ? sheet.forms.find((f) => f.name === t.view) : undefined;
          if (t.view && !form && !sheet.views.some((v) => v.name === t.view))
            problem(at, `Unknown view "${t.view}" on "${sheet.ref}".`);
          if (form && rank(form.level, at) > r)
            problem(
              at,
              `"${step.ref}" opens the form "${form.ref}"${where}, which is not installed there.`,
            );
          const conds = [...(t.where ?? []), ...(t.all ?? [])];
          for (const c of conds)
            if (!sheet.fields.some((f) => f.key === c.fieldKey))
              problem(at, `Unknown field "${c.fieldKey}" on "${sheet.ref}".`);
        }
      }
    });
  }
  return out;
}
