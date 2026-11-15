import { execFileSync } from 'node:child_process';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { localSql, seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// The Design area (docs/05 §3.8 and §4; owner decision 15 Nov 2026) on the Core registers 1.3.0 (Starter) and the
// CAPA app's pack: the Nonconformities and CAPA sheet's flow (manual entry asking the pack's intake form, the forms,
// the pack's automation in test mode, the CAPA closure workflow, links, a Slack webhook with a dead letter) with
// health and pack provenance; an automation edited in the side window through the existing builder and logged; the
// Map toggle; Platform › Design with its map, Connections table and app filter; keyboard only; 390 px; a viewer reading
// only (a restricted field's name never shown); and the export. Screenshots with DESIGN_SHOTS=<dir>.

const SHOTS = process.env.DESIGN_SHOTS;
test.use({ deviceScaleFactor: SHOTS ? 2 : 1 });
test.describe.configure({ mode: 'serial', timeout: 240_000 });

async function shot(page: Page, name: string, fullPage = false) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
}

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
const SECRET = 'T0SECRET/B0SECRET/xoxSECRETTOKEN';

let w: { slug: string; org: string; nc: string };

test.beforeAll(({}, info) => {
  const slug = seedWorkspace(info.project.name === 'phone' ? 'dsp' : 'dsg', { empty: true });
  install(slug, 'core', '1.3.0', 'starter');
  install(slug, 'start-capa', '1.1.0');
  const org = one(`select id from orgs where slug = '${slug}'`);
  const nc = one(
    `select s.id from sheets s join pack_installs i on i.id = s.pack_install_id
      where s.org_id = '${org}' and i.pack_key = 'core' and s.pack_ref = 'nc'`,
  );
  const maria = one(`select id from auth.users where email = 'maria@example.com'`);
  // added here: a field only admins see, an automation that watches it, and a Slack webhook with a dead letter
  one(`insert into fields (org_id, sheet_id, key, name, type, position, config, restricted_to)
       values ('${org}', '${nc}', 'supplier_fee', 'Supplier fee', 'number', 'zzz', '{}',
               '{"roles":["admin"],"userIds":[]}')`);
  one(`insert into automations (org_id, sheet_id, name, trigger, actions, created_by)
       values ('${org}', '${nc}', 'When Supplier fee changes → notify Owner',
               '{"type":"field_changed","fieldKey":"supplier_fee"}',
               '[{"type":"notify","to":["field:owner"],"message":"Fee changed"}]', '${maria}')`);
  const hook = one(`insert into automations (org_id, sheet_id, name, trigger, actions, created_by)
       values ('${org}', '${nc}', 'Major → Slack', '{"type":"item_created"}',
               '[{"type":"webhook","url":"https://hooks.slack.com/services/${SECRET}","preset":"slack"}]',
               '${maria}') returning id`).split('\n')[0]!;
  one(`insert into outbound_webhooks (org_id, automation_id, url, payload, status)
       values ('${org}', '${hook}', 'https://hooks.slack.com/services/${SECRET}', '{}', 'dead_letter')`);
  w = { slug, org, nc };
});

const row = (page: Page, name: string | RegExp) =>
  page.getByTestId('design-list').getByRole('button', { name });

