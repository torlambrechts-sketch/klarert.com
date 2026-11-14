// Test helpers for the standards' Core add-ons (docs/11 Core registers, Extends): plan the Core registers at the level
// an add-on needs, then plan the add-on on top of them with its framework library adopted, the way installPack does.
// Only imported by tests.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neededLevel } from '@/engine/packs/extend';
import { afterInstall } from '@/engine/packs/installed.fixture';
import { planPackInstall, type PackSnapshot } from '@/engine/packs/plan';
import type { PackManifest } from '@/engine/packs/types';
import { repoPacks } from './catalogue';

export const packs = repoPacks();
export const packByKey = (key: string) => packs.find((p) => p.key === key)!;
export const core = packByKey('core');

export const emptySnapshot = (over: Partial<PackSnapshot> = {}): PackSnapshot => ({
  orgId: 'org-1',
  prefixes: [],
  folders: [],
  installs: [],
  members: [],
  jobRoles: [],
  teams: [],
  lastSheetPosition: null,
  lastFolderPosition: null,
  lastDashboardPosition: null,
  ...over,
});

let n = 0;
export const env = {
  today: '2026-11-14',
  now: new Date('2026-11-14T10:00:00Z'),
  timeZone: 'Europe/Oslo',
  newId: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
  hash: 'h',
  userId: 'u-1',
};

/** The requirement keys of a framework file, each standing for a library item id. */
export function libraryItems(key: string, version: string): Record<string, string> {
  const fw = JSON.parse(
    readFileSync(join(process.cwd(), `templates/frameworks/${key}-${version}.json`), 'utf8'),
  ) as { requirements: { ref: string }[] };
  return Object.fromEntries(
    fw.requirements.map((r) => [`${key}@${version}#${r.ref}`, `req:${key}@${version}#${r.ref}`]),
  );
}

/**
 * Core installed at the level the add-on needs, then the add-on planned on top of it at `level`, with the add-on's
 * frameworks adopted (each requirement an item `req:<key>`).
 */
export function planAddon(addon: PackManifest, level: string | null = null) {
  const coreLevel = neededLevel(addon, core);
  const corePlan = planPackInstall(core, emptySnapshot(), env, { level: coreLevel });
  const libraries = (addon.frameworks ?? []).map((f) => ({
    library: `${f.key}@${f.version}`,
    sheetId: `lib:${f.key}@${f.version}`,
  }));
  const requirementItems = Object.assign(
    {},
    ...(addon.frameworks ?? []).map((f) => libraryItems(f.key, f.version)),
  ) as Record<string, string>;
  const snap = afterInstall(
    emptySnapshot({ libraries, requirementItems }),
    corePlan.payload!,
    'inst-core',
  );
  const plan = planPackInstall(addon, snap, env, level ? { level } : {});
  return { coreLevel, corePayload: corePlan.payload!, snap, plan };
}

/** Every requirement key an add-on's example items name, own sheets and extensions alike. */
export const requirementKeysOf = (m: PackManifest): string[] => [
  ...new Set([
    ...m.sheets.flatMap((s) => s.items.flatMap((i) => Object.values(i.requirements ?? {}).flat())),
    ...(m.extends ?? []).flatMap((e) =>
      (e.items ?? []).flatMap((i) => Object.values(i.requirements ?? {}).flat()),
    ),
  ]),
];

/** The requirement keys an item of the plan links to through a field (refs as install_pack keeps them). */
export function linkedRequirements(
  payload: NonNullable<ReturnType<typeof planAddon>['plan']['payload']>,
  fieldRef: string,
  itemRef: string,
): string[] {
  const field = payload.fields.find((f) => f.ref === fieldRef)?.id;
  const item = payload.items.find((i) => i.ref === itemRef)?.id;
  return payload.links
    .filter((l) => l.field_id === field && l.from_item === item)
    .map((l) => l.to_item.replace(/^req:/, ''))
    .sort();
}

/** The preview before Core is installed: Core is installed first (the command plans again then). */
export function previewBeforeCore(addon: PackManifest) {
  const level = neededLevel(addon, core);
  return planPackInstall(addon, emptySnapshot(), env, {
    installFirst: [
      {
        key: 'core',
        title: core.title,
        version: core.version,
        level,
        levelName: core.levels?.find((l) => l.key === level)?.name ?? null,
        raise: false,
        sheets: Object.fromEntries(
          core.sheets.map((s) => [
            s.ref,
            { name: s.name, standards: s.fields.some((f) => f.key === 'standards') },
          ]),
        ),
      },
    ],
  });
}
