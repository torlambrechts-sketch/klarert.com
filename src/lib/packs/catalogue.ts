// The packs this repository ships (docs/11): native pack files (templates/packs/*.json), the first-sheet template and
// two wizard starts wrapped as packs. The seed writes them into the `packs` catalogue table; the app reads the table.
import firstSheet from '../../../templates/first-sheet.json';
import iso27001 from '../../../templates/packs/iso-27001.json';
import supplierManagement from '../../../templates/packs/supplier-management.json';
import type { PackManifest } from '@/engine/packs/types';
import { parseTemplate } from '@/lib/templates/schema';
import { startById } from '@/lib/starts';
import { parsePack } from './manifest';
import { startToPack, templateToPack } from './wrap';

/** Wizard starts shipped as one-sheet packs too (the wizard keeps making them its own way). */
export const START_PACKS = ['capa', 'documents'] as const;

export function repoPacks(): PackManifest[] {
  const first = templateToPack(parseTemplate(firstSheet), {
    version: '1.0.0',
    title: 'Corrective actions (first sheet)',
    description:
      'Corrective actions with a linked Actions sheet, sample items, two-way links, a lookup, a formula, a button and 9 automations.',
  });
  return [
    parsePack(first),
    parsePack(supplierManagement),
    parsePack(iso27001),
    ...START_PACKS.map((id) => parsePack(startToPack(startById(id)!))),
  ];
}
