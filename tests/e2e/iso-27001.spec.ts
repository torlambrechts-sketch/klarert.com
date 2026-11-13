import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// The ISO/IEC 27001:2022 pack (P4, docs/11): an owner installs Starter from Workspace admin › Packs, which adopts the
// 27001 requirement library first; the setup checklist shows on the Packs tab and on Home; adding Full later creates
// only the six sheets Starter does not have. The example risks link to Annex A controls of the adopted library, the
// CAPA actions have their own overdue reminder and Full brings the internal form "Report a security incident".

const TITLE = 'ISO/IEC 27001:2022 ISMS';
const STARTER = [
  'Scope and context',
  'Risk register',
  'Risk treatment plan',
  'ISMS documents',
  'Nonconformities and CAPA',
];
const packRow = (page: Page) =>
  page
    .getByRole('list', { name: 'Available packs' })
    .getByRole('listitem')
    .filter({ hasText: TITLE });

test('install ISO 27001 Starter, follow the setup checklist and add Full', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'phone', 'desktop walkthrough');
  test.setTimeout(240_000);
  const slug = seedWorkspace('iso', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
  await expect(packRow(page)).toContainText('Starter or Full');

  // ── the dialog: choose a level, see what it creates and that the library is adopted first
  await packRow(page)
    .getByRole('button', { name: `Preview ${TITLE}` })
    .click();
  const dialog = page.getByRole('dialog');
  const levels = dialog.getByRole('group', { name: 'Choose a level' });
  await expect(levels.getByRole('radio', { name: 'Starter', exact: true })).toBeChecked();
  await expect(levels).toContainText(`Creates: ${STARTER.join(', ')}`);
  await expect(levels).toContainText('Adds: Asset register, Internal audit programme');
  await expect(dialog.getByTestId('adopts-framework')).toContainText(
    'Adopts the ISO/IEC 27001:2022 requirement library first',
  );
  await expect(dialog).toContainText('Installs 1 folder, 5 sheets');
  await expect(dialog.getByRole('list', { name: 'Dashboards' })).toContainText(
    'ISMS overview with 8 widgets',
  );
  await dialog.getByRole('radio', { name: 'Full', exact: true }).check();
  await expect(dialog).toContainText('Installs 1 folder, 11 sheets');
  await dialog.getByRole('radio', { name: 'Starter', exact: true }).check();
  await expect(dialog).toContainText('Installs 1 folder, 5 sheets');

  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect(dialog.getByRole('status')).toContainText(`Installed ${TITLE} (Starter).`, {
    timeout: 60_000,
  });
  await expect(dialog).toContainText('Adopted ISO/IEC 27001:2022 first.');

  const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
  const sheets = await rest<
    { id: string; name: string; is_library: boolean; pack_install_id: string }[]
  >(
    page,
    `sheets?org_id=eq.${org!.id}&parent_sheet_id=is.null&archived_at=is.null&select=id,name,is_library,pack_install_id&order=position`,
  );
  expect(sheets.filter((s) => !s.is_library).map((s) => s.name)).toEqual(STARTER);
  expect(sheets.filter((s) => s.is_library).map((s) => s.name)).toEqual([
    'ISO/IEC 27001:2022 requirements',
  ]);
  const [install] = await rest<{ id: string; level: string }[]>(
    page,
    `pack_installs?org_id=eq.${org!.id}&pack_key=eq.iso-27001&select=id,level`,
  );
  expect(install!.level).toBe('starter');
  await dialog.getByRole('button', { name: 'Done' }).click();

  // ── the example risks link to Annex A controls of the library the install adopted
  const lib = sheets.find((s) => s.is_library)!;
  const riskSheet = sheets.find((s) => s.name === 'Risk register')!;
  const risks = await rest<{ id: string; name: string }[]>(
    page,
    `items?sheet_id=eq.${riskSheet.id}&select=id,name`,
  );
  const phishing = risks.find((r) => r.name === 'Example: account taken over by phishing')!;
  const links = await rest<{ to_item: string }[]>(
    page,
    `item_links?from_item=eq.${phishing.id}&select=to_item`,
  );
  const annexA = await rest<{ id: string; requirement_ref: string }[]>(
    page,
    `items?sheet_id=eq.${lib.id}&id=in.(${links.map((l) => l.to_item).join(',')})&select=id,requirement_ref`,
  );
  expect(annexA.map((r) => r.requirement_ref).sort()).toEqual([
    'iso-27001@2022#A.6.3',
    'iso-27001@2022#A.8.7',
  ]);
  // the corrective actions (sub-items) have their own overdue reminder
  const [actions] = await rest<{ id: string }[]>(
    page,
    `sheets?org_id=eq.${org!.id}&parent_sheet_id=not.is.null&name=like.Nonconformities*&select=id`,
  );
  const [reminder] = await rest<{ sheet_id: string; enabled: boolean }[]>(
    page,
    `automations?org_id=eq.${org!.id}&pack_ref=eq.capa_action_overdue&select=sheet_id,enabled`,
  );
  expect(reminder).toEqual({ sheet_id: actions!.id, enabled: true });

  // ── the setup checklist on the Packs tab: eight steps with their progress
  await page.reload();
  const steps = page.getByRole('list', { name: 'ISO 27001 setup steps' });
  await expect(steps.getByRole('listitem')).toHaveCount(8);
  await expect(steps.getByRole('listitem').first()).toContainText('1. Define the scope');
  // Starter words the second step its own way: the risk register's three examples name a process each
  await expect(steps.locator('[data-step="assets"]')).toContainText('List your processes');
  await expect(steps.locator('[data-step="assets"]')).toContainText('In progress · 3 of 5');
  await expect(steps.locator('[data-step="risks"]')).toContainText('To do · 0 of 5');
  await expect(steps.locator('[data-step="treat"]')).toContainText(
    'Open ISO/IEC 27001:2022 requirements',
  );
  // Starter has no incident sheet: incidents go to Nonconformities and CAPA
  await expect(steps.locator('[data-step="incidents"]')).toContainText('Record incidents');

  // ── Home: the card with the next step, dismissible
  await page.goto(`/${slug}/home`);
  const card = page.getByTestId('setup-card');
  await expect(card).toContainText('ISO 27001 setup');
  await expect(card).toContainText('Next: step 1 of 8');
  await card.getByRole('link', { name: 'Open Scope and context' }).click();
  await expect(page.getByRole('heading', { name: 'Scope and context' })).toBeVisible();
  await page.goto(`/${slug}/home`);
  await page.getByRole('button', { name: 'Dismiss ISO 27001 setup' }).click();
  await expect(page.getByTestId('setup-card')).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ }),
  ).toBeVisible();
  await expect(page.getByTestId('setup-card')).toHaveCount(0);

  // ── Full on top of Starter: only what is missing
  await page.goto(`/${slug}/settings?tab=packs`);
  await page
    .getByRole('list', { name: 'Installed packs' })
    .getByRole('button', { name: `Add Full ${TITLE}` })
    .click();
  await expect(dialog.getByRole('radio', { name: 'Full', exact: true })).toBeChecked();
  await expect(dialog.getByTestId('extends-level')).toContainText(
    'Starter is installed. Full adds only what is missing',
  );
  await expect(dialog).toContainText('Installs 6 sheets');
  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect(dialog.getByRole('status')).toContainText(`Added Full to ${TITLE}.`, {
    timeout: 60_000,
  });
  const after = await rest<{ name: string; pack_install_id: string }[]>(
    page,
    `sheets?org_id=eq.${org!.id}&parent_sheet_id=is.null&is_library=eq.false&archived_at=is.null&select=name,pack_install_id&order=position`,
  );
  expect(after).toHaveLength(11);
  expect(new Set(after.map((s) => s.pack_install_id))).toEqual(new Set([install!.id]));
  const [full] = await rest<{ level: string }[]>(
    page,
    `pack_installs?id=eq.${install!.id}&select=level`,
  );
  expect(full!.level).toBe('full');

  // ── Full: the internal incident form, a draft, opened from the setup checklist
  await page.reload();
  const report = page
    .getByRole('list', { name: 'ISO 27001 setup steps' })
    .locator('[data-step="incidents"]');
  await expect(report).toContainText('Make incidents easy to report');
  await report.getByRole('link', { name: 'Open Security incidents' }).click();
  await expect(page.getByRole('heading', { name: 'Security incidents' })).toBeVisible();
  await expect(page).toHaveURL(/view=/);
  await expect(page.getByLabel('Form title')).toHaveValue('Report a security incident');
  const [form] = await rest<{ config: { form: { access: string; status: string } } }[]>(
    page,
    `views?org_id=eq.${org!.id}&type=eq.form&name=eq.Report a security incident&select=config`,
  );
  expect(form!.config.form).toMatchObject({ access: 'internal', status: 'draft' });
});
