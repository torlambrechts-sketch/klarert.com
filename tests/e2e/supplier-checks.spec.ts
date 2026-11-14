import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// Supplier requirement checks (docs/11 Supplier management 1.1.0): an owner installs the pack; a supplier's panel
// shows its checks as a checklist; "Sync requirements" adds the checks its category, criticality and personal data
// call for ("Added 7, flagged 0"); a second sync changes nothing (one check per supplier and requirement); lowering
// the criticality flags the checks that no longer apply ("No longer applies"), never deleting them.

const TITLE = 'Supplier management';
const SHOTS = process.env.SUPPLIER_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

test('supplier requirement checks: install, sync from the panel, flag on a change', async ({
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
  const slug = seedWorkspace('suppliers', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
  if (port !== '3000') {
    await page.unrouteAll();
    await page.goto(`/${slug}/settings?tab=packs`);
  }

  // ── install
  const row = page
    .getByRole('list', { name: 'Available packs' })
    .getByRole('listitem')
    .filter({ hasText: TITLE });
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    await row.getByRole('button', { name: `Preview ${TITLE}` }).click();
    await expect(dialog).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  // the frameworks are optional: nothing is adopted for you
  await expect(dialog.getByTestId('adopts-framework')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect(dialog.getByRole('status')).toContainText(`Installed ${TITLE}`, { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();

  const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
  const sheets = await rest<{ id: string; name: string }[]>(
    page,
    `sheets?org_id=eq.${org!.id}&archived_at=is.null&select=id,name`,
  );
  const sheetId = (name: string) => sheets.find((s) => s.name === name)!.id;
  const suppliers = sheetId('Supplier register');
  const checks = sheetId('Supplier requirement checks');
  const [cloud] = await rest<{ id: string; display_id: string }[]>(
    page,
    `items?sheet_id=eq.${suppliers}&name=eq.Northwind Cloud Hosting&select=id,display_id`,
  );
  const sync = async () => {
    await page.getByRole('button', { name: 'About Sync requirements' }).click();
    await page
      .getByRole('group', { name: 'Sync requirements' })
      .getByRole('button', { name: 'Sync requirements' })
      .click();
  };
  const countChecks = async () =>
    (await rest<{ id: string }[]>(page, `items?sheet_id=eq.${checks}&select=id`)).length;
  expect(await countChecks()).toBe(4);

  // ── the supplier's panel: the example checks as a checklist, expired evidence said in words
  await page.goto(`/${slug}/s/${suppliers}?item=${cloud!.display_id}`);
  const list = page.getByTestId('checklist');
  await expect(list.getByRole('heading', { name: /Requirement checks/ })).toBeVisible();
  const items = list.getByRole('list', { name: 'Requirement checks' }).getByRole('listitem');
  await expect(items).toHaveCount(4);
  await expect(items.filter({ hasText: 'Valid ISO/IEC 27001 certificate' })).toContainText(
    '(expired)',
  );
  await expect(items.filter({ hasText: 'Transfer mechanism' })).toContainText('Not met');

  // ── Sync requirements: IT and cloud, High, processes personal data → 11 requirements apply
  await sync();
  await expect(page.getByText(/Sync requirement checks \(Added 7, flagged 0\)/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(items).toHaveCount(11, { timeout: 15_000 });
  if (SHOTS)
    await page
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'Added 7' })
      .screenshot({ path: `${SHOTS}/02-sync-toast.png` });
  expect(await countChecks()).toBe(11);
  await list.getByRole('heading').scrollIntoViewIfNeeded();
  await list.getByRole('heading').evaluate((h) => h.scrollIntoView({ block: 'start' }));
  await shot(page, '01-supplier-checklist');

  // a second sync changes nothing: one check per supplier and requirement
  await sync();
  await expect(page.getByText(/Every check is up to date/)).toBeVisible({ timeout: 30_000 });
  expect(await countChecks()).toBe(11);

  // ── criticality down to Low: the checks that need High or Medium are flagged, not deleted (audit rights,
  // certificate, continuity, insurance); the breach notice stays, as it is one of the supplier's extra requirements
  const fields = await rest<{ id: string; key: string }[]>(
    page,
    `fields?sheet_id=eq.${suppliers}&select=id,key`,
  );
  const crit = fields.find((f) => f.key === 'criticality')!.id;
  await rest(page, 'rpc/set_item_values', {
    method: 'POST',
    body: { p_item: cloud!.id, p_patch: { [crit]: 'opt_low' } },
  });
  // the API write runs no automations: the button syncs as the person would after the change
  await page.reload();
  await sync();
  await expect(page.getByText(/Added 0, flagged 4/)).toBeVisible({ timeout: 30_000 });
  expect(await countChecks()).toBe(11);
  await expect(items.filter({ hasText: 'No longer applies' })).toHaveCount(4, { timeout: 15_000 });
  // 390 px: the rows stack as cards
  await page.setViewportSize({ width: 390, height: 844 });
  await list.getByRole('heading').evaluate((h) => h.scrollIntoView({ block: 'start' }));
  await shot(page, '04-checklist-390');
  await page.setViewportSize({ width: 1280, height: 720 });

  // ── the checks sheet with its saved views
  await page.goto(`/${slug}/s/${checks}`);
  await expect(page.getByRole('heading', { name: 'Supplier requirement checks' })).toBeVisible();
  for (const v of ['All checks', 'Not met', 'Expired evidence', 'Not checked'])
    await expect(page.getByRole('tab', { name: v })).toBeVisible();
  await shot(page, '03-checks-sheet');
});
