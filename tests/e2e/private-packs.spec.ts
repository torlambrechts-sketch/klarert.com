import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { localSql, seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// "Save your setup" (docs/11 Your own packs, P9). A consultant who is an owner in workspaces A, B and C builds on the
// shared registers in A (their own sheets with automations, an automation with a webhook and one that tells a named
// person, a column added to the Risk register), saves the setup as a pack (the Left out report names the webhook
// address and the people), installs it in B (which installs the shared registers first), publishes 1.1.0, and B's
// client admin (not a member of A) takes the update and keeps their own change. Withdrawing stops a new install in C,
// and a member of C who is not in A never sees the pack. At 1440 and 390 px (P9_SHOTS saves the screenshots).

const SHOTS = process.env.P9_SHOTS;
const PACK = 'Practice method';

async function shot(page: Page, name: string, project: string) {
  if (SHOTS)
    await page.screenshot({ path: `${SHOTS}/${name}-${project === 'phone' ? 390 : 1440}.png` });
}

// the first line: an insert … returning also prints its command tag
const one = (q: string) => localSql(q).trim().split('\n')[0]!.trim();

/** Install a catalogue pack into a seeded workspace (service role), as tests/e2e/install-pack-version.ts does. */
function installCatalogue(slug: string, key: string, version: string, level: string) {
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
      level,
    ],
    { stdio: 'pipe', timeout: 120_000 },
  );
}

async function packsTab(page: Page, slug: string) {
  await page.goto(`/${slug}/settings?tab=packs`);
  await expect(page.getByRole('heading', { name: 'Your packs' })).toBeVisible({ timeout: 30_000 });
}

