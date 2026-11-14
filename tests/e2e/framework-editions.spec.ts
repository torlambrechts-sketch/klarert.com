import { expect, test, type Page } from '@playwright/test';
import { localSql, seedWorkspace } from './first-sheet-helpers';
import { signIn } from './helpers';

// Edition currency (docs/12 Standards watch): the Framework catalogue says which editions are withdrawn, what
// replaces them and when the transition ends, and which have a revision on the way. Adopting a withdrawn edition asks
// for confirmation. With both editions adopted, "Move to the new edition" copies the answers of the same
// requirements through the 2015 → 2026 edition mapping and makes the old library read-only.

const catalogueRow = (page: Page, title: string) =>
  page
    .getByRole('list', { name: 'Framework catalogue' })
    .getByRole('listitem')
    .filter({ has: page.getByText(title, { exact: true }) });

async function adopt(page: Page, title: string, requirements: number) {
  await catalogueRow(page, title)
    .getByRole('button', { name: `Adopt ${title}` })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('list', { name: 'What adopting creates' })).toContainText(
    `a library of ${requirements} requirements`,
    { timeout: 45_000 },
  );
  const replaced = (await dialog.getByTestId('replaced-warning').count()) > 0;
  if (replaced) {
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Adopt this edition' }).click();
  } else await dialog.getByRole('button', { name: 'Adopt', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText(`Adopted ${title}`, { timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();
}

test('the catalogue shows edition status, and a withdrawn edition asks before it is adopted', async ({
  page,
}) => {
  const slug = seedWorkspace('edst', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=frameworks`);
  await page.goto(`/${slug}/settings?tab=frameworks`);

  const old = catalogueRow(page, 'ISO 14001:2015');
  await expect(old.getByTestId('edition-badge')).toHaveText(
    'Withdrawn · replaced by ISO 14001:2026 · transition ends Apr 2029',
  );
  await expect(catalogueRow(page, 'ISO 9001:2015').getByTestId('edition-badge')).toHaveText(
    'Withdrawn · replaced by ISO 9001:2026 · transition ends Sep 2029',
  );
  await expect(catalogueRow(page, 'ISO 45001:2018').getByTestId('edition-badge')).toHaveText(
    'Revision in progress (DIS) · expected 2027',
  );
  await expect(catalogueRow(page, 'ISO 14001:2026').getByTestId('edition-badge')).toHaveCount(0);
  await expect(catalogueRow(page, 'ISO 14001:2026')).toContainText('Edition status checked');

  await old.getByRole('button', { name: 'Adopt ISO 14001:2015' }).click();
  const dialog = page.getByRole('dialog');
  const warning = dialog.getByTestId('replaced-warning');
  await expect(warning).toContainText(
    'ISO 14001:2015 is withdrawn and replaced by ISO 14001:2026.',
  );
  await expect(warning).toContainText('We recommend adopting ISO 14001:2026 instead');
  await expect(dialog.getByRole('list', { name: 'What adopting creates' })).toBeVisible({
    timeout: 45_000,
  });
  await expect(dialog.getByRole('button', { name: 'Adopt this edition' })).toBeDisabled();
  await warning.getByRole('checkbox').check();
  await expect(dialog.getByRole('button', { name: 'Adopt this edition' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('move an adopted library to the new edition', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop walkthrough');
  test.setTimeout(180_000);
  const slug = seedWorkspace('edmv', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=frameworks`);
  await page.goto(`/${slug}/settings?tab=frameworks`);
  await adopt(page, 'ISO 14001:2015', 38);

  const org = localSql(`select id from orgs where slug = '${slug}'`).trim();
  const lib = (version: string) =>
    localSql(
      `select id from sheets where org_id = '${org}' and settings->'framework'->>'version' = '${version}' and settings->'framework'->>'key' = 'iso-14001'`,
    ).trim();
  const oldLib = lib('2015');
  const field = (sheet: string, key: string) =>
    localSql(`select id from fields where sheet_id = '${sheet}' and key = '${key}'`).trim();
  const item = (sheet: string, ref: string) =>
    localSql(
      `select id from items where sheet_id = '${sheet}' and split_part(requirement_ref, '#', 2) = '${ref}'`,
    ).trim();
  // the workspace's answers on the 2015 edition: 4.2 implemented (same requirement in 2026), 9.3 implemented (split)
  for (const ref of ['4.2', '9.3'])
    localSql(
      `update items set "values" = "values" || jsonb_build_object('${field(oldLib, 'status')}', 'opt_implemented', '${field(oldLib, 'applicable')}', 'applicable') where id = '${item(oldLib, ref)}'`,
    );

  const adopted = page.getByRole('list', { name: 'Adopted frameworks' });
  await expect(adopted).toContainText('Adopt ISO 14001:2026 from the catalogue below');
  await adopt(page, 'ISO 14001:2026', 42);
  const newLib = lib('2026');

  const row = adopted.getByRole('listitem').filter({ hasText: 'ISO 14001:2015 requirements' });
  await row.getByRole('button', { name: 'Move ISO 14001:2015 to ISO 14001:2026' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('list', { name: 'What moving does' })).toContainText(
    '1 requirement get the answers',
    { timeout: 45_000 },
  );
  const review = dialog.getByRole('list', { name: 'Requirements to review' });
  await expect(review).toContainText('Planning of changes');
  await expect(review).toContainText('Continual improvement');
  await dialog.getByRole('button', { name: 'Move to ISO 14001:2026' }).click();
  await expect(dialog.getByRole('status')).toContainText('Moved: 1 requirement copied', {
    timeout: 30_000,
  });
  await dialog.getByRole('button', { name: 'Done' }).click();

  // copied where the requirement is the same, not where it was split
  const status = (sheet: string, ref: string) =>
    localSql(
      `select "values"->>'${field(sheet, 'status')}' from items where id = '${item(sheet, ref)}'`,
    ).trim();
  expect(status(newLib, '4.2')).toBe('opt_implemented');
  expect(status(newLib, '9.3.1')).toBe('');
  // the copy is on the item's audit trail; the old library is locked and says where the work moved
  expect(
    localSql(
      `select count(*) from activity_log where item_id = '${item(newLib, '4.2')}' and action = 'value.changed' and note like 'Copied from ISO 14001:2015%'`,
    ).trim(),
  ).not.toBe('0');
  expect(
    localSql(`select count(*) from items where sheet_id = '${oldLib}' and not locked`).trim(),
  ).toBe('0');
  await expect(row).toContainText('Read-only: moved to');
  await page.goto(`/${slug}/s/${oldLib}`);
  await expect(page.getByTestId('library-moved')).toContainText('ISO 14001:2026');
});
