import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// Core registers (docs/11 Core registers and Extends, docs/05 §2.1 Registers): an admin installs the ISO 14001
// demonstration add-on into an empty workspace; the Core registers are installed first. The side menu shows the
// Registers domains that have sheets, the risk register is a System board with the Environmental category, the
// ISO 14001 tag and view and the add-on's system column; archiving the add-on takes back what it added and keeps
// every shared row.

const ADDON = 'ISO 14001 environment (add-on)';
const SHOTS = process.env.CORE_SHOTS ?? '';

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

test.describe('desktop', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop walkthrough'));

  test('installing an add-on installs Core first, extends the shared registers and archives cleanly', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const slug = seedWorkspace('core', { empty: true });
    await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
    await page.goto(`/${slug}/settings?tab=packs`);
    const row = page
      .getByRole('list', { name: 'Available packs' })
      .getByRole('listitem')
      .filter({ hasText: ADDON });
    await expect(row).toBeVisible();

    // ── preview: Core registers first, then what it adds to them
    await row.getByRole('button', { name: `Preview ${ADDON}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('installs-first')).toContainText(
      'Installs Core registers 1.0.0 (Starter) first.',
    );
    await shot(page, '01-preview');
    await dialog.getByRole('button', { name: 'Install' }).click();
    await expect(dialog.getByRole('status')).toContainText(`Installed ${ADDON}.`, {
      timeout: 60_000,
    });
    await expect(dialog.getByRole('status')).toContainText(
      'Installed Core registers 1.0.0 (Starter) first.',
    );

    const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
    const installs = await rest<{ id: string; pack_key: string; status: string }[]>(
      page,
      `pack_installs?org_id=eq.${org!.id}&select=id,pack_key,status&order=installed_at`,
    );
    expect(installs.map((i) => [i.pack_key, i.status])).toEqual([
      ['core', 'installed'],
      ['iso-14001', 'installed'],
    ]);
    const addonInstall = installs[1]!.id;

    // ── the side menu: Registers with the domains that have sheets, in order, then Your sheets
    await page.goto(`/${slug}/home`);
    const menu = page.getByRole('navigation', { name: 'Side menu' });
    await expect(menu.getByRole('heading', { name: 'Registers' })).toBeVisible();
    await expect(menu.getByTestId('menu-domain')).toHaveText([
      'Management system',
      'Risk and controls',
      'Operations',
    ]);
    await expect(menu.getByText('Privacy and security')).toHaveCount(0);
    await expect(menu.getByText('Suppliers')).toHaveCount(0);
    await expect(menu.getByRole('link', { name: 'Environmental aspects' })).toBeVisible();
    await shot(page, '02-registers-menu');

    // ── the risk register: a System board used by ISO 14001, with its view and system column
    await menu.getByRole('link', { name: 'Risk register' }).click();
    await expect(page.getByRole('heading', { name: 'Risk register', level: 1 })).toBeVisible();
    await expect(page.getByTestId('system-board')).toContainText('System board');
    await expect(page.getByTestId('system-board')).toContainText('Core registers 1.0.0');
    await expect(page.getByTestId('system-used-by')).toHaveText('Used by ISO 14001');
    const spill = page.getByRole('gridcell', { name: /Coolant spill reaches a surface drain/ });
    await expect(spill.first()).toBeVisible();
    await expect(
      page.getByRole('gridcell', { name: /^RC-\d+ Environmental$/ }).first(),
    ).toBeVisible();
    // every Core column is a system column, the lock says who relies on it
    await expect(page.getByTestId('system-column').first()).toHaveAttribute(
      'aria-label',
      /Used by ISO 14001/,
    );
    // the add-on's view is a chip of the Table, not its default: the Table shows every risk
    await expect(
      page.getByRole('gridcell', { name: /A key supplier cannot deliver/ }).first(),
    ).toBeVisible();
    await expect(
      page
        .getByRole('tablist', { name: 'Saved views of this table' })
        .getByRole('tab', { name: 'ISO 14001 view' }),
    ).toHaveAttribute('aria-selected', 'false');
    await shot(page, '03-risk-register');
    // the add-on's own column on the Core sheet, linked to its aspect (the panel lists every column)
    const [spillItem] = await rest<{ display_id: string; sheet_id: string }[]>(
      page,
      `items?org_id=eq.${org!.id}&name=like.*Coolant%20spill*&select=display_id,sheet_id`,
    );
    await page.goto(`/${slug}/s/${spillItem!.sheet_id}?item=${spillItem!.display_id}`);
    const panel = page.getByRole('dialog');
    await expect(panel.getByText('Environmental aspect', { exact: true }).first()).toBeVisible();
    await expect(panel.getByText(/ASP-001/).first()).toBeVisible();
    await shot(page, '03b-item-panel');
    await page.keyboard.press('Escape');

    const [risk] = await rest<{ id: string }[]>(
      page,
      `sheets?org_id=eq.${org!.id}&pack_ref=eq.risk&select=id`,
    );
    const standards = await rest<{ config: { options: { id: string; label: string }[] } }[]>(
      page,
      `fields?sheet_id=eq.${risk!.id}&key=eq.standards&select=config`,
    );
    expect(standards[0]!.config.options.map((o) => o.label)).toEqual([
      'All standards',
      'ISO 14001',
    ]);
    // the Environmental category is data, with its own scales
    const categories = await rest<{ name: string; pack_install_id: string }[]>(
      page,
      `items?org_id=eq.${org!.id}&name=eq.Environmental&select=name,pack_install_id`,
    );
    expect(categories).toEqual([{ name: 'Environmental', pack_install_id: addonInstall }]);
    const riskItems = await rest<{ id: string }[]>(
      page,
      `items?sheet_id=eq.${risk!.id}&archived_at=is.null&select=id`,
    );
    expect(riskItems).toHaveLength(2);

    // ── archive the add-on: its column, view and tag go; the shared rows stay
    await page.goto(`/${slug}/settings?tab=packs`);
    const installed = page
      .getByRole('list', { name: 'Installed packs' })
      .getByRole('listitem')
      .filter({ hasText: ADDON });
    await installed.getByRole('button', { name: `Archive ${ADDON}` }).click();
    await expect(installed.getByTestId('archive-addon-note')).toContainText(
      'No shared rows are deleted',
    );
    await shot(page, '04-archive-confirm');
    await installed.getByRole('button', { name: `Archive ${ADDON}` }).click();
    await expect(
      page.getByText(new RegExp(`Archived ${ADDON.replace(/[()]/g, '\\$&')}`)),
    ).toBeVisible();

    const kept = await rest<{ id: string }[]>(
      page,
      `items?sheet_id=eq.${risk!.id}&archived_at=is.null&select=id`,
    );
    expect(kept).toHaveLength(2);
    const column = await rest<{ archived_at: string | null }[]>(
      page,
      `fields?sheet_id=eq.${risk!.id}&key=eq.iso14001_aspect&select=archived_at`,
    );
    expect(column[0]!.archived_at).not.toBeNull();
    const views = await rest<unknown[]>(
      page,
      `views?sheet_id=eq.${risk!.id}&name=eq.ISO%2014001%20view&select=id`,
    );
    expect(views).toHaveLength(0);
    const after = await rest<{ config: { options: { id: string }[] } }[]>(
      page,
      `fields?sheet_id=eq.${risk!.id}&key=eq.standards&select=config`,
    );
    expect(after[0]!.config.options.map((o) => o.id)).toEqual(['all']);
    const core = await rest<{ status: string }[]>(
      page,
      `pack_installs?org_id=eq.${org!.id}&pack_key=eq.core&select=status`,
    );
    expect(core).toEqual([{ status: 'installed' }]);

    // the risk register is still there, with the spill and without the add-on's column
    await page.goto(`/${slug}/s/${risk!.id}`);
    await expect(spill.first()).toBeVisible();
    await expect(page.getByTestId('system-used-by')).toHaveText('Used by every standard you add');
    await expect(
      page.getByRole('navigation', { name: 'Side menu' }).getByRole('link', {
        name: 'Environmental aspects',
      }),
    ).toHaveCount(0);
    await shot(page, '05-after-archive');
  });
});
