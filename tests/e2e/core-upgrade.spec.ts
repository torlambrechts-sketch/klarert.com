import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { expectWorkflow } from './addon-helpers';
import { localSql, seedWorkspace } from './first-sheet-helpers';
import { signIn } from './helpers';

// Core registers 1.0.0 → 1.1.0 (docs/11 Core registers, Upgrades): a workspace has Core 1.0.0 (Full) with the ISO/IEC
// 27001 2.0.0 and Supplier management 2.0.0 add-ons on it. Workspace admin › Packs offers "Update available 1.0.0 →
// 1.1.0" for Core; the dry run adds Context and interested parties and Suppliers, the shared Requirements column and
// the approval workflows with no conflict; after the update Documents and policies carries the Document approval
// workflow, the add-ons' columns are still on the Core sheets and both add-ons are still installed.

const SHOTS = process.env.CORE11_SHOTS;

/** Install an older version (or one with a level) of a catalogue pack with the service role, as the app once did. */
function install(slug: string, key: string, version: string, level?: string) {
  execFileSync(
    'pnpm',
    [
      'exec',
      'tsx',
      '--env-file-if-exists=.env.local',
      'tests/e2e/install-pack-version.ts',
      slug,
      key,
      version,
      ...(level ? [level] : []),
    ],
    { encoding: 'utf8', stdio: 'pipe', timeout: 90_000 },
  );
}

const one = (sql: string) => localSql(sql).trim();

test('the Core registers meet the pack quality bar', ({}, info) => {
  test.skip(info.project.name === 'phone', 'no page');
  // scripts/pack-quality.ts exits 1 when a named pack has a problem
  const out = execFileSync('pnpm', ['exec', 'tsx', 'scripts/pack-quality.ts', 'core'], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 60_000,
  });
  expect(out).toContain('core 1.1.0: meets the bar');
});

test('update Core 1.0.0 to 1.1.0 with ISO/IEC 27001 and Supplier management installed', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'phone';
  const slug = seedWorkspace(phone ? 'c11p' : 'c11', { empty: true });
  install(slug, 'core', '1.0.0', 'full');
  install(slug, 'iso-27001', '2.0.0');
  install(slug, 'supplier-management', '2.0.0');
  const org = one(`select id from orgs where slug = '${slug}'`);
  const coreSheet = (ref: string) =>
    one(
      `select s.id from sheets s join pack_installs i on i.id = s.pack_install_id
        where s.org_id = '${org}' and i.pack_key = 'core' and s.pack_ref = '${ref}'`,
    );
  const addonColumns = () =>
    Number(
      one(
        `select count(*) from fields f join pack_installs i on i.id = f.pack_install_id
          where f.org_id = '${org}' and i.pack_key in ('iso-27001', 'supplier-management')
            and f.sheet_id in (select s.id from sheets s join pack_installs c on c.id = s.pack_install_id
                                where c.pack_key = 'core') and f.archived_at is null`,
      ),
    );
  const before = addonColumns();
  expect(before).toBeGreaterThan(20);

  // parallel workers sign in as the same person: open this workspace whichever link was used
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
  await page.goto(`/${slug}/settings?tab=packs`);
  const row = page
    .getByRole('list', { name: 'Installed packs' })
    .getByRole('listitem')
    .filter({ hasText: 'Core registers' });
  await expect(row.getByTestId('update-available')).toContainText('1.0.0 → 1.1.0');
  await row.getByRole('button', { name: /^Update .* from 1\.0\.0 to 1\.1\.0$/ }).click();

  // ── the dry run: new registers, the shared column, the workflows; nothing in conflict, nothing archived
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('upgrade-summary')).toContainText('0 conflicts', {
    timeout: 60_000,
  });
  const added = dialog.getByRole('list', { name: 'Added' });
  await expect(added).toContainText('Context and interested parties');
  await expect(added).toContainText('Suppliers');
  await expect(added).toContainText('Documents and policies › Requirements');
  await expect(dialog.getByRole('list', { name: 'Changed' })).toContainText(
    'Description, approval workflows and tabs',
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/core-update-dialog.png` });
  if (phone)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );

  await dialog.getByRole('button', { name: 'Apply update' }).click();
  await expect(dialog.getByRole('status')).toContainText('to 1.1.0', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(row.getByTestId('update-available')).toHaveCount(0);
  await expect(row).toContainText('1.1.0');

  // ── after: the add-ons and their columns are where they were, Core has its new registers and workflows
  expect(
    one(
      `select string_agg(pack_key || ' ' || version, ', ' order by pack_key) from pack_installs
        where org_id = '${org}' and status = 'installed'`,
    ),
  ).toBe('core 1.1.0, iso-27001 2.0.0, supplier-management 2.0.0');
  expect(addonColumns()).toBe(before);
  expect(coreSheet('context')).not.toBe('');
  expect(coreSheet('suppliers')).not.toBe('');
  expect(
    one(
      `select string_agg(w->>'id', ',') from sheets s, jsonb_array_elements(s.settings->'workflows') w
        where s.id in ('${coreSheet('documents')}', '${coreSheet('risk')}', '${coreSheet('nc')}')`,
    )
      .split(',')
      .sort(),
  ).toEqual(['capa-closure', 'document-approval', 'risk-acceptance']);

  // the Document approval workflow on Documents and policies, ready to submit from a document
  const documents = coreSheet('documents');
  await expectWorkflow(page, slug, documents, 'Document approval');
  const doc = one(
    `select display_id from items where sheet_id = '${documents}' and archived_at is null order by seq limit 1`,
  );
  await page.goto(`/${slug}/s/${documents}?item=${doc}`);
  await expect(
    page.getByTestId('item-approvals').getByRole('button', { name: 'Submit for approval' }),
  ).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/core-document-approval.png` });

  // the tab set: Table, By status and Review dates on Documents and policies; Insights is in More
  await page.goto(`/${slug}/s/${documents}`);
  const tabs = page.getByRole('navigation', { name: 'Views' });
  await expect(tabs).toContainText('By status');
  await expect(tabs).toContainText('Review dates');
  await expect(tabs).not.toContainText('Insights');
});
