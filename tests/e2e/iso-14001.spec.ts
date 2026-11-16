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

// The ISO 14001 add-on (docs/11 The ISO 14001 add-on): an owner installs it into an empty workspace; the Core
// registers come first at Full (compliance obligations live in the Legal register) with the ISO 14001:2026 library;
// its sheets sit in the Operations domain, the communications log restricted; the Legal register shows the ISO 14001
// view with the add-on's obligations; the communication SLA escalation starts in test mode; the aspects carry the
// Significance approval workflow.

const TITLE = 'ISO 14001 environment';
const shot = shots(process.env.PACK_SHOTS, 'iso-14001');

test('install the ISO 14001 add-on on Core and find it in the shared registers', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'phone', 'desktop walkthrough');
  test.setTimeout(240_000);
  const slug = seedWorkspace('ems', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
  const i = await installAddon(page, slug, {
    title: TITLE,
    key: 'iso-14001',
    coreLevel: 'Everything',
    library: 'ISO 14001:2026',
    shot,
  });

  expect(await sheetFolders(page, i)).toEqual({
    'Environmental aspects': 'Operations',
    'Environmental monitoring': 'Operations',
    'Environmental communications': 'Operations',
  });
  const [comms] = await rest<{ restricted: boolean }[]>(
    page,
    `sheets?pack_install_id=eq.${i.addon}&pack_ref=eq.communications&select=restricted`,
  );
  expect(comms!.restricted).toBe(true);

  // ── compliance obligations in the shared Legal register, under the ISO 14001 view
  const legal = await coreSheet(page, i, 'legal');
  await expectStandardView(page, slug, legal, 'ISO 14001');
  await expect(
    page.getByRole('gridcell', { name: /Discharge permit for process water/ }).first(),
  ).toBeVisible();
  await shot(page, '02-legal-iso-14001-view');

  // ── an advanced automation (the communication SLA escalation) starts in test mode
  await expectTestMode(page, slug, 'No answer in 14 days → tell the environmental manager');

  // ── the Significance approval workflow on the aspects
  const [aspects] = await rest<{ id: string }[]>(
    page,
    `sheets?pack_install_id=eq.${i.addon}&pack_ref=eq.aspects&select=id`,
  );
  await expectWorkflow(page, slug, aspects!.id, 'Significance approval');
});
