import { expect, type Page } from '@playwright/test';
import { rest } from './helpers';

// Shared steps of the standards' Core add-on specs (docs/11 Core registers, Extends): install the add-on from
// Workspace admin › Packs (Core and the requirement library come first), then check where its sheets went, the
// standard's view on a Core register, an advanced automation in test mode and an approval workflow.

export const shots =
  (dir: string | undefined, prefix: string) => async (page: Page, name: string) => {
    if (dir) await page.screenshot({ path: `${dir}/${prefix}-${name}.png`, fullPage: false });
  };

export interface AddonInstall {
  org: string;
  core: string;
  addon: string;
}

/** Preview and install an add-on at its default level; Core (at `coreLevel`) and the library are installed first. */
export async function installAddon(
  page: Page,
  slug: string,
  opts: {
    title: string;
    key: string;
    coreLevel: 'Standard' | 'Everything';
    library: string;
    shot?: (page: Page, name: string) => Promise<void>;
  },
): Promise<AddonInstall> {
  await page.goto(`/${slug}/settings?tab=packs`);
  const row = page
    .getByRole('list', { name: 'Available packs' })
    .getByRole('listitem')
    .filter({ hasText: opts.title });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `Preview ${opts.title}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('group', { name: 'Choose a level' }).getByRole('radio', {
      name: 'Standard',
      exact: true,
    }),
  ).toBeChecked();
  await expect(dialog.getByTestId('installs-first')).toContainText(
    `Installs Shared registers 1.3.0 (${opts.coreLevel}) first.`,
  );
  await expect(dialog.getByTestId('adopts-framework')).toContainText(
    `Adopts the ${opts.library} requirement library first`,
  );
  await expect(dialog.getByRole('list', { name: 'Automations' })).toContainText(
    '(test mode: logs what it would do until you turn it on)',
  );
  if (opts.shot) await opts.shot(page, '01-install-dialog');
  await dialog.getByRole('button', { name: 'Install' }).click();
  const status = dialog.getByRole('status');
  await expect(status).toContainText(`Installed ${opts.title} (Standard).`, { timeout: 90_000 });
  await expect(status).toContainText(`Installed Shared registers 1.3.0 (${opts.coreLevel}) first.`);
  await expect(status).toContainText(`Adopted ${opts.library} first.`);
  await dialog.getByRole('button', { name: 'Done' }).click();

  const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
  const installs = await rest<{ id: string; pack_key: string; level: string | null }[]>(
    page,
    `pack_installs?org_id=eq.${org!.id}&status=eq.installed&pack_key=in.(core,${opts.key})&select=id,pack_key,level&order=installed_at`,
  );
  // Core first, at the level the add-on needs
  expect(installs.map((i) => [i.pack_key, i.level])).toEqual([
    ['core', opts.coreLevel.toLowerCase()],
    [opts.key, 'starter'],
  ]);
  return { org: org!.id, core: installs[0]!.id, addon: installs[1]!.id };
}

/** The add-on's own sheets by name → the name of the (Core domain) folder each one sits in. */
export async function sheetFolders(page: Page, i: AddonInstall): Promise<Record<string, string>> {
  const sheets = await rest<{ name: string; folder_id: string | null }[]>(
    page,
    `sheets?pack_install_id=eq.${i.addon}&parent_sheet_id=is.null&select=name,folder_id&order=position`,
  );
  const folders = await rest<{ id: string; name: string; domain: string | null }[]>(
    page,
    `folders?org_id=eq.${i.org}&select=id,name,domain`,
  );
  return Object.fromEntries(
    sheets.map((s) => {
      const f = folders.find((x) => x.id === s.folder_id);
      return [s.name, f?.domain ? f.name : `not a domain: ${f?.name ?? 'none'}`];
    }),
  );
}

/** A Core register's id by its ref. */
export async function coreSheet(page: Page, i: AddonInstall, ref: string): Promise<string> {
  const [s] = await rest<{ id: string }[]>(
    page,
    `sheets?pack_install_id=eq.${i.core}&pack_ref=eq.${ref}&select=id`,
  );
  return s!.id;
}

/** The standard's saved view is a chip of the Core register's Table, not its default. */
export async function expectStandardView(page: Page, slug: string, sheetId: string, label: string) {
  await page.goto(`/${slug}/s/${sheetId}`);
  await expect(page.getByTestId('system-used-by')).toContainText(label);
  const chip = page
    .getByRole('tablist', { name: 'Saved views of this table' })
    .getByRole('tab', { name: `${label} view` });
  await expect(chip).toHaveAttribute('aria-selected', 'false');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-selected', 'true');
}

/** An automation from the pack is in test mode on the Automations page. */
export async function expectTestMode(page: Page, slug: string, name: string) {
  await page.goto(`/${slug}/automations`);
  const row = page.getByRole('listitem').filter({ hasText: name });
  await expect(row.getByTestId('automation-test-mode')).toContainText('Test mode');
}

/** The sheet's settings list the approval workflow the pack declared. */
export async function expectWorkflow(page: Page, slug: string, sheetId: string, name: string) {
  await page.goto(`/${slug}/s/${sheetId}/settings#approvals`);
  await expect(page.getByRole('list', { name: 'Approval workflows' })).toContainText(name);
}
