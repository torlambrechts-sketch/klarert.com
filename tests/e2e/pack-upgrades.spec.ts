import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { localSql, seedWorkspace } from './first-sheet-helpers';
import { signIn } from './helpers';

// Pack upgrades (docs/11 Upgrades, P6): a workspace on ISO/IEC 27001 1.0.0 (Full) sees "Update available
// 1.0.0 → 1.3.0" on Workspace admin › Packs, opens the dry run (added fields, forms, an automation and a dashboard;
// a changed sheet), settles the conflict on a sheet whose description it rewrote by taking the pack's, applies the
// update and finds the install on 1.3.0 with the new rows, its own value kept and pack.upgraded in the activity.

const SHOTS = process.env.P6_SHOTS;

function installOld(
  slug: string,
  key = 'iso-27001',
  version = '1.0.0',
  level?: string,
): Record<string, string> {
  const out = execFileSync(
    'pnpm',
    [
      'exec',
      'tsx',
      '--env-file-if-exists=.env.local',
      'tests/e2e/install-pack-version.ts',
      slug,
      key,
      version,
      ...(level ? [level] : key === 'iso-27001' ? ['full'] : []),
    ],
    { encoding: 'utf8', stdio: 'pipe', timeout: 90_000 },
  );
  return (JSON.parse(out) as { refMap: Record<string, string> }).refMap;
}

test('update an installed pack: dry run, a conflict, apply', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'the dialog is checked at 390 px below');
  test.setTimeout(180_000);
  const slug = seedWorkspace('upg', { empty: true });
  const refs = installOld(slug);
  const incident = refs['sheet:incident']!;
  const risk = refs['sheet:risk']!;
  // the client rewrites the description the new version also rewords: a conflict
  localSql(`update sheets set description = 'Our incident log.' where id = '${incident}'`);
  const before = localSql(`select count(*) from items where sheet_id = '${risk}'`).trim();

  // parallel workers sign in as the same person: open this workspace whichever link was used
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
  await page.goto(`/${slug}/settings?tab=packs`);
  const row = page
    .getByRole('list', { name: 'Installed packs' })
    .getByRole('listitem')
    .filter({ hasText: 'ISO/IEC 27001' });
  await expect(row.getByTestId('update-available')).toContainText('1.0.0 → 1.3.0');
  await row.getByRole('button', { name: /^Update .* from 1\.0\.0 to 1\.3\.0$/ }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('upgrade-summary')).toContainText('1 conflict', {
    timeout: 45_000,
  });
  await expect(dialog.getByRole('list', { name: 'Added' })).toContainText(
    'Security incidents › Report a security incident',
  );
  await expect(dialog.getByRole('list', { name: 'Added' })).toContainText(
    'Corrective action overdue → tell the action owner',
  );
  const conflict = dialog.getByRole('group', { name: /Security incidents/ });
  await expect(conflict).toContainText('You and the pack both changed description.');
  await expect(conflict.getByRole('radio', { name: 'Keep mine' })).toBeChecked();
  await conflict.getByRole('radio', { name: 'Take the pack’s' }).check();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/upgrade-dialog.png`, fullPage: false });

  await dialog.getByRole('button', { name: 'Apply update' }).click();
  await expect(dialog.getByRole('status')).toContainText('to 1.3.0', { timeout: 30_000 });
  await expect(page.getByText(/Updated ISO\/IEC 27001.* to 1\.2\.0/).first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/upgrade-done.png`, fullPage: false });
  await dialog.getByRole('button', { name: 'Done' }).click();

  // the install is on 1.3.0: no update left, the activity says what happened
  await expect(row.getByTestId('update-available')).toHaveCount(0);
  await expect(row).toContainText('1.3.0');
  await expect(page.getByRole('list', { name: 'Pack activity' })).toContainText(
    'from 1.0.0 to 1.3.0',
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/packs-after.png`, fullPage: true });

  const desc = localSql(`select description from sheets where id = '${incident}'`).trim();
  expect(desc).not.toBe('Our incident log.');
  expect(
    Number(
      localSql(
        `select count(*) from fields where sheet_id = '${incident}' and pack_ref in ('incident.affected', 'incident.reporter_name', 'incident.reporter_email')`,
      ).trim(),
    ),
  ).toBe(3);
  // nothing the client had was removed
  expect(localSql(`select count(*) from items where sheet_id = '${risk}'`).trim()).toBe(before);
});

test('update a framework library to a new revision from Frameworks', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop walkthrough');
  test.setTimeout(180_000);
  const slug = seedWorkspace('upgf', { empty: true });
  const refs = installOld(slug, 'framework-nis2', '2022.1.0');
  const lib = refs['sheet:library']!;
  // the client marks a requirement not applicable: an answer the revision never touches
  const item = refs['item:library.art_21_1']!;
  const applicable = localSql(
    `select id from fields where sheet_id = '${lib}' and key = 'applicable'`,
  ).trim();
  localSql(
    `update items set "values" = "values" || jsonb_build_object('${applicable}', 'not_applicable') where id = '${item}'`,
  );

  // parallel workers sign in as the same person: open this workspace whichever link was used
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=frameworks`);
  await page.goto(`/${slug}/settings?tab=frameworks`);
  const row = page
    .getByRole('list', { name: 'Adopted frameworks' })
    .getByRole('listitem')
    .filter({ hasText: 'NIS2' });
  await expect(row.getByTestId('update-available')).toContainText('2022.1.0 → 2022.4.0');
  await row.getByRole('button', { name: /^Update .* from 2022\.1\.0 to 2022\.4\.0$/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('list', { name: 'Added' })).toContainText(
    'Article 3 · Essential and important entities',
    {
      timeout: 45_000,
    },
  );
  await expect(dialog.getByRole('list', { name: 'Changed' })).toContainText('Purpose');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/framework-upgrade-dialog.png` });
  await dialog.getByRole('button', { name: 'Apply update' }).click();
  await expect(dialog.getByRole('status')).toContainText('to 2022.4.0', { timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(row.getByTestId('update-available')).toHaveCount(0);

  // new requirements carry their key; the client's answer stays
  expect(
    localSql(
      `select requirement_ref from items where sheet_id = '${lib}' and pack_ref = 'library.art_3_1'`,
    ).trim(),
  ).toBe('nis2@2022#Art. 3(1)');
  expect(localSql(`select "values"->>'${applicable}' from items where id = '${item}'`).trim()).toBe(
    'not_applicable',
  );
});

test('the update dialog at 390 px', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout');
  test.setTimeout(150_000);
  const slug = seedWorkspace('upgp', { empty: true });
  installOld(slug);
  // parallel workers sign in as the same person: open this workspace whichever link was used
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
  await page.goto(`/${slug}/settings?tab=packs`);
  await page
    .getByRole('button', { name: /^Update .* from 1\.0\.0 to 1\.3\.0$/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('upgrade-summary')).toBeVisible({ timeout: 45_000 });
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/upgrade-dialog-390.png` });
});
