import { expect, test, type Page } from '@playwright/test';
import { finishRow } from './automation-helpers';
import { seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// The ISO 9001:2015 pack (docs/11): an owner installs Starter from Workspace admin › Packs, which adopts the 9001
// requirement library first; the example complaint links to clauses 9.1.2 and 8.7 of that library; ticking "Needs
// corrective action" on a complaint raises a linked nonconformity; the setup checklist opens the internal form
// "Report a complaint"; adding Full later creates only the eight sheets Starter does not have.

const TITLE = 'ISO 9001:2015 QMS';
const STARTER = [
  'Context and interested parties',
  'Quality policy and objectives',
  'Processes',
  'Risks and opportunities',
  'Quality documents',
  'Nonconformities and corrective action',
  'Customer feedback and complaints',
];
const SHOTS = process.env.PACK_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};
const packRow = (page: Page) =>
  page
    .getByRole('list', { name: 'Available packs' })
    .getByRole('listitem')
    .filter({ hasText: TITLE });

test('install ISO 9001 Starter, raise a nonconformity from a complaint and add Full', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'phone', 'desktop walkthrough');
  test.setTimeout(240_000);
  const slug = seedWorkspace('qms', { empty: true });
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
  await expect(levels).toContainText('Adds: External providers, Competence and training');
  await expect(dialog.getByTestId('adopts-framework')).toContainText(
    'Adopts the ISO 9001:2015 requirement library first',
  );
  await expect(dialog).toContainText('Installs 1 folder, 7 sheets');
  await expect(dialog.getByRole('list', { name: 'Dashboards' })).toContainText(
    'QMS overview with 10 widgets',
  );
  await dialog.getByRole('radio', { name: 'Full', exact: true }).check();
  await expect(dialog).toContainText('Installs 1 folder, 15 sheets');
  await dialog.getByRole('radio', { name: 'Starter', exact: true }).check();
  await expect(dialog).toContainText('Installs 1 folder, 7 sheets');
  await shot(page, '01-install-dialog');

  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect(dialog.getByRole('status')).toContainText(`Installed ${TITLE} (Starter).`, {
    timeout: 60_000,
  });
  await expect(dialog).toContainText('Adopted ISO 9001:2015 first.');
  await dialog.getByRole('button', { name: 'Done' }).click();

  const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
  const sheets = await rest<{ id: string; name: string; is_library: boolean }[]>(
    page,
    `sheets?org_id=eq.${org!.id}&parent_sheet_id=is.null&archived_at=is.null&select=id,name,is_library&order=position`,
  );
  expect(sheets.filter((s) => !s.is_library).map((s) => s.name)).toEqual(STARTER);
  const lib = sheets.find((s) => s.is_library)!;
  expect(lib.name).toBe('ISO 9001:2015 requirements');
  const [install] = await rest<{ id: string; level: string }[]>(
    page,
    `pack_installs?org_id=eq.${org!.id}&pack_key=eq.iso-9001&select=id,level`,
  );
  expect(install!.level).toBe('starter');

  // ── the example complaint links to clauses 9.1.2 and 8.7 of the adopted library
  const complaints = sheets.find((s) => s.name === 'Customer feedback and complaints')!;
  const [late] = await rest<{ id: string; display_id: string }[]>(
    page,
    `items?sheet_id=eq.${complaints.id}&name=eq.Example: delivery arrived a week late&select=id,display_id`,
  );
  const links = await rest<{ to_item: string }[]>(
    page,
    `item_links?from_item=eq.${late!.id}&select=to_item`,
  );
  const clauses = await rest<{ requirement_ref: string }[]>(
    page,
    `items?sheet_id=eq.${lib.id}&id=in.(${links.map((l) => l.to_item).join(',')})&select=requirement_ref`,
  );
  expect(clauses.map((r) => r.requirement_ref).sort()).toEqual([
    'iso-9001@2015#8.7',
    'iso-9001@2015#9.1.2',
  ]);

  // ── the setup checklist: eight steps, Starter words the supplier step its own way
  await page.reload();
  const steps = page.getByRole('list', { name: 'ISO 9001 setup steps' });
  await expect(steps.getByRole('listitem')).toHaveCount(8);
  await expect(steps.getByRole('listitem').first()).toContainText(
    '1. Define your context and scope',
  );
  await expect(steps.locator('[data-step="suppliers"]')).toContainText(
    'Starter has no supplier sheet',
  );
  await expect(steps.locator('[data-step="processes"]')).toContainText('To do · 0 of 5 · 0 of 3');
  await shot(page, '02-setup-checklist');

  // ── the complaint form, an internal draft, opened from the checklist
  await steps
    .locator('[data-step="complaints"]')
    .getByRole('link', { name: 'Open Customer feedback and complaints' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Customer feedback and complaints' }),
  ).toBeVisible();
  await expect(page.getByLabel('Form title')).toHaveValue('Report a complaint');
  await shot(page, '03-complaint-form');
  const forms = await rest<
    { name: string; config: { form: { access: string; status: string } } }[]
  >(page, `views?org_id=eq.${org!.id}&type=eq.form&select=name,config&order=name`);
  expect(forms.map((f) => [f.name, f.config.form.access, f.config.form.status])).toEqual([
    ['Report a complaint', 'internal', 'draft'],
    ['Report a nonconformity', 'internal', 'draft'],
  ]);

  // ── a complaint that needs corrective action raises a linked nonconformity
  await page.goto(`/${slug}/s/${complaints.id}?item=${late!.display_id}`);
  const panel = page.getByRole('dialog');
  await expect(
    panel.getByRole('heading', { name: 'Example: delivery arrived a week late' }),
  ).toBeVisible();
  const needs = panel.getByRole('button', { name: /^Needs corrective action/ });
  await expect(needs).toContainText('Not checked');
  await needs.click();
  await expect(needs).toContainText('Checked');
  // the edit holds the row: finishing it runs the automations
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await finishRow(page, 'Example: delivery arrived a week late');
  const ncSheet = sheets.find((s) => s.name === 'Nonconformities and corrective action')!;
  await expect
    .poll(
      async () =>
        (
          await rest<{ name: string }[]>(
            page,
            `items?sheet_id=eq.${ncSheet.id}&name=eq.Example: delivery arrived a week late&select=name`,
          )
        ).length,
      { timeout: 30_000 },
    )
    .toBe(1);
  const [raised] = await rest<{ id: string }[]>(
    page,
    `items?sheet_id=eq.${ncSheet.id}&name=eq.Example: delivery arrived a week late&select=id`,
  );
  const ncLinks = await rest<{ to_item: string }[]>(
    page,
    `item_links?from_item=eq.${late!.id}&to_item=eq.${raised!.id}&select=to_item`,
  );
  expect(ncLinks).toHaveLength(1);
  await shot(page, '04-complaint-raised-nc');

  // ── the dashboard
  const [dash] = await rest<{ id: string; name: string }[]>(
    page,
    `dashboards?org_id=eq.${org!.id}&select=id,name`,
  );
  expect(dash!.name).toBe('QMS overview');
  await page.goto(`/${slug}/dashboards/${dash!.id}`);
  await expect(page.getByRole('heading', { name: 'QMS overview' })).toBeVisible();
  await expect(page.getByText('Open nonconformities')).toBeVisible();
  await shot(page, '05-dashboard');

  // ── Full on top of Starter: only what is missing
  await page.goto(`/${slug}/settings?tab=packs`);
  await page
    .getByRole('list', { name: 'Installed packs' })
    .getByRole('button', { name: `Add Full ${TITLE}` })
    .click();
  await expect(dialog.getByRole('radio', { name: 'Full', exact: true })).toBeChecked();
  await expect(dialog).toContainText('Installs 8 sheets');
  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect(dialog.getByRole('status')).toContainText(`Added Full to ${TITLE}.`, {
    timeout: 60_000,
  });
  const after = await rest<{ name: string; pack_install_id: string }[]>(
    page,
    `sheets?org_id=eq.${org!.id}&parent_sheet_id=is.null&is_library=eq.false&archived_at=is.null&select=name,pack_install_id&order=position`,
  );
  expect(after).toHaveLength(15);
  expect(new Set(after.map((s) => s.pack_install_id))).toEqual(new Set([install!.id]));
  const reminders = await rest<{ pack_ref: string; enabled: boolean }[]>(
    page,
    `automations?org_id=eq.${org!.id}&pack_ref=in.(calibration_due,supplier_reevaluation_due,finding_nc)&select=pack_ref,enabled&order=pack_ref`,
  );
  expect(reminders).toEqual([
    { pack_ref: 'calibration_due', enabled: true },
    { pack_ref: 'finding_nc', enabled: true },
    { pack_ref: 'supplier_reevaluation_due', enabled: true },
  ]);
  await page.reload();
  await expect(
    page.getByRole('list', { name: 'ISO 9001 setup steps' }).locator('[data-step="suppliers"]'),
  ).toContainText('Open External providers');
  await shot(page, '06-full-checklist');
});
