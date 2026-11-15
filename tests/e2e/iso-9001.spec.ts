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

// The ISO 9001 add-on (docs/11 The ISO 9001 add-on): an owner installs it into an empty workspace; the Core registers
// (Starter) and the ISO 9001:2026 library come first; its own sheets sit in Core's domains; the nonconformity
// register shows the ISO 9001 view and the add-on's example; the complaint SLA escalation starts in test mode; the
// Processes sheet carries the Process approval workflow; the headline dashboard reads the Core registers.

const TITLE = 'ISO 9001 quality';
const shot = shots(process.env.PACK_SHOTS, 'iso-9001');

test('install the ISO 9001 add-on on Core and find it in the shared registers', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'phone', 'desktop walkthrough');
  test.setTimeout(240_000);
  const slug = seedWorkspace('qms', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
  const i = await installAddon(page, slug, {
    title: TITLE,
    key: 'iso-9001',
    coreLevel: 'Standard',
    library: 'ISO 9001:2026',
    shot,
  });

  // ── its own sheets in Core's domains
  expect(await sheetFolders(page, i)).toEqual({
    Processes: 'Management system',
    'Customer feedback and complaints': 'Operations',
  });

  // ── the ISO 9001 view on the shared nonconformity register, with the add-on's example and columns
  const nc = await coreSheet(page, i, 'nc');
  await expectStandardView(page, slug, nc, 'ISO 9001');
  await expect(
    page.getByRole('gridcell', { name: /Batch shipped with the wrong label/ }).first(),
  ).toBeVisible();
  await shot(page, '02-nc-iso-9001-view');
  const columns = await rest<{ key: string; system: boolean }[]>(
    page,
    `fields?sheet_id=eq.${nc}&key=like.iso9001_*&select=key,system`,
  );
  expect(columns.length).toBeGreaterThanOrEqual(7);
  expect(columns.every((c) => c.system)).toBe(true);

  // ── an advanced automation (the complaint SLA escalation) starts in test mode
  await expectTestMode(page, slug, 'Complaint not answered in time → tell the quality manager');
  const quiet = await rest<{ pack_ref: string; mode: string }[]>(
    page,
    `automations?pack_install_id=eq.${i.addon}&pack_ref=in.(complaint_answer_late,complaint_nc)&select=pack_ref,mode&order=pack_ref`,
  );
  expect(quiet).toEqual([
    { pack_ref: 'complaint_answer_late', mode: 'test' },
    { pack_ref: 'complaint_nc', mode: 'live' },
  ]);

  // ── the Process approval workflow on Processes, ready to submit from an item
  const [process] = await rest<{ id: string }[]>(
    page,
    `sheets?pack_install_id=eq.${i.addon}&pack_ref=eq.process&select=id`,
  );
  await expectWorkflow(page, slug, process!.id, 'Process approval');
  await page.goto(`/${slug}/s/${process!.id}?item=PRC-001`);
  await expect(
    page.getByTestId('item-approvals').getByRole('button', { name: 'Submit for approval' }),
  ).toBeVisible();

  // ── the headline dashboard reads the Core registers by the ISO 9001 tag
  const [dash] = await rest<{ id: string; name: string }[]>(
    page,
    `dashboards?org_id=eq.${i.org}&name=eq.ISO 9001 audit readiness&select=id,name`,
  );
  await page.goto(`/${slug}/dashboards/${dash!.id}`);
  await expect(page.getByRole('heading', { name: 'ISO 9001 audit readiness' })).toBeVisible();
  await expect(page.getByText('Open ISO 9001 nonconformities')).toBeVisible();
  await shot(page, '03-dashboard');
});
