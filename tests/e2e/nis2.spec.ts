import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// The NIS2 add-on 1.0.0 (docs/11 The NIS2 add-on, Pack settings): an owner picks Norway in the install dialog (EEA,
// unverified, with its note on the Digital Security Act) and installs; the Core registers are installed first at
// Full (the Controls library and training); the NIS2 sheets sit in the Privacy and security and Management system
// domains; the Controls library has the NIS2 view and the ten measures; an SLA automation waits in test mode; the
// management body approval workflow is on its sheet; the CSIRT is the default "Report to"; changing the country to
// Germany in the pack's settings rewrites the defaults.

const TITLE = 'NIS2 cybersecurity (add-on)';
const SHOTS = process.env.NIS2_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

test('install NIS2 with the Norway country rules and change the country later', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'phone', 'desktop walkthrough');
  test.setTimeout(300_000);
  const slug = seedWorkspace('nis2', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
  await page.goto(`/${slug}/settings?tab=packs`);

  // ── the install dialog: the country setting, then Core (Full) first
  const row = page
    .getByRole('list', { name: 'Available packs' })
    .getByRole('listitem')
    .filter({ hasText: TITLE });
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    await row.getByRole('button', { name: `Preview ${TITLE}` }).click();
    await expect(dialog).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await expect(dialog.getByTestId('installs-first')).toContainText(
    'Installs Core registers 1.1.0 (Full) first.',
  );
  const country = dialog.getByLabel('Country of main establishment');
  await country.selectOption({ label: 'Norway' });
  const details = dialog.getByTestId('setting-details');
  await expect(details.getByTestId('setting-unverified')).toContainText('Not verified yet');
  await expect(details).toContainText('Digital Security Act');
  await expect(details).toContainText('not yet taken into the EEA Agreement');
  await expect(details).toContainText('NorCERT');
  await shot(page, '01-install-country');
  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect(dialog.getByRole('status')).toContainText(`Installed ${TITLE}.`, {
    timeout: 90_000,
  });
  await expect(dialog.getByRole('status')).toContainText(
    'Installed Core registers 1.1.0 (Full) first.',
  );
  await dialog.getByRole('button', { name: 'Done' }).click();

  const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
  const installs = await rest<{ id: string; pack_key: string; settings: unknown }[]>(
    page,
    `pack_installs?org_id=eq.${org!.id}&status=eq.installed&select=id,pack_key,settings`,
  );
  expect(installs.map((i) => i.pack_key).sort()).toEqual(['core', 'framework-nis2', 'nis2']);
  const nis2 = installs.find((i) => i.pack_key === 'nis2')!;
  expect(nis2.settings).toEqual({ country: 'no' });

  // ── its sheets sit in Core's domains
  const sheets = await rest<
    { id: string; name: string; folders: { domain: string | null } | null }[]
  >(
    page,
    `sheets?pack_install_id=eq.${nis2.id}&parent_sheet_id=is.null&select=id,name,folders(domain)&order=position`,
  );
  expect(sheets.map((s) => [s.name, s.folders?.domain])).toEqual([
    ['NIS2 scope and registration', 'privacy'],
    ['NIS2 incident reports', 'privacy'],
    ['NIS2 management body decisions', 'management'],
  ]);
  const reports = sheets.find((s) => s.name === 'NIS2 incident reports')!;
  const recipient = async () =>
    (
      await rest<{ config: { default?: string } }[]>(
        page,
        `fields?sheet_id=eq.${reports.id}&key=eq.recipient&select=config`,
      )
    )[0]!.config.default;
  expect(await recipient()).toMatch(/NorCERT/);

  // ── the shared Controls library: used by NIS2, its view and the ten measures
  const [controls] = await rest<{ id: string }[]>(
    page,
    `sheets?org_id=eq.${org!.id}&pack_ref=eq.controls&select=id`,
  );
  await page.goto(`/${slug}/s/${controls!.id}`);
  await expect(page.getByRole('heading', { name: 'Controls library', level: 1 })).toBeVisible();
  await expect(page.getByTestId('system-used-by')).toHaveText('Used by NIS2');
  await expect(
    page
      .getByRole('tablist', { name: 'Saved views of this table' })
      .getByRole('tab', { name: 'NIS2 view' }),
  ).toBeVisible();
  const measures = await rest<unknown[]>(
    page,
    `items?sheet_id=eq.${controls!.id}&pack_install_id=eq.${nis2.id}&select=id`,
  );
  expect(measures).toHaveLength(10);

  // ── the incident reports: the clocks and the stage board
  await page.goto(`/${slug}/s/${reports.id}`);
  await expect(
    page.getByRole('heading', { name: 'NIS2 incident reports', level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole('gridcell', { name: /Ransomware on the route planning servers/ }).first(),
  ).toBeVisible();
  await shot(page, '02-incident-reports');

  // ── an advanced SLA automation in test mode
  const sla = 'Early warning: 8 hours left → tell the lead and the security officer';
  await page.goto(`/${slug}/automations`);
  await expect(
    page.getByRole('listitem').filter({ hasText: sla }).getByTestId('automation-test-mode'),
  ).toContainText('Test mode');

  // ── the management body approval workflow
  const oversight = sheets.find((s) => s.name === 'NIS2 management body decisions')!;
  await page.goto(`/${slug}/s/${oversight.id}/settings#approvals`);
  await expect(page.getByRole('list', { name: 'Approval workflows' })).toContainText(
    'Management body approval',
  );

  // ── change the country in the pack's settings: the defaults follow
  await page.goto(`/${slug}/settings?tab=packs`);
  const installed = page
    .getByRole('list', { name: 'Installed packs' })
    .getByRole('listitem')
    .filter({ hasText: TITLE });
  await expect(installed.getByTestId('pack-settings-summary')).toHaveText(
    'Country of main establishment: Norway',
  );
  await installed.getByRole('button', { name: `Settings of ${TITLE}` }).click();
  const settings = page.getByRole('dialog', { name: `Settings of ${TITLE}` });
  await settings.getByLabel('Country of main establishment').selectOption({ label: 'Germany' });
  await expect(settings.getByTestId('setting-details')).toContainText('BSI');
  await shot(page, '03-settings-dialog');
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(
    page.getByText(/Saved the settings of NIS2 cybersecurity \(add-on\)\./),
  ).toBeVisible();
  await expect(installed.getByTestId('pack-settings-summary')).toHaveText(
    'Country of main establishment: Germany',
  );
  expect(await recipient()).toMatch(/BSI/);
  await expect(page.getByRole('list', { name: 'Pack activity' })).toContainText(
    'Changed the settings of NIS2 cybersecurity (add-on) (Country of main establishment: Germany)',
  );
});
