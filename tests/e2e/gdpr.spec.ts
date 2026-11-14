import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// The GDPR pack and retention (docs/11, docs/02 §18): an owner installs Starter, which adopts the GDPR library first;
// the example erasure request's closing date is moved back past its 3-year retention rule; "Check now" on Workspace
// admin › Retention queues it; the owner approves; the requester's details are erased, a tombstone is logged without
// them and the item's chain still verifies.

const TITLE = 'GDPR privacy programme';
const SHOTS = process.env.GDPR_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

test('install GDPR Starter and erase a request record under its retention rule', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'phone', 'desktop walkthrough');
  test.setTimeout(240_000);
  // local auth sends magic links to the site URL (port 3000): when this suite runs on another port, follow them here
  const port = new URL(info.project.use.baseURL ?? 'http://localhost:3000').port;
  if (port !== '3000')
    await page.route('http://localhost:3000/**', (route) =>
      route.fulfill({
        status: 302,
        headers: { location: route.request().url().replace('localhost:3000', `localhost:${port}`) },
      }),
    );
  const slug = seedWorkspace('gdpr', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
  if (port !== '3000') {
    await page.unrouteAll();
    await page.goto(`/${slug}/settings?tab=packs`);
  }

  // ── install Starter: the GDPR library is adopted first
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
  await expect(dialog.getByTestId('adopts-framework')).toContainText('GDPR');
  await expect(dialog).toContainText('Installs 1 folder, 7 sheets');
  await shot(page, '01-install-dialog');
  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect(dialog.getByRole('status')).toContainText(`Installed ${TITLE} (Starter).`, {
    timeout: 60_000,
  });
  await dialog.getByRole('button', { name: 'Done' }).click();

  const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
  const sheets = await rest<{ id: string; name: string }[]>(
    page,
    `sheets?org_id=eq.${org!.id}&parent_sheet_id=is.null&is_library=eq.false&archived_at=is.null&select=id,name&order=position`,
  );
  expect(sheets.map((s) => s.name)).toEqual([
    'Records of processing',
    'Data subject requests',
    'Personal data breaches',
    'DPIAs',
    'Processors and DPAs',
    'Transfers outside the EEA',
    'Retention schedule',
  ]);
  const dsr = sheets.find((s) => s.name === 'Data subject requests')!;

  // the request sheet: the deadline formula and the form tab
  await page.goto(`/${slug}/s/${dsr.id}`);
  await expect(page.getByRole('heading', { name: 'Data subject requests' })).toBeVisible();
  await expect(page.getByText('Example: access request')).toBeVisible();
  await shot(page, '02-requests');

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

  // the sheet's rules in its settings
  await page.goto(`/${slug}/s/${dsr.id}/settings#retention`);
  await expect(page.getByRole('list', { name: 'Retention rules' })).toContainText(
    '3 years after Closed on once done: erase the personal data (Requester, Requester contact, Details to find their data), personal files and comments',
  );
  await page.getByRole('heading', { name: 'Retention', exact: true }).scrollIntoViewIfNeeded();
  await shot(page, '03-sheet-retention');

  // ── the queue: check now, approve
  await page.goto(`/${slug}/settings?tab=retention`);
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByText('Retention checked. 1 record was added to the queue.')).toBeVisible();
  const queue = page.getByRole('list', { name: 'Records to review' });
  await expect(queue).toContainText('Example: erasure request');
  await expect(queue).toContainText('Due 31 Jan 2025');
  await shot(page, '04-retention-queue');
  await queue
    .getByRole('button', { name: `Approve: ${item!.display_id} Example: erasure request` })
    .click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('This cannot be undone.');
  await shot(page, '05-approve-dialog');
  await confirm.getByRole('button', { name: 'Erase personal data' }).click();
  await expect(page.getByText('Erased: 3 fields.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Recently approved' })).toContainText(
    'Example: erasure request',
  );

  // erased in the item, never in the tombstone, and the chain still verifies
  const [after] = await rest<{ values: Record<string, unknown> }[]>(
    page,
    `items?id=eq.${item!.id}&select=values`,
  );
  for (const k of ['requester', 'requester_email', 'requester_details'])
    expect(after!.values).not.toHaveProperty(fid(k));
  expect(after!.values[fid('response')]).toBeTruthy();
  const log = await rest<{ action: string; new_value: unknown }[]>(
    page,
    `activity_log?item_id=eq.${item!.id}&select=action,new_value&order=id.desc&limit=1`,
  );
  expect(log[0]!.action).toBe('retention.erased');
  expect(JSON.stringify(log[0]!.new_value)).not.toContain('former@example.com');
  const verify = await rest<{ ok: boolean; redacted: number }>(page, 'rpc/verify_activity_chain', {
    method: 'POST',
    body: { p_chain_key: item!.id },
  });
  expect(verify.ok).toBe(true);
  expect(verify.redacted).toBeGreaterThan(0);

  // the item's activity says what was erased, and shows erased values as erased
  await page.goto(`/${slug}/s/${dsr.id}?item=${item!.display_id}`);
  const panel = page.getByRole('dialog');
  await panel.getByRole('tab', { name: 'Activity' }).click();
  await expect(panel).toContainText(
    'Personal data erased under “Requests: 3 years after closing”: Requester, Requester contact, Details to find their data',
  );
  await expect(panel).not.toContainText('former@example.com');
  await shot(page, '06-item-activity');

  // the dashboard
  const [dash] = await rest<{ id: string; name: string }[]>(
    page,
    `dashboards?org_id=eq.${org!.id}&select=id,name`,
  );
  expect(dash!.name).toBe('Privacy overview');
  await page.goto(`/${slug}/dashboards/${dash!.id}`);
  await expect(page.getByText('Requests past their deadline')).toBeVisible();
  await shot(page, '07-dashboard');
});
