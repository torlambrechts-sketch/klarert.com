// What a standard installs, as a standard's page on the public site shows it (/standards/iso-9001): its own sheets
// with their level, the shared registers it adds to and what it adds there, its forms, approval workflows,
// automations, dashboards and setup checklist, in the words people read (words.ts). Pure: manifests in, plain data
// out, so the page reads the catalogue and cannot drift from what an install does (docs/11).
import { levelName, packProse, packTitle } from './words';
import type { PackManifest } from './types';

export interface StandardInstall {
  key: string;
  title: string;
  /** Level names lowest first (Recommended, Everything); empty when the standard installs whole. */
  levels: { name: string; summary: string }[];
  /** The standard's own sheets; `level` is the level that adds a sheet when it is not the lowest. */
  sheets: { name: string; level: string | null; description: string }[];
  /** Shared registers it adds to: the columns, forms and automations it adds on each. */
  registers: { name: string; columns: number; forms: string[]; automations: number }[];
  forms: string[];
  workflows: { name: string; steps: string[] }[];
  automations: string[];
  dashboards: string[];
  setup: { title: string; steps: string[] } | null;
  apps: string[];
}

export function standardInstall(pack: PackManifest, all: readonly PackManifest[]): StandardInstall {
  const levels = pack.levels ?? [];
  const lowest = levels[0]?.key;
  const levelLabel = new Map(levels.map((l) => [l.key, levelName(l.name)]));
  const required = (key: string) => all.find((p) => p.key === key);
  const sheetName = (packKey: string, ref: string) =>
    required(packKey)?.sheets.find((s) => s.ref === ref)?.name ?? ref;

  const ownForms = pack.sheets.flatMap((s) => (s.forms ?? []).map((f) => f.name));
  const extForms = (pack.extends ?? []).flatMap((e) => (e.forms ?? []).map((f) => f.name));
  const ownWorkflows = pack.sheets.flatMap((s) => s.workflows ?? []);
  const extWorkflows = (pack.extends ?? []).flatMap((e) => e.workflows ?? []);

  return {
    key: pack.key,
    title: packTitle(pack.title),
    levels: levels.map((l) => ({ name: levelName(l.name), summary: packProse(l.description) })),
    sheets: pack.sheets.map((s) => ({
      name: s.name,
      level: s.level && s.level !== lowest ? (levelLabel.get(s.level) ?? s.level) : null,
      description: packProse(s.description ?? ''),
    })),
    registers: (pack.extends ?? [])
      .filter((e) => e.fields?.length || e.forms?.length || e.automations?.length)
      .map((e) => ({
        name: sheetName(e.pack, e.sheet),
        columns: e.fields?.length ?? 0,
        forms: (e.forms ?? []).map((f) => f.name),
        automations: e.automations?.length ?? 0,
      })),
    forms: [...ownForms, ...extForms],
    workflows: [...ownWorkflows, ...extWorkflows].map((w) => ({
      name: w.name,
      steps: w.steps.map((s) => s.name),
    })),
    automations: [
      ...pack.automations.map((a) => a.name),
      ...(pack.extends ?? []).flatMap((e) => (e.automations ?? []).map((a) => a.name)),
    ],
    dashboards: pack.dashboards.map((d) => d.name),
    setup: pack.setup
      ? { title: pack.setup.title, steps: pack.setup.steps.map((s) => s.title) }
      : null,
    apps: (pack.apps ?? []).map((a) => a.title),
  };
}
