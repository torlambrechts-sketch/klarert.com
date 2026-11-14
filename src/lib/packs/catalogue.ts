// The packs this repository ships (docs/11): native pack files (templates/packs/*.json), the first-sheet template and
// two wizard starts wrapped as packs. App files (templates/apps/*.json, docs/13) join the pack they name before the
// manifest is checked, so the catalogue carries them. The seed writes them into the `packs` catalogue table; the app
// reads the table.
import capaApp from '../../../templates/apps/capa.json';
import firstSheet from '../../../templates/first-sheet.json';
import core from '../../../templates/packs/core.json';
import gdpr from '../../../templates/packs/gdpr.json';
import iso14001 from '../../../templates/packs/iso-14001.json';
import iso27001 from '../../../templates/packs/iso-27001.json';
import iso45001 from '../../../templates/packs/iso-45001.json';
import iso9001 from '../../../templates/packs/iso-9001.json';
import nis2 from '../../../templates/packs/nis2.json';
import supplierManagement from '../../../templates/packs/supplier-management.json';
import type { AppFile } from '@/engine/apps/types';
import { satisfies } from '@/engine/packs/semver';
import type { PackManifest } from '@/engine/packs/types';
import { parseAppFile } from '@/lib/apps/manifest';
import { parseTemplate } from '@/lib/templates/schema';
import { startById } from '@/lib/starts';
import { parsePack } from './manifest';
import { startToPack, templateToPack } from './wrap';

/** Wizard starts shipped as one-sheet packs too (the wizard keeps making them its own way). */
export const START_PACKS = ['capa', 'documents', 'incident', 'audit'] as const;

/** The app files of the repository (templates/apps/*.json). */
export const repoApps = (): AppFile[] => [parseAppFile(capaApp)];

/** Each app file added to the pack it requires; a pack missing or at a version out of range is an error. */
export function withApps(packs: PackManifest[], files: AppFile[]): PackManifest[] {
  const out = packs.map((p) => ({ ...p }));
  for (const f of files) {
    const pack = out.find((p) => p.key === f.requires.pack);
    if (!pack) throw new Error(`App "${f.app.key}" needs the pack "${f.requires.pack}".`);
    if (!satisfies(pack.version, f.requires.range))
      throw new Error(
        `App "${f.app.key}" needs ${f.requires.pack} ${f.requires.range}, the repository has ${pack.version}.`,
      );
    pack.apps = [...(pack.apps ?? []), f.app];
  }
  return out;
}

export function repoPacks(): PackManifest[] {
  const first = templateToPack(parseTemplate(firstSheet), {
    version: '1.0.0',
    title: 'Corrective actions (first sheet)',
    description:
      'Corrective actions with a linked Actions sheet, sample items, two-way links, a lookup, a formula, a button and 9 automations.',
  });
  return withApps(
    [
      parsePack(first),
      parsePack(supplierManagement),
      parsePack(iso27001),
      parsePack(iso9001),
      parsePack(gdpr),
      parsePack(core),
      parsePack(iso14001),
      parsePack(nis2),
      parsePack(iso45001),
      ...START_PACKS.map((id) => parsePack(startToPack(startById(id)!))),
    ],
    repoApps(),
  ).map((p) => parsePack(p));
}