async function tabTo(page: Page, target: Locator, max = 80) {
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

const desktopOnly = (name: string) =>
  test.skip(name === 'phone', 'desktop; 390 px has its own test');

test('the Design tab lists Core nonconformities: inputs, sheet, logic, outputs, health and provenance', async ({
  page,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(page, 'maria@example.com', `/${w.slug}/s/${w.nc}`);
  await page.goto(`/${w.slug}/s/${w.nc}`);
  // the Design tab starts under More, among the hidden tabs
  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('button', { name: 'More' })
    .click();
  await page
    .getByRole('group', { name: 'Hidden tabs' })
    .getByRole('menuitem', { name: 'Design' })
    .click();
  await expect(page).toHaveURL(/view=design/);
  const list = page.getByTestId('design-list');
  await expect(list).toBeVisible();
  await expect(list.getByRole('heading', { level: 2 })).toHaveText([
    '01 · Inputs',
    '02 · Sheet',
    '03 · Logic',
    '04 · Outputs',
  ]);
  await expect(row(page, /^Manual entry/)).toContainText(
    'New item dialog asks the form “New nonconformity” in 3 steps',
  );
  await expect(row(page, /^Report a nonconformity/)).toContainText(
    'From Core registers · unchanged',
  );
  await expect(row(page, /^New nonconformity/)).toContainText('asked by + New');
  await expect(page.getByTestId('step-coming-later')).toContainText('API / webhook');
  await expect(page.getByTestId('step-coming-later')).toContainText('Coming later');
  await expect(row(page, /^Nonconformities and CAPA/)).toContainText('16 columns');
  const overdue = row(page, /^Nonconformity overdue → tell the owner/);
  await expect(overdue).toContainText('In test mode');
  await expect(overdue).toContainText('From Core registers · unchanged');
  await expect(row(page, /^CAPA closure/)).toContainText('Approval workflow');
  await expect(row(page, /^Stage lifecycle/)).toBeVisible();
  await expect(row(page, /^Incidents/)).toContainText('Link · Incident, both ways');
  const slack = row(page, /^Slack/);
  await expect(slack).toContainText('Leaves the system · hooks.slack.com/…');
  await expect(slack).toContainText('Dead letter: 1 webhook failed');
  await expect(slack).toContainText('Added here');
  await expect(row(page, /^When Supplier fee changes/)).toContainText('Added here');
  // a webhook's address never leaves the server
  expect(await page.content()).not.toContain('SECRETTOKEN');
});

test('an automation opens in the side window, is saved with the builder and lands in the activity log', async ({
  page,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(page, 'maria@example.com', `/${w.slug}/s/${w.nc}?view=design`);
  await page.goto(`/${w.slug}/s/${w.nc}?view=design`);
  await row(page, /^Nonconformity overdue → tell the owner/).click();
  const window = page.getByRole('dialog', { name: 'Nonconformity overdue → tell the owner' });
  await expect(window).toBeVisible();
  await expect(window.getByRole('combobox', { name: 'Trigger', exact: true })).toHaveValue(
    'date_arrives',
  );
  await shot(page, '01-sheet-list-side-window');
  await window.getByLabel('Name').fill('Overdue nonconformity → tell the owner');
  await window.getByRole('button', { name: 'Save as v2' }).click();
  await expect(window).toBeHidden();
  const renamed = row(page, /^Overdue nonconformity → tell the owner/);
  await expect(renamed).toContainText('From Core registers · changed');
  // focus returns to the row
  await expect(renamed).toBeFocused();
  // the change went through the automation commands: version 2 and the schema audit on the sheet's chain
  await expect
    .poll(async () =>
      (
        await rest<{ new_value: { name: string; version: number } }[]>(
          page,
          `activity_log?sheet_id=eq.${w.nc}&action=eq.automations.update&select=new_value&order=id`,
        )
      ).map((e) => [e.new_value.name, e.new_value.version]),
    )
    .toContainEqual(['Overdue nonconformity → tell the owner', 2]);
});

test('the Map toggle draws the same steps, read-only', async ({ page }, info) => {
  desktopOnly(info.project.name);
  await signIn(page, 'maria@example.com', `/${w.slug}/s/${w.nc}?view=design`);
  await page.goto(`/${w.slug}/s/${w.nc}?view=design`);
  await expect(row(page, /^Manual entry/)).toBeVisible();
  const rows = await page.locator('[data-step-row]').count();
  await page
    .getByRole('group', { name: 'Show the flow as' })
    .getByRole('button', { name: 'Map' })
    .click();
  await expect(page).toHaveURL(/show=map/);
  await expect(page.getByRole('img', { name: /^Map of Nonconformities and CAPA/ })).toBeVisible();
  // every step but the sheet itself is a node
  await expect(page.getByTestId('map-node')).toHaveCount(rows - 1);
  await expect(page.getByTestId('design-list')).toHaveCount(0);
  await shot(page, '02-map-toggle', true);
  await page.reload();
  await expect(page.getByTestId('sheet-map')).toBeVisible();
});

test('Platform › Design: the Connections table, the map, the app filter and the lane', async ({
  page,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(page, 'maria@example.com', `/${w.slug}/home`);
  await page.goto(`/${w.slug}/home`);
  await page
    .getByRole('navigation', { name: 'Side menu' })
    .getByRole('link', { name: 'Design' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Design' })).toBeVisible();
  const sheets = page.getByTestId('design-sheets');
  await expect(sheets.getByRole('link', { name: 'Nonconformities and CAPA' })).toBeVisible();
  await expect(page.getByTestId('design-connections')).toContainText('Link field, both ways');
  // the lane lists the Slack webhook with its fields, masked
  const lane = page.getByTestId('leaves-lane');
  await expect(lane.getByTestId('leaves-row')).toHaveCount(1);
  await expect(lane).toContainText('hooks.slack.com/…');
  await expect(lane).toContainText('Supplier fee (sent as “Restricted”)');
  await lane.scrollIntoViewIfNeeded();
  await shot(page, '05-leaves-the-system');

  // the app filter: the CAPA app's sheets, and the sheets they connect to as context
  await page.getByRole('combobox', { name: 'App', exact: true }).selectOption('capa');
  await expect(page).toHaveURL(/app=capa/);
  await expect(page.getByText(/^CAPA: \d+ sheets?/)).toBeVisible();
  await expect(sheets.getByRole('link', { name: 'Nonconformities and CAPA' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(page).not.toHaveURL(/app=/);

  // the map: a sheet's box opens its Design tab
  await page
    .getByRole('group', { name: 'Show the design as' })
    .getByRole('button', { name: 'Map' })
    .click();
  const map = page.getByTestId('workspace-map');
  await expect(map).toBeVisible();
  await shot(page, '03-overall-map', true);
  await map.getByRole('link', { name: /^Nonconformities and CAPA/ }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${w.nc}\\?view=design`));
  await expect(page.getByTestId('design-list')).toBeVisible();
});

test('keyboard only: arrows move between rows, Enter opens, Escape closes and focus returns', async ({
  page,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(page, 'maria@example.com', `/${w.slug}/s/${w.nc}?view=design`);
  await page.goto(`/${w.slug}/s/${w.nc}?view=design`);
  const manual = row(page, /^Manual entry/);
  await expect(manual).toBeVisible();
  await tabTo(page, manual);
  await page.keyboard.press('ArrowDown');
  await expect(row(page, /^Report a nonconformity/)).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('[data-step-row]').last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(manual).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const intake = row(page, /^New nonconformity/);
  await expect(intake).toBeFocused();
  await page.keyboard.press('Enter');
  const window = page.getByRole('dialog', { name: 'New nonconformity' });
  await expect(window).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(window).toBeHidden();
  await expect(intake).toBeFocused();
});

test('a viewer reads the design and changes nothing; a restricted field keeps its name', async ({
  page,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(page, 'vic@example.com', `/${w.slug}/s/${w.nc}?view=design`);
  await page.goto(`/${w.slug}/s/${w.nc}?view=design`);
  await expect(page.getByTestId('design-list')).toBeVisible();
  await expect(page.getByText('You can read this sheet’s design.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add input' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add logic' })).toHaveCount(0);
  await expect(row(page, /^When Restricted field changes/)).toBeVisible();
  expect(await page.content()).not.toContain('Supplier fee');
  await row(page, /^Overdue nonconformity → tell the owner/).click();
  const window = page.getByRole('dialog');
  await expect(window).toContainText(
    'You can read this step. Ask an editor or admin to change it.',
  );
  await expect(window.getByRole('button', { name: /^Save as v/ })).toHaveCount(0);
  await expect(window.getByRole('combobox', { name: 'Trigger', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // the workspace design keeps the lane for owners, admins and auditors
  await page.goto(`/${w.slug}/design`);
  await expect(
    page.getByText('Owners, admins and auditors see where data leaves the workspace.'),
  ).toBeVisible();
  await expect(page.getByTestId('leaves-lane')).toHaveCount(0);
  // the record's export shows them nothing and logs nothing
  const vic = one(`select id from auth.users where email = 'vic@example.com'`);
  await page.goto(`/${w.slug}/design/print?part=leaves`);
  await expect(page.getByTestId('design-print')).toContainText(
    'Owners, admins and auditors see where data leaves the workspace.',
  );
  expect(
    one(
      `select count(*) from activity_log where org_id = '${w.org}' and action = 'audit.exported' and actor_id = '${vic}'`,
    ),
  ).toBe('0');
});

const exportsLogged = () =>
  one(`select count(*) from activity_log where org_id = '${w.org}' and action = 'audit.exported'`);

test('the export prints the sheet’s flow and the data-flow record', async ({ page }, info) => {
  desktopOnly(info.project.name);
  const before = exportsLogged();
  await signIn(page, 'maria@example.com', `/${w.slug}/s/${w.nc}?view=design`);
  await page.goto(`/${w.slug}/s/${w.nc}?view=design`);
  await page.getByTestId('design-export').click();
  await expect(page).toHaveURL(new RegExp(`/design/print\\?sheet=${w.nc}`));
  const print = page.getByTestId('design-print');
  await expect(print.getByRole('heading', { level: 1 })).toHaveText(
    'Design of Nonconformities and CAPA',
  );
  await expect(print.getByTestId('print-flow')).toContainText('01 · Inputs');
  await expect(print.getByTestId('print-flow')).toContainText(
    'Overdue nonconformity → tell the owner',
  );
  await expect(print.getByTestId('leaves-row')).toContainText('hooks.slack.com/…');
  expect(await page.content()).not.toContain('SECRETTOKEN');
  await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
  await shot(page, '06-print-view', true);
  await page.emulateMedia({ media: 'screen' });
  // the workspace export with the page's filter
  await page.goto(`/${w.slug}/design/print?pack=core`);
  await expect(page.getByTestId('design-print')).toContainText('Scope: Pack: Core registers');
  await expect(page.getByTestId('print-connections')).toContainText('Link field, both ways');
  // the plain flow print and the workspace print are not logged
  expect(exportsLogged()).toBe(before);

  // the data-flow record is (owner decision 15 Nov 2026): who, when and the filters used, never an address or a value
  await page.goto(`/${w.slug}/design?pack=core`);
  await page
    .getByTestId('leaves-lane')
    .getByRole('link', { name: 'Export data-flow record' })
    .click();
  await expect(page).toHaveURL(/\/design\/print\?pack=core&part=leaves/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Data-flow record: leaves the system',
  );
  await expect(page.getByTestId('leaves-row')).toContainText('hooks.slack.com/…');
  expect(Number(exportsLogged())).toBe(Number(before) + 1);
  const maria = one(`select id from auth.users where email = 'maria@example.com'`);
  const [entry] = await rest<
    {
      actor_id: string;
      at: string;
      chain_key: string;
      note: string;
      new_value: Record<string, unknown>;
    }[]
  >(
    page,
    `activity_log?org_id=eq.${w.org}&action=eq.audit.exported&select=actor_id,at,chain_key,note,new_value&order=id.desc&limit=1`,
  );
  expect(entry!.actor_id).toBe(maria);
  expect(entry!.at).toBeTruthy();
  expect(entry!.chain_key).toBe(`sheet:${w.org}`);
  expect(entry!.note).toBe('Maria Pereira exported data flow record');
  expect(entry!.new_value).toEqual({
    kind: 'data_flow_record',
    app: null,
    pack: 'core',
    folder_id: null,
    domain: null,
    differs: false,
    sheets: expect.any(Number),
    destinations: 1,
  });
  const logged = JSON.stringify(entry);
  expect(logged).not.toContain('hooks.slack.com');
  expect(logged).not.toContain('SECRET');
  expect(logged).not.toContain('Supplier fee');
});

test('CAPA 1.2.0 on Core: its form on Core’s register is unchanged, and no sheet differs from its pack', async ({
  page,
}, info) => {
  desktopOnly(info.project.name);
  // the optional-requirement case (docs/11): start-capa 1.2.0 in a Core workspace makes no register of its own
  const slug = seedWorkspace('dsc', { empty: true });
  install(slug, 'core', '1.3.0', 'starter');
  install(slug, 'start-capa', '1.2.0');
  const org = one(`select id from orgs where slug = '${slug}'`);
  const nc = one(
    `select s.id from sheets s join pack_installs i on i.id = s.pack_install_id
      where s.org_id = '${org}' and i.pack_key = 'core' and s.pack_ref = 'nc'`,
  );
  await signIn(page, 'maria@example.com', `/${slug}/s/${nc}?view=design`);
  await page.goto(`/${slug}/s/${nc}?view=design`);
  await expect(row(page, /^Raise a nonconformity/)).toContainText(
    'From Corrective action (CAPA) · unchanged',
  );
  await expect(row(page, /^Report a nonconformity/)).toContainText(
    'From Core registers · unchanged',
  );
  await expect(page.getByTestId('design-list')).not.toContainText('· changed');
  await page.goto(`/${slug}/design?differs=1`);
  await expect(page.getByText('No sheets match these filters.')).toBeVisible();
});

test('at 390 px: the list, a full-screen side window with Back, and the Connections table only', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'the 390 px layout');
  await signIn(page, 'maria@example.com', `/${w.slug}/s/${w.nc}?view=design`);
  await page.goto(`/${w.slug}/s/${w.nc}?view=design`);
  await expect(row(page, /^Manual entry/)).toBeVisible();
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(0);
  await row(page, /^Nonconformity overdue/).click();
  const window = page.getByRole('dialog');
  await expect(window).toBeVisible();
  expect(Math.round((await window.boundingBox())!.width)).toBe(390);
  await window.getByRole('button', { name: 'Back' }).click();
  await expect(window).toBeHidden();
  await page.goto(`/${w.slug}/design?show=map`);
  await expect(page.getByTestId('design-connections')).toBeVisible();
  await expect(page.getByTestId('workspace-map')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Show the design as' })).toHaveCount(0);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.getByTestId('design-connections').scrollIntoViewIfNeeded();
  await shot(page, '04-connections-390');
});
