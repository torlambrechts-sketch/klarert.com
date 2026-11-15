import { expect, test } from '@playwright/test';
import {
  coreSheet,
  expectStandardView,
  expectTestMode,
  expectWorkflow,
  installAddon,
  sheetFolders,
  shots,
} from './addon-helpers';
import { seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// The ISO 45001 add-on (docs/11 The ISO 45001 add-on): an owner installs it into an empty workspace; the Core
// registers (Starter) and the ISO 45001:2018 library come first; the hazard register sits in Risk and controls and
// worker consultation in Management system; the shared Incidents register shows the ISO 45001 view with the near
// miss and its injury form; the high residual risk escalation starts in test mode; the hazards carry the Risk
// acceptance workflow.

const TITLE = 'ISO 45001 health and safety';
const shot = shots(process.env.PACK_SHOTS, 'iso-45001');

test('install the ISO 45001 add-on on Core and find it in the shared registers', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'phone', 'desktop walkthrough');
  test.setTimeout(240_000);
  const slug = seedWorkspace('ohs', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
  const i = await installAddon(page, slug, {
    title: TITLE,
    key: 'iso-45001',
    coreLevel: 'Recommended',
    library: 'ISO 45001:2018',
    shot,
  });

  expect(await sheetFolders(page, i)).toEqual({
    'Hazards and OH&S risks (HIRA)': 'Risk and controls',
    'Worker consultation and participation': 'Management system',
  });

  // ── injuries and near misses in the shared Incidents register, under the ISO 45001 view
  const incidents = await coreSheet(page, i, 'incidents');
  await expectStandardView(page, slug, incidents, 'ISO 45001');
  await expect(
    page.getByRole('gridcell', { name: /Pallet fell from the top rack/ }).first(),
  ).toBeVisible();
  const forms = await rest<{ name: string; config: { form: { access: string } } }[]>(
    page,
    `views?sheet_id=eq.${incidents}&type=eq.form&pack_install_id=eq.${i.addon}&select=name,config`,
  );
  // the add-on's own form (Core 1.1.0 has its general "Report an incident" there too)
  expect(forms.map((f) => [f.name, f.config.form.access])).toEqual([
    ['Report an injury or near miss', 'internal'],
  ]);

  // ── an advanced automation (high risk after controls) starts in test mode
  await expectTestMode(
    page,
    slug,
    'Risk after controls 12 or more → stop and tell the HSE manager',
  );

  // ── the Risk acceptance workflow on the hazards
  const [hazards] = await rest<{ id: string }[]>(
    page,
    `sheets?pack_install_id=eq.${i.addon}&pack_ref=eq.hazards&select=id`,
  );
  await expectWorkflow(page, slug, hazards!.id, 'Risk acceptance');
  await page.goto(`/${slug}/s/${hazards!.id}`);
  await expect(
    page.getByRole('gridcell', { name: /Forklift and pedestrians/ }).first(),
  ).toBeVisible();
  await shot(page, '02-hazards');
});