async function saveSetup(page: Page) {
  await page.getByRole('button', { name: 'Save your setup' }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Save your setup' });
  await expect(dialog.getByTestId('inside')).toBeVisible({ timeout: 60_000 });
  return dialog;
}

test('save your setup, install it in a client workspace, update it there, withdraw it', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(480_000);
  const project = info.project.name;
  if (project !== 'phone') await page.setViewportSize({ width: 1440, height: 900 });
  const a = seedWorkspace('pp-a', { empty: true });
  const b = seedWorkspace('pp-b', { empty: true });
  const c = seedWorkspace('pp-c', { empty: true });
  const core = one(`select version from packs where key = 'core' order by created_at desc limit 1`);
  installCatalogue(a, 'core', core, 'full');
  const orgA = one(`select id from orgs where slug = '${a}'`);
  const orgB = one(`select id from orgs where slug = '${b}'`);
  const orgC = one(`select id from orgs where slug = '${c}'`);
  const maria = one(`select id from auth.users where email = 'maria@example.com'`);
  const risk = one(
    `select s.id from sheets s join pack_installs i on i.id = s.pack_install_id
      where s.org_id = '${orgA}' and i.pack_key = 'core' and s.pack_ref = 'risk'`,
  );
  // what the consultant built on top: their own sheet, a column on the shared Risk register, an automation with a
  // webhook and one that tells a named person
  const capa = one(
    `insert into sheets (org_id, name, item_label, id_prefix, position)
     values ('${orgA}', 'Client onboarding', 'Client', 'ONB-', 'zz') returning id`,
  );
  localSql(
    `insert into groups (org_id, sheet_id, name, color, position) values ('${orgA}', '${capa}', 'Open', 'blue', 'a0'),
       ('${orgA}', '${capa}', 'Done', 'green', 'a1');
     insert into fields (org_id, sheet_id, key, name, type, position, config) values
       ('${orgA}', '${capa}', 'status', 'Status', 'status', 'a0',
        '{"options": [{"id": "opt_open", "label": "Open", "color": "blue"}, {"id": "opt_done", "label": "Done", "color": "green", "done": true}]}'),
       ('${orgA}', '${capa}', 'owner', 'Owner', 'people', 'a1', '{"multiple": false}'),
       ('${orgA}', '${capa}', 'contact', 'Client contact', 'text', 'a2', '{"personalData": true}'),
       ('${orgA}', '${capa}', 'due', 'Due', 'date', 'a3', '{}')`,
  );
  localSql(
    `insert into fields (org_id, sheet_id, key, name, type, position, config)
     values ('${orgA}', '${risk}', 'client_ref', 'Client reference', 'text', 'zz', '{}')`,
  );
  localSql(
    `insert into automations (org_id, sheet_id, name, enabled, trigger, conditions, actions) values
     ('${orgA}', '${capa}', 'Closed → tell the client system', true, '{"type": "item_created"}', '[]',
      '[{"type": "webhook", "url": "https://hooks.example.com/practice/abc"}, {"type": "post_update", "message": "Sent to the client system."}]'),
     ('${orgA}', '${capa}', 'New → tell Maria', true, '{"type": "item_created"}', '[]',
      '[{"type": "notify", "to": ["user:${maria}"], "message": "New {name}."}, {"type": "post_update", "message": "Logged."}]')`,
  );

  // ── A: Save your setup
  await signIn(page, 'maria@example.com', `/${a}/settings?tab=packs`);
  await packsTab(page, a);
  await expect(page.getByText('Nothing published from this workspace yet.')).toBeVisible();
  let dialog = await saveSetup(page);
  await expect(dialog.getByTestId('publisher')).toContainText(`Published from Workspace ${a}`);
  await expect(dialog.getByTestId('publisher')).toContainText(
    "Publish from your practice or head-office workspace, not a client's.",
  );
  await expect(dialog.getByTestId('adds')).toContainText('Risk register: 1 column');
  await expect(dialog.getByTestId('example-items-note')).toContainText('Example items come later');
  const leftOut = dialog.getByTestId('left-out');
  await expect(leftOut).toContainText('The webhook to hooks.example.com is left out');
  await expect(leftOut).toContainText('Add the address after install');
  await expect(leftOut).toContainText('New → tell Maria: An action told only named people');
  await expect(dialog.getByTestId('version-hint')).toContainText('Suggested 1.0.0');
  await expect(dialog.getByRole('checkbox', { name: /^Client onboarding/ }).first()).toBeChecked();
  await expect(leftOut).toContainText(
    'Client onboarding: It holds personal data, so it installs restricted',
  );
  await shot(page, 'save-your-setup', project);
  await leftOut.scrollIntoViewIfNeeded();
  await shot(page, 'left-out', project);
  await dialog.getByLabel('Name', { exact: true }).fill(PACK);
  await dialog.getByRole('button', { name: 'Publish 1.0.0' }).click();
  await expect(dialog.getByTestId('published')).toContainText(`Published ${PACK} 1.0.0`, {
    timeout: 60_000,
  });
  await dialog.getByRole('button', { name: 'Done' }).click();
  const published = page.getByTestId('published-packs');
  await expect(published).toContainText(PACK);
  await expect(published).toContainText('Installed in 0 other workspaces');
  const key = one(
    `select key from packs where owner_org_id = '${orgA}' and key not like 'framework-%' limit 1`,
  );
  expect(key).toMatch(/^w[0-9a-f]{8}-practice-method$/);
  expect(
    one(
      `select manifest::text like '%hooks.example.com%' or manifest::text like '%${maria}%' from packs where key = '${key}'`,
    ),
  ).toBe('f');

  // ── B: install it (the shared registers first); the preview names the publisher
  await packsTab(page, b);
  // Maria is an owner of other test workspaces too: the row of A's pack
  const row = page
    .getByTestId('installable-packs')
    .getByRole('listitem')
    .filter({ hasText: PACK })
    .filter({ hasText: `From Workspace ${a}` });
  await expect(row).toContainText(`From Workspace ${a}`);
  await row.getByRole('button', { name: `Preview ${PACK}` }).click();
  const install = page.getByRole('dialog').filter({ hasText: PACK });
  await expect(install.getByTestId('pack-publisher')).toContainText(
    `published from Workspace ${a}`,
    {
      timeout: 60_000,
    },
  );
  await expect(install.getByTestId('installs-first')).toContainText('Installs Shared registers');
  await shot(page, 'install-preview', project);
  await install.getByRole('button', { name: 'Install' }).click();
  await expect(install.getByRole('status')).toContainText(`Installed ${PACK}`, {
    timeout: 120_000,
  });
  await expect(install.getByRole('status')).toContainText('Installed Shared registers');
  await install.getByRole('button', { name: 'Done' }).click();
  expect(
    one(`select count(*) from pack_shares where pack_key = '${key}' and org_id = '${orgB}'`),
  ).toBe('1');
  expect(
    one(
      `select new_value->>'source' from activity_log where org_id = '${orgB}' and action = 'pack.installed' and new_value->>'pack_key' = '${key}'`,
    ),
  ).toBe('private');
  // every automation starts in test mode (or off); none sends anything out
  expect(
    one(`select count(*) from automations a join pack_installs i on i.id = a.pack_install_id
          where i.org_id = '${orgB}' and i.pack_key = '${key}' and a.enabled and a.mode <> 'test'`),
  ).toBe('0');

  // ── B's client admin (not in A) changes the sheet name; A publishes 1.1.0 with a new column
  const james = one(`select id from auth.users where email = 'james@example.com'`);
  localSql(`delete from memberships where org_id = '${orgA}' and user_id = '${james}'`);
  localSql(
    `update memberships set role = 'admin' where org_id = '${orgB}' and user_id = '${james}'`,
  );
  const bSheet = one(
    `select s.id from sheets s join pack_installs i on i.id = s.pack_install_id
      where i.org_id = '${orgB}' and i.pack_key = '${key}' and s.name = 'Client onboarding'`,
  );
  // the sheet holds personal data, so it installed restricted: the installer listed them as an editor (docs/02 §16)
  expect(one(`select restricted from sheets where id = '${bSheet}'`)).toBe('t');
  localSql(
    `insert into access_grants (org_id, sheet_id, user_id, level) values ('${orgB}', '${bSheet}', '${james}', 'editor')`,
  );
  localSql(`update sheets set name = 'Our onboarding' where id = '${bSheet}'`);
  localSql(
    `insert into fields (org_id, sheet_id, key, name, type, position, config)
     values ('${orgA}', '${capa}', 'client_signoff', 'Client sign-off', 'date', 'zz', '{}')`,
  );
  await packsTab(page, a);
  dialog = await saveSetup(page);
  await dialog
    .getByLabel('Publish as')
    .selectOption({ label: `A new version of ${PACK} (now 1.0.0)` });
  await expect(dialog.getByTestId('version-hint')).toContainText('Suggested 1.1.0', {
    timeout: 60_000,
  });
  await dialog.getByRole('button', { name: 'Publish 1.1.0' }).click();
  await expect(dialog.getByTestId('published')).toContainText(`Published ${PACK} 1.1.0`, {
    timeout: 60_000,
  });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('published-packs')).toContainText('Installed in 1 other workspace');
  await page.getByTestId('published-packs').scrollIntoViewIfNeeded();
  await expect(page.getByText(`Published ${PACK} 1.1.0.`)).toHaveCount(0, { timeout: 10_000 });
  await shot(page, 'your-packs', project);

  const client = await (await browser.newContext()).newPage();
  if (project === 'phone') await client.setViewportSize({ width: 390, height: 844 });
  else await client.setViewportSize({ width: 1440, height: 900 });
  await signIn(client, 'james@example.com', `/${b}/settings?tab=packs`);
  await packsTab(client, b);
  // James sees the pack (shared to B) but cannot read A's rows of orgs or packs other than through the share
  const installedRow = client
    .getByRole('list', { name: 'Installed packs' })
    .getByRole('listitem')
    .filter({ hasText: PACK });
  await expect(installedRow).toContainText(`Your own pack, from Workspace ${a}`);
  await expect(installedRow.getByTestId('update-available')).toContainText('1.0.0 → 1.1.0');
  await installedRow.getByRole('button', { name: /^Update .* from 1\.0\.0 to 1\.1\.0$/ }).click();
  const up = client.getByRole('dialog');
  await expect(up.getByTestId('upgrade-summary')).toBeVisible({ timeout: 60_000 });
  await expect(up.getByRole('list', { name: 'Added' })).toContainText('Client sign-off');
  await shot(client, 'update', project);
  await up.getByRole('button', { name: 'Apply update' }).click();
  await expect(up.getByRole('status')).toContainText('to 1.1.0', { timeout: 60_000 });
  await up.getByRole('button', { name: 'Done' }).click();
  expect(one(`select name from sheets where id = '${bSheet}'`)).toBe('Our onboarding');
  expect(
    one(`select count(*) from fields where sheet_id = '${bSheet}' and key = 'client_signoff'`),
  ).toBe('1');
  expect(
    one(
      `select new_value->>'source' from activity_log where org_id = '${orgB}' and action = 'pack.upgraded' and new_value->>'pack_key' = '${key}'`,
    ),
  ).toBe('private');
  await client.context().close();

  // ── A withdraws it: no new install in C; B keeps it
  await packsTab(page, a);
  const pubRow = page
    .getByTestId('published-packs')
    .getByRole('listitem')
    .filter({ hasText: PACK });
  await pubRow.getByRole('button', { name: `Withdraw ${PACK}` }).click();
  await pubRow.getByRole('button', { name: `Withdraw ${PACK}` }).click();
  await expect(pubRow).toContainText('Withdrawn', { timeout: 30_000 });
  await packsTab(page, c);
  const cRow = page
    .getByTestId('installable-packs')
    .getByRole('listitem')
    .filter({ hasText: PACK })
    .filter({ hasText: `From Workspace ${a}` });
  await expect(cRow).toContainText('Withdrawn');
  await expect(cRow.getByRole('button', { name: `Preview ${PACK}` })).toHaveCount(0);
  expect(
    one(`select status from pack_installs where org_id = '${orgB}' and pack_key = '${key}'`),
  ).toBe('installed');

  // ── a member of C who is not in A never sees it
  const tom = one(`select id from auth.users where email = 'tom@example.com'`);
  // Tom is in C only (seeded workspaces share their people): not in the publisher, not in B where it is shared
  localSql(`delete from memberships where org_id in ('${orgA}', '${orgB}') and user_id = '${tom}'`);
  localSql(`update memberships set role = 'admin' where org_id = '${orgC}' and user_id = '${tom}'`);
  const stranger = await (await browser.newContext()).newPage();
  if (project === 'phone') await stranger.setViewportSize({ width: 390, height: 844 });
  await signIn(stranger, 'tom@example.com', `/${c}/settings?tab=packs`);
  await packsTab(stranger, c);
  await expect(stranger.getByTestId('installable-packs')).toHaveCount(0);
  await expect(stranger.getByText(PACK)).toHaveCount(0);
  expect(await rest<unknown[]>(stranger, `packs?key=eq.${key}&select=key`)).toEqual([]);
  await stranger.context().close();
});
