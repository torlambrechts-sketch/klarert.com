import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// Packs (docs/11, docs/05 §2.1 Workspace admin › Packs): an admin previews the first-sheet pack in an empty workspace,
// installs it (one transaction: sheets, links, automations and items with provenance), opens it and archives it;
// an editor cannot install. Each test seeds its own workspace (scripts/seed.ts also fills the pack catalogue).

const TITLE = 'Corrective actions (first sheet)';
const packRow = (page: Page) =>
  page
    .getByRole('list', { name: 'Available packs' })
    .getByRole('listitem')
    .filter({ hasText: TITLE });

test.describe('desktop', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop walkthrough'));

  test('admin previews, installs, opens and archives the first-sheet pack', async ({ page }) => {
    test.setTimeout(180_000);
    const slug = seedWorkspace('pk', { empty: true });
    await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
    await expect(page.getByRole('heading', { name: 'Available packs' })).toBeVisible();
    await expect(packRow(page)).toContainText('Inside: 1 folder, 2 sheets');

    // ── preview: what it creates here, in plain words
    await packRow(page)
      .getByRole('button', { name: `Preview ${TITLE}` })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: new RegExp(TITLE.replace(/[()]/g, '\\$&')) }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      'Installs 2 sheets, 25 fields, 6 views, 7 example items, 4 links and 9 automations.',
    );
    await expect(dialog.getByRole('list', { name: 'Folders' })).toContainText(
      'Uses the folder Your sheets',
    );
    await expect(dialog.getByRole('list', { name: 'Sheets', exact: true })).toContainText(
      'Corrective actions',
    );
    await expect(dialog.getByRole('list', { name: 'Links between sheets' })).toContainText(
      'Corrective actions → Actions through Actions, both ways',
    );
    await expect(dialog.getByRole('list', { name: 'Automations' })).toContainText(
      'When Status becomes Done, then move to Closed and lock.',
    );
    await expect(dialog.getByRole('list', { name: 'Automations' })).toContainText(
      '(test mode: logs what it would do until you turn it on)',
    );

    // ── install: progress, then success with Open
    await dialog.getByRole('button', { name: 'Install' }).click();
    await expect(dialog.getByRole('status')).toContainText(`Installed ${TITLE}.`, {
      timeout: 30_000,
    });
    const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
    const sheets = await rest<
      { id: string; name: string; pack_ref: string; pack_install_id: string }[]
    >(
      page,
      `sheets?org_id=eq.${org!.id}&parent_sheet_id=is.null&select=id,name,pack_ref,pack_install_id&order=position`,
    );
    expect(sheets.map((s) => [s.name, s.pack_ref])).toEqual([
      ['Corrective actions', 'ca'],
      ['Actions', 'act'],
    ]);
    const installId = sheets[0]!.pack_install_id;
    expect(installId).toBeTruthy();
    const [install] = await rest<{ status: string; ref_map: Record<string, string> }[]>(
      page,
      `pack_installs?id=eq.${installId}&select=status,ref_map`,
    );
    expect(install!.status).toBe('installed');
    expect(install!.ref_map['sheet:ca']).toBe(sheets[0]!.id);
    const automations = await rest<{ pack_ref: string; source: string }[]>(
      page,
      `automations?org_id=eq.${org!.id}&select=pack_ref,source`,
    );
    expect(automations).toHaveLength(9);
    expect(
      automations.every((a) => a.source === 'pack:first-sheet-corrective-actions' && a.pack_ref),
    ).toBe(true);
    const links = await rest<unknown[]>(page, `item_links?org_id=eq.${org!.id}&select=id`);
    expect(links).toHaveLength(4);
    const items = await rest<{ display_id: string; pack_ref: string }[]>(
      page,
      `items?sheet_id=eq.${sheets[0]!.id}&select=display_id,pack_ref&order=display_id`,
    );
    expect(items.map((i) => i.display_id)).toEqual([
      'CA-001',
      'CA-002',
      'CA-003',
      'CA-004',
      'CA-005',
    ]);
    expect(items.every((i) => i.pack_ref)).toBe(true);

    await dialog.getByRole('link', { name: 'Open' }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/s/${sheets[0]!.id}`));
    await expect(page.getByRole('heading', { name: 'Corrective actions', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('gridcell', { name: /Burrs on bracket 44-210/ }).first(),
    ).toBeVisible();

    // ── installed list and the readable audit entry
    await page.goto(`/${slug}/settings?tab=packs`);
    const installed = page
      .getByRole('list', { name: 'Installed packs' })
      .getByRole('listitem')
      .first();
    await expect(installed).toContainText(TITLE);
    await expect(installed).toContainText('Installed by Maria Pereira');
    await expect(page.getByRole('list', { name: 'Pack activity' })).toContainText(
      `Maria Pereira · Installed ${TITLE} 1.0.0: 2 sheets`,
    );
    await expect(packRow(page)).toContainText('Installed');

    // ── test mode (docs/04 §14): the 6 automations that notify start quiet; one goes live from the list, the rest
    // from the banner, both logged
    const banner = page.getByTestId('test-mode-banner');
    await expect(banner).toContainText(`6 automations from ${TITLE} are in test mode.`);
    const stuck = 'Stuck → notify the owner and the compliance manager';
    await page.goto(`/${slug}/automations`);
    const stuckRow = page.getByRole('listitem').filter({ hasText: stuck });
    await expect(stuckRow.getByTestId('automation-test-mode')).toContainText('Test mode');
    await stuckRow.getByRole('switch', { name: `Live: ${stuck}` }).click();
    await expect(page.getByText(`“${stuck}” is live.`).first()).toBeVisible();
    await expect(stuckRow.getByTestId('automation-test-mode')).toHaveCount(0);
    await page.goto(`/${slug}/home`);
    await expect(banner).toContainText(`5 automations from ${TITLE} are in test mode.`);
    await banner.getByRole('button', { name: `Turn on all automations from ${TITLE}` }).click();
    await expect(page.getByText(`Turned on 5 automations from ${TITLE}.`).first()).toBeVisible();
    await expect(banner).toHaveCount(0);
    const quiet = await rest<unknown[]>(
      page,
      `automations?org_id=eq.${org!.id}&mode=eq.test&select=id`,
    );
    expect(quiet).toHaveLength(0);
    await page.goto(`/${slug}/settings?tab=packs`);
    await expect(page.getByTestId('test-mode-banner')).toHaveCount(0);

    // ── archive: sheets archived, automations off, items and the log kept
    await installed.getByRole('button', { name: `Archive ${TITLE}` }).click();
    await installed.getByRole('button', { name: `Archive ${TITLE}` }).click();
    await expect(
      page.getByText(`Archived ${TITLE}: 2 sheets archived, 9 automations turned off.`),
    ).toBeVisible();
    await expect(page.getByRole('list', { name: 'Pack activity' })).toContainText(
      `Archived ${TITLE} 1.0.0`,
    );
    const after = await rest<{ archived_at: string | null }[]>(
      page,
      `sheets?pack_install_id=eq.${installId}&parent_sheet_id=is.null&select=archived_at`,
    );
    expect(after.every((s) => s.archived_at)).toBe(true);
    const on = await rest<unknown[]>(
      page,
      `automations?org_id=eq.${org!.id}&enabled=eq.true&select=id`,
    );
    expect(on).toHaveLength(0);
    const kept = await rest<unknown[]>(page, `items?org_id=eq.${org!.id}&select=id`);
    expect(kept.length).toBeGreaterThanOrEqual(7);
    // the side menu no longer shows the pack's sheets
    await expect(
      page
        .getByRole('navigation', { name: 'Side menu' })
        .getByRole('link', { name: /Corrective actions/ }),
    ).toHaveCount(0);
  });

  test('an editor cannot install packs', async ({ page }) => {
    const slug = seedWorkspace('pk-ed', { empty: true });
    await signIn(page, 'james@example.com', `/${slug}/settings?tab=packs`);
    await expect(
      page.getByText('Only owners and admins can change workspace settings.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^Preview / })).toHaveCount(0);
    // and the database refuses it too
    const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
    await expect(
      rest(page, 'rpc/install_pack', {
        method: 'POST',
        body: {
          p_org: org!.id,
          p_plan: { pack: { key: 'first-sheet-corrective-actions', version: '1.0.0', hash: 'x' } },
        },
      }),
    ).rejects.toThrow(/only owners and admins install packs/);
  });
});

test('phone · the Packs tab fits 390 px', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout');
  const slug = seedWorkspace('pk-ph', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
  await expect(packRow(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await packRow(page)
    .getByRole('button', { name: `Preview ${TITLE}` })
    .click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Install' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
