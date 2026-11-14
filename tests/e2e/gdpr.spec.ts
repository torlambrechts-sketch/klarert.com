import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// The GDPR add-on 2.0.0 (docs/11 The GDPR add-on, docs/02 §18): an owner installs Starter into an empty workspace;
// the Core registers are installed first and the GDPR library adopted; the GDPR sheets sit in the Privacy and
// security and Suppliers domains; the shared risk register has the GDPR view; the incident-to-breach cascade waits in
// test mode; the processing record approval workflow is on its sheet. Then the retention rule erases an old request:
// the example erasure request's closing date is moved back past its 3-year rule, "Check now" queues it, the owner
// approves, the requester's details are erased and the item's chain still verifies.

const TITLE = 'GDPR privacy (add-on)';
const SHOTS = process.env.GDPR_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

test('install the GDPR add-on on Core and erase a request record under its retention rule', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'phone', 'desktop walkthrough');
  test.setTimeout(300_000);
  const slug = seedWorkspace('gdpr', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
  await page.goto(`/${slug}/settings?tab=packs`);

  // ── install Starter: Core registers first, the GDPR library adopted
  const row = page
    .getByRole('list', { name: 'Available packs' })
    .getByRole('listitem')
    .filter({ hasText: TITLE });
  await expect(row).toContainText('Starter or Full');
  const dialog = page.getByRole('dialog');
  // the first click may land before the page is interactive
  await expect(async () => {
    await row.getByRole('button', { name: `Preview ${TITLE}` }).click();
    await expect(dialog).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await expect(dialog.getByTestId('installs-first')).toContainText(
    'Installs Core registers 1.1.0 (Starter) first.',
  );
  await expect(dialog.getByTestId('adopts-framework')).toContainText('GDPR');
  await expect(dialog.getByTestId('extends-list')).toContainText('Risk register');
  await shot(page, '01-install-dialog');
  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect(dialog.getByRole('status')).toContainText(`Installed ${TITLE} (Starter).`, {
    timeout: 90_000,
  });
  await expect(dialog.getByRole('status')).toContainText(
    'Installed Core registers 1.1.0 (Starter) first.',
  );
  await dialog.getByRole('button', { name: 'Done' }).click();

  const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
  const installs = await rest<{ id: string; pack_key: string; version: string }[]>(
    page,
    `pack_installs?org_id=eq.${org!.id}&status=eq.installed&select=id,pack_key,version&order=installed_at`,
  );
  expect(installs.map((i) => i.pack_key).sort()).toEqual(['core', 'framework-gdpr', 'gdpr']);
  const gdpr = installs.find((i) => i.pack_key === 'gdpr')!;
  expect(gdpr.version).toBe('2.0.0');

  // ── its sheets sit in Core's domains
  const sheets = await rest<
    { id: string; name: string; restricted: boolean; folders: { domain: string | null } | null }[]
  >(
    page,
    `sheets?pack_install_id=eq.${gdpr.id}&parent_sheet_id=is.null&select=id,name,restricted,folders(domain)&order=position`,
  );
  expect(sheets.map((s) => [s.name, s.folders?.domain])).toEqual([
    ['Records of processing', 'privacy'],
    ['Data subject requests', 'privacy'],
    ['Personal data breaches', 'privacy'],
    ['DPIAs', 'privacy'],
    ['Processors and DPAs', 'suppliers'],
  ]);
  // personal data sheets are restricted
  expect(sheets.filter((s) => s.restricted).map((s) => s.name)).toEqual([
    'Data subject requests',
    'Personal data breaches',
  ]);
  await page.goto(`/${slug}/home`);
  const menu = page.getByRole('navigation', { name: 'Side menu' });
  await expect(menu.getByTestId('menu-domain')).toHaveText([
    'Management system',
    'Risk and controls',
    'Operations',
    'Privacy and security',
    'Suppliers',
  ]);

  // ── the shared risk register: used by GDPR, with the GDPR view and the Privacy category
  await menu.getByRole('link', { name: 'Risk register' }).click();
  await expect(page.getByRole('heading', { name: 'Risk register', level: 1 })).toBeVisible();
  await expect(page.getByTestId('system-used-by')).toHaveText('Used by GDPR');
  await expect(
    page
      .getByRole('tablist', { name: 'Saved views of this table' })
      .getByRole('tab', { name: 'GDPR view' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('gridcell', { name: /Customer list exposed through a shared export link/ })
      .first(),
  ).toBeVisible();
  await shot(page, '02-risk-register');

  // ── an advanced automation in test mode: the incident-to-breach cascade
  const cascade =
    'Incident is a personal data breach → open a linked breach record and tell the DPO';
  await page.goto(`/${slug}/automations`);
  const cascadeRow = page.getByRole('listitem').filter({ hasText: cascade });
  await expect(cascadeRow.getByTestId('automation-test-mode')).toContainText('Test mode');

  // ── the approval workflow on the records of processing
  const ropa = sheets.find((s) => s.name === 'Records of processing')!;
  await page.goto(`/${slug}/s/${ropa.id}/settings#approvals`);
  await expect(page.getByRole('list', { name: 'Approval workflows' })).toContainText(
    'Processing record approval',
  );

  const dsr = sheets.find((s) => s.name === 'Data subject requests')!;
  await page.goto(`/${slug}/s/${dsr.id}`);
  await expect(page.getByRole('heading', { name: 'Data subject requests' })).toBeVisible();
  await expect(page.getByText('Example: access request')).toBeVisible();
  await shot(page, '03-requests');

  // ── the closed example request, closed long ago: due under "Requests: 3 years after closing"
  const [item] = await rest<{ id: string; display_id: string }[]>(
    page,
    `items?sheet_id=eq.${dsr.id}&name=eq.Example: erasure request&select=id,display_id`,
  );
  const fields = await rest<{ id: string; key: string }[]>(
    page,
    `fields?sheet_id=eq.${dsr.id}&select=id,key`,
  );
  const fid = (k: string) => fields.find((f) => f.key === k)!.id;
  await rest(page, 'rpc/set_item_values', {
    method: 'POST',
    body: { p_item: item!.id, p_patch: { [fid('closed_on')]: '2022-01-31' } },
  });
  await page.goto(`/${slug}/s/${dsr.id}/settings#retention`);
  await expect(page.getByRole('list', { name: 'Retention rules' })).toContainText(
    '3 years after Closed on once done: erase the personal data (Requester, Requester contact, Details to find their data), personal files and comments',
  );

  await page.goto(`/${slug}/settings?tab=retention`);
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByText('Retention checked. 1 record was added to the queue.')).toBeVisible();
  const queue = page.getByRole('list', { name: 'Records to review' });
  await expect(queue).toContainText('Example: erasure request');
  await queue
    .getByRole('button', { name: `Approve: ${item!.display_id} Example: erasure request` })
    .click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('This cannot be undone.');
  await confirm.getByRole('button', { name: 'Erase personal data' }).click();
  await expect(page.getByText('Erased: 3 fields.')).toBeVisible();

  const [after] = await rest<{ values: Record<string, unknown> }[]>(
    page,
    `items?id=eq.${item!.id}&select=values`,
  );
  for (const k of ['requester', 'requester_email', 'requester_details'])
    expect(after!.values).not.toHaveProperty(fid(k));
  expect(after!.values[fid('response')]).toBeTruthy();
  const verify = await rest<{ ok: boolean; redacted: number }>(page, 'rpc/verify_activity_chain', {
    method: 'POST',
    body: { p_chain_key: item!.id },
  });
  expect(verify.ok).toBe(true);
  expect(verify.redacted).toBeGreaterThan(0);

  // ── the headline dashboard
  const [dash] = await rest<{ id: string; name: string }[]>(
    page,
    `dashboards?pack_install_id=eq.${gdpr.id}&select=id,name`,
  );
  expect(dash!.name).toBe('Privacy overview');
  await page.goto(`/${slug}/dashboards/${dash!.id}`);
  await expect(page.getByText('Performance: requests past their deadline')).toBeVisible();
  await shot(page, '04-dashboard');
});
