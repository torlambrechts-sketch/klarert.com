import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// Supplier management 3.0.0 (docs/11): an owner installs the add-on into an empty workspace; the Core registers are
// installed first. The add-on has no supplier register of its own: its columns, forms, examples, automations and the
// Supplier approval workflow are on Core's Suppliers register, and its reviews, requirement library and checks sit in
// the Suppliers domain beside it; supplier documents are in Documents and policies (its "Supplier documents" view).
// A supplier's panel shows its checks as a checklist; "Sync requirements" adds the checks its category, Core's
// criticality and personal data call for ("Added 7, flagged 0"); a second sync changes nothing; lowering the
// criticality flags the checks that no longer apply, never deleting them. The review escalation is in test mode.

const TITLE = 'Supplier management';
const SHOTS = process.env.SUPPLIER_SHOTS;
const CORE12_SHOTS = process.env.CORE12_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

test('supplier management add-on: Core first, the Suppliers domain, checks and their sync, approval', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'phone', 'desktop walkthrough');
  test.setTimeout(300_000);
  const slug = seedWorkspace('suppliers', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/home`);
  await page.goto(`/${slug}/home`);

  // ── Create offers 3.1.1 for "Supplier onboarding" (a new major: a fresh install)
  const wizard = page.getByRole('dialog', { name: 'Create' });
  await expect(async () => {
    await page.keyboard.press('Control+k');
    await expect(wizard).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await wizard.getByTestId('create-goal').fill('supplier onboarding');
  await wizard.getByTestId('create-matches').getByRole('button').filter({ hasText: TITLE }).click();
  const preview = wizard.getByTestId('create-preview');
  await expect(preview.getByRole('heading', { name: TITLE })).toBeVisible();
  await expect(preview).toContainText('3.1.1');
  await page.keyboard.press('Escape');
  await expect(wizard).toBeHidden();

  // ── install from Workspace admin › Packs: Core first; the frameworks are optional, nothing is adopted for you
  await page.goto(`/${slug}/settings?tab=packs`);
  const row = page
    .getByRole('list', { name: 'Available packs' })
    .getByRole('listitem')
    .filter({ hasText: TITLE });
  await expect(row).toContainText('3.1.1');
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    await row.getByRole('button', { name: `Preview ${TITLE}` }).click();
    await expect(dialog).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await expect(dialog.getByTestId('installs-first')).toContainText(
    'Installs Shared registers 1.3.0 (Recommended) first.',
    { timeout: 30_000 },
  );
  await expect(dialog.getByTestId('adopts-framework')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect(dialog.getByRole('status')).toContainText(`Installed ${TITLE}`, {
    timeout: 120_000,
  });
  await dialog.getByRole('button', { name: 'Done' }).click();

  const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
  const installs = await rest<{ pack_key: string }[]>(
    page,
    `pack_installs?org_id=eq.${org!.id}&status=eq.installed&select=pack_key&order=installed_at`,
  );
  expect(installs.map((i) => i.pack_key)).toEqual(['core', 'supplier-management']);
  const sheets = await rest<{ id: string; name: string; folder_id: string | null }[]>(
    page,
    `sheets?org_id=eq.${org!.id}&archived_at=is.null&parent_sheet_id=is.null&select=id,name,folder_id`,
  );
  const sheetId = (name: string) => sheets.find((s) => s.name === name)!.id;
  // Core's Suppliers register is the supplier register
  const suppliers = sheetId('Suppliers');
  const checks = sheetId('Supplier requirement checks');
  expect(sheets.some((s) => s.name === 'Supplier documents')).toBe(false);
  expect(sheets.some((s) => s.name === 'Supplier register')).toBe(false);
  const [supplierSheet] = await rest<{ pack_install_id: string }[]>(
    page,
    `sheets?id=eq.${suppliers}&select=pack_install_id`,
  );
  const [coreInstall] = await rest<{ id: string }[]>(
    page,
    `pack_installs?org_id=eq.${org!.id}&pack_key=eq.core&select=id`,
  );
  expect(supplierSheet!.pack_install_id).toBe(coreInstall!.id);

  // ── the Suppliers domain in the side menu, after the Core domains
  await page.goto(`/${slug}/home`);
  const menu = page.getByRole('navigation', { name: 'Side menu' });
  await expect(menu.getByTestId('menu-domain')).toHaveText([
    'Management system',
    'Risk and controls',
    'Operations',
    'Suppliers',
  ]);
  for (const name of [
    'Suppliers',
    'Supplier reviews',
    'Supplier requirements',
    'Supplier requirement checks',
  ])
    await expect(menu.getByRole('link', { name, exact: true })).toBeVisible();
  await shot(page, '05-suppliers-domain');

  // ── supplier documents are Core documents, with the add-on's view
  await menu.getByRole('link', { name: 'Documents and policies' }).click();
  await page
    .getByRole('tablist', { name: 'Saved views of this table' })
    .getByRole('tab', { name: 'Supplier documents' })
    .click();
  await expect(
    page.getByRole('gridcell', { name: /Supplier code of conduct/ }).first(),
  ).toBeVisible();
  await expect(page.getByRole('gridcell', { name: /How we control documents/ })).toHaveCount(0);

  // ── the review escalation starts in test mode; the register has the approval workflow
  const [escalation] = await rest<{ mode: string }[]>(
    page,
    `automations?org_id=eq.${org!.id}&pack_ref=eq.review_overdue_escalate&select=mode`,
  );
  expect(escalation!.mode).toBe('test');
  await page.goto(`/${slug}/s/${suppliers}/settings#approvals`);
  await expect(page.getByRole('list', { name: 'Approval workflows' })).toContainText(
    'Supplier approval',
  );

  const [cloud] = await rest<{ id: string; display_id: string }[]>(
    page,
    `items?sheet_id=eq.${suppliers}&name=eq.Example: Northwind Cloud Hosting&select=id,display_id`,
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
  await expect(
    page.getByTestId('item-approvals').getByRole('button', { name: 'Submit for approval' }),
  ).toBeVisible();
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
  expect(await countChecks()).toBe(11);
  await list.getByRole('heading').evaluate((h) => h.scrollIntoView({ block: 'start' }));
  await shot(page, '06-supplier-checklist');
  if (CORE12_SHOTS) {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await list.getByRole('heading').evaluate((h) => h.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `${CORE12_SHOTS}/supplier-management-3-checks.png` });
    await page.setViewportSize({ width: 1280, height: 720 });
  }

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
  await shot(page, '07-checklist-390');
  await page.setViewportSize({ width: 1280, height: 720 });

  // ── the checks sheet: four tabs
  await page.goto(`/${slug}/s/${checks}`);
  await expect(page.getByRole('heading', { name: 'Supplier requirement checks' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('link')).toHaveText([
    /^Table/,
    'Not met',
    'By status',
    'Calendar',
  ]);
  // the Table's saved views stay one click away
  for (const v of ['All checks', 'Expired evidence', 'Not checked'])
    await expect(
      page
        .getByRole('tablist', { name: 'Saved views of this table' })
        .getByRole('tab', { name: v }),
    ).toBeVisible();
  await shot(page, '08-checks-sheet');

  // ── 3.1.1: "Met checks with expired evidence" counts a Met check whose evidence has expired (3.1.0 always read 0)
  const checkFields = await rest<{ id: string; key: string }[]>(
    page,
    `fields?sheet_id=eq.${checks}&select=id,key`,
  );
  const checkField = (k: string) => checkFields.find((f) => f.key === k)!.id;
  const [aCheck] = await rest<{ id: string }[]>(
    page,
    `items?sheet_id=eq.${checks}&archived_at=is.null&select=id&order=position&limit=1`,
  );
  await rest(page, 'rpc/set_item_values', {
    method: 'POST',
    body: {
      p_item: aCheck!.id,
      p_patch: { [checkField('status')]: 'opt_met', [checkField('evidence_expiry')]: '2026-01-31' },
    },
  });
  const [install] = await rest<{ ref_map: Record<string, string> }[]>(
    page,
    `pack_installs?org_id=eq.${org!.id}&pack_key=eq.supplier-management&status=eq.installed&select=ref_map`,
  );
  await page.goto(`/${slug}/dashboards/${install!.ref_map['dashboard:overview']}`);
  const expired = page.getByRole('listitem', { name: 'Met checks with expired evidence' });
  await expect(expired.getByText('1', { exact: true })).toBeVisible();
  await expired.scrollIntoViewIfNeeded();
  await shot(page, '09-met-checks-expired');
});
