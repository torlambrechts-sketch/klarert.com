import { execFileSync } from 'node:child_process';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { expectWorkflow } from './addon-helpers';
import { localSql, seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// Core registers updates (docs/11 Core registers, Upgrades), from versions kept in tests/e2e/fixtures/catalogue.
// 1.0.0 → 1.3.0: a workspace has Core 1.0.0 (Full) with the ISO/IEC 27001 2.0.0 and Supplier management 2.0.0 add-ons
// on it. Workspace admin › Packs offers "Update available 1.0.0 → 1.3.0" for Core; the dry run adds Context and
// interested parties and Suppliers, the shared Requirements column and the approval workflows with no conflict;
// after the update Documents and policies carries the Document approval workflow, the add-ons' columns are still on
// the Core sheets and both add-ons are still installed.
// 1.1.0 → 1.3.0 (1.2.0, owner decision, Nov 2026): the update adds "Approve by" and points Document approval at it; a
// document is submitted to the person in Approve by, who approves it, and the approval fills in Approver and
// Approved on, which nobody sets by hand.

const SHOTS = process.env.CORE11_SHOTS;
/** Screenshots of the Core 1.2.0 work, when set. */
const CORE12_SHOTS = process.env.CORE12_SHOTS;

const PDF = (label: string) =>
  Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
      `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n% ${label}\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  );

async function as(browser: Browser, email: string, next: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email, next);
  await page.goto(next);
  return page;
}

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
  expect(out).toContain('core 1.3.0: meets the bar');
});

test('update Core 1.0.0 to 1.3.0 with ISO/IEC 27001 and Supplier management installed', async ({
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
    .filter({ hasText: 'Shared registers' });
  await expect(row.getByTestId('update-available')).toContainText('1.0.0 → 1.3.0');
  await row.getByRole('button', { name: /^Update .* from 1\.0\.0 to 1\.3\.0$/ }).click();

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
  await expect(dialog.getByRole('status')).toContainText('to 1.3.0', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(row.getByTestId('update-available')).toHaveCount(0);
  await expect(row).toContainText('1.3.0');

  // ── after: the add-ons and their columns are where they were, Core has its new registers and workflows
  expect(
    one(
      `select string_agg(pack_key || ' ' || version, ', ' order by pack_key) from pack_installs
        where org_id = '${org}' and status = 'installed'`,
    ),
  ).toBe('core 1.3.0, iso-27001 2.0.0, supplier-management 2.0.0');
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

test('update Core 1.1.0 to 1.3.0: Document approval goes to Approve by, the approval fills in Approver', async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name === 'phone',
    'desktop walkthrough; the update dialog is checked at 390 px above',
  );
  test.setTimeout(300_000);
  const slug = seedWorkspace('c12', { empty: true });
  install(slug, 'core', '1.1.0', 'starter');
  const org = one(`select id from orgs where slug = '${slug}'`);
  const documents = one(
    `select s.id from sheets s join pack_installs i on i.id = s.pack_install_id
      where s.org_id = '${org}' and i.pack_key = 'core' and s.pack_ref = 'documents'`,
  );

  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
  await page.goto(`/${slug}/settings?tab=packs`);
  const row = page
    .getByRole('list', { name: 'Installed packs' })
    .getByRole('listitem')
    .filter({ hasText: 'Shared registers' });
  await expect(row.getByTestId('update-available')).toContainText('1.1.0 → 1.3.0');
  await row.getByRole('button', { name: /^Update .* from 1\.1\.0 to 1\.3\.0$/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('upgrade-summary')).toContainText('0 conflicts', {
    timeout: 60_000,
  });
  await expect(dialog.getByRole('list', { name: 'Added' })).toContainText(
    'Documents and policies › Approve by',
  );
  await expect(dialog.getByRole('list', { name: 'Changed' })).toContainText('Approval workflows');
  await dialog.getByRole('button', { name: 'Apply update' }).click();
  await expect(dialog.getByRole('status')).toContainText('to 1.3.0', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(row).toContainText('1.3.0');

  // the workflow takes its approvers from Approve by and needs it before submitting
  const workflow = JSON.parse(
    one(
      `select w from sheets s, jsonb_array_elements(s.settings->'workflows') w
        where s.id = '${documents}' and w->>'id' = 'document-approval'`,
    ),
  ) as { requiredFields: string[]; steps: { approvers: unknown }[] };
  expect(workflow.requiredFields).toEqual(['owner', 'approve_by']);
  expect(workflow.steps[0]!.approvers).toEqual({ kind: 'field', fieldKey: 'approve_by' });

  // ── Maria owns the policy and names James in Approve by; Approver stays empty (nobody sets it by hand)
  const fields = await rest<{ id: string; key: string }[]>(
    page,
    `fields?sheet_id=eq.${documents}&select=id,key`,
  );
  const fid = (k: string) => fields.find((f) => f.key === k)!.id;
  const user = (email: string) => one(`select id from auth.users where email = '${email}'`);
  const [doc] = await rest<{ id: string; display_id: string; name: string }[]>(
    page,
    `items?sheet_id=eq.${documents}&archived_at=is.null&select=id,display_id,name&order=seq&limit=1`,
  );
  await rest(page, 'rpc/set_item_values', {
    method: 'POST',
    body: {
      p_item: doc!.id,
      p_patch: {
        [fid('owner')]: [user('maria@example.com')],
        [fid('approve_by')]: [user('james@example.com')],
      },
    },
  });
  // the document file, uploaded from the Files tab
  await page.goto(`/${slug}/s/${documents}?item=${doc!.display_id}`);
  const itemPanel = page.getByRole('dialog').filter({ has: page.getByRole('tablist') });
  await itemPanel.getByRole('tab', { name: /^Files · / }).click();
  await itemPanel.getByLabel('Choose files to upload').setInputFiles({
    name: 'policy-v1.pdf',
    mimeType: 'application/pdf',
    buffer: PDF('policy v1'),
  });
  await expect(
    itemPanel.getByTestId('file-row').filter({ hasText: 'policy-v1.pdf' }),
  ).toBeVisible();
  await itemPanel.getByRole('tab', { name: 'Details' }).click();

  // ── submitted to the person in Approve by
  const approvals = page.getByTestId('item-approvals');
  await approvals.getByRole('button', { name: 'Submit for approval' }).click();
  const submit = page.getByRole('dialog', { name: 'Submit for approval' });
  await expect(submit.getByRole('list', { name: 'Who approves' })).toContainText('James Okafor');
  await submit.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(approvals.getByTestId('approval-state')).toContainText(
    'Waiting for approval: step 1 of 1, Approval',
  );
  const values = () =>
    JSON.parse(one(`select "values" from items where id = '${doc!.id}'`)) as Record<
      string,
      unknown
    >;
  expect(values()[fid('status')]).toBe('opt_review');
  expect(values()[fid('approver')] ?? null).toBeNull();
  if (CORE12_SHOTS) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await approvals.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `${CORE12_SHOTS}/document-approval-submitted.png` });
  }

  // ── James approves with a version note; the approval records him and today
  const james = await as(browser, 'james@example.com', `/${slug}/my-work`);
  const inbox = james.getByTestId('approval-inbox');
  await expect(inbox.getByTestId('approval-row')).toHaveCount(1);
  await inbox.getByRole('button', { name: `Approve ${doc!.display_id} ${doc!.name}` }).click();
  const decide = james.getByRole('dialog', { name: new RegExp(`^Approve ${doc!.display_id}`) });
  await decide.getByLabel('Version note').fill('First issue');
  await decide.getByRole('button', { name: 'Approve' }).click();
  await expect(inbox).toContainText('Nothing waits for your approval.');
  await expect.poll(() => values()[fid('status')]).toBe('opt_approved');
  expect(values()[fid('approver')]).toEqual([user('james@example.com')]);
  expect(values()[fid('approved_on')]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(values()[fid('approve_by')]).toEqual([user('james@example.com')]);
  await james.context().close();
});
