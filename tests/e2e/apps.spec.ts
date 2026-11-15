import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// Apps (P7, docs/13): an owner installs the CAPA pack, finds the CAPA app under Apps in the side menu, opens its
// "Report a problem" form, reports a problem and finds the containment step in "My actions" (the pack adds the CAPA
// steps to a reported problem, the reporter owns containment). Runs on desktop and at 390 px.

const TITLE = 'Corrective action (CAPA)';
const packRow = (page: Page) =>
  page
    .getByRole('list', { name: 'Available packs' })
    .getByRole('listitem')
    .filter({ hasText: TITLE });

test('install the CAPA pack, report a problem in its app and find it in My actions', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const phone = info.project.name === 'phone';
  const slug = seedWorkspace(phone ? 'app' : 'apd', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
  await packRow(page)
    .getByRole('button', { name: `Preview ${TITLE}` })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect(dialog.getByRole('status')).toContainText(`Installed ${TITLE}.`, {
    timeout: 30_000,
  });
  await page.keyboard.press('Escape');

  // ── the app is in the side menu under Apps (on a phone, in the menu sheet)
  await page.goto(`/${slug}/home`);
  if (phone) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const apps = page.getByRole('list', { name: 'Apps' });
  await expect(apps.getByRole('link', { name: 'CAPA' })).toBeVisible();
  await apps.getByRole('link', { name: 'CAPA' }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/apps/capa/report$`));
  const screens = page.getByRole('navigation', { name: 'CAPA screens' });
  await expect(screens.getByRole('link')).toHaveText([
    'Report a problem',
    'My actions',
    'Needs my approval',
    'All nonconformities',
    'Overview',
    'Workflow',
  ]);
  await expect(page.getByRole('heading', { name: 'Report a problem', level: 1 })).toBeVisible();

  // ── the pack installed its form as a draft: the owner opens it here
  await page.getByRole('button', { name: 'Open the form' }).click();
  const form = page.getByRole('form', { name: 'Raise a nonconformity' });
  await expect(form).toBeVisible();
  const problem = `Guard missing on press ${Date.now().toString(36)}`;
  await form.getByRole('textbox', { name: /^Nonconformity/ }).fill(problem);
  await form.getByRole('button', { name: /^Found on/ }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await form.getByLabel(/What is wrong\?/).fill('The guard on press 4 was removed for cleaning.');
  await form.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Sent\./ })).toBeVisible();

  // ── the reporter's containment step is in My actions, and opens the item panel on the sheet
  await page.getByRole('link', { name: 'Go to My actions' }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/apps/capa/my-actions$`));
  const list = page.getByRole('list', { name: 'My actions' });
  const row = list.getByRole('link').filter({ hasText: 'Containment' });
  await expect(row).toBeVisible();
  await expect(row).toContainText(problem);
  await expect(list.getByRole('link')).toHaveCount(1);

  const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
  const [install] = await rest<{ ref_map: Record<string, string>; version: string }[]>(
    page,
    `pack_installs?org_id=eq.${org!.id}&pack_key=eq.start-capa&select=ref_map,version`,
  );
  expect(install!.version).toBe('1.2.0');
  const subs = await rest<{ name: string }[]>(
    page,
    `items?sheet_id=eq.${install!.ref_map['sheet:capa.subitems']}&select=name&order=sub_seq`,
  );
  expect(subs.map((s) => s.name)).toEqual([
    'Containment',
    'Root cause',
    'Correction',
    'Corrective action',
    'Effectiveness check',
  ]);

  await row.click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/s/${install!.ref_map['sheet:capa']}\\?item=`));
  await expect(page.getByRole('dialog').getByText('Containment').first()).toBeVisible();

  // ── nothing waits for verification yet; the overview counts the open problem
  await page.goto(`/${slug}/apps/capa/approvals`);
  await expect(page.getByText('Nothing waits for your verification.')).toBeVisible();
  await page.goto(`/${slug}/apps/capa/overview`);
  await expect(page.getByRole('heading', { name: 'Open nonconformities' })).toBeVisible();
});

// ── Owner decision (15 Nov 2026): CAPA reuses Core's register (docs/11 Optional requirements, docs/13 CAPA on Core).
// In a workspace with the Core registers, Create › App › CAPA makes no second register: the app's screens and its
// overview read Core's Nonconformities and CAPA, so they show the open nonconformities already there.

const SHOTS = process.env.CAPA_SHOTS;

/** A pack installed as a workspace that had it before (service role, tests/e2e/install-pack-version.ts). */
function installVersion(slug: string, key: string, version: string, level: string) {
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
      level,
    ],
    { encoding: 'utf8', stdio: 'pipe', timeout: 90_000 },
  );
  return (JSON.parse(out) as { refMap: Record<string, string> }).refMap;
}

test.describe('CAPA on the Core registers', () => {
  test.use(SHOTS ? { deviceScaleFactor: 2 } : {});
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'chromium', 'desktop walkthrough'));

  test('Create › App › CAPA in a Core workspace makes no second register and shows Core’s open items', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const slug = seedWorkspace('apcore', { empty: true });
    const core = installVersion(slug, 'core', '1.3.0', 'starter');
    await signIn(page, 'maria@example.com', `/${slug}/home`);
    await page.goto(`/${slug}/home`);

    // ── three nonconformities in Core's register: two open, one closed
    const nc = core['sheet:nc']!;
    const fields = await rest<{ id: string; key: string }[]>(
      page,
      `fields?sheet_id=eq.${nc}&select=id,key`,
    );
    const groups = await rest<{ id: string; name: string }[]>(
      page,
      `groups?sheet_id=eq.${nc}&select=id,name`,
    );
    const field = (k: string) => fields.find((f) => f.key === k)!.id;
    const group = (n: string) => groups.find((g) => g.name === n)!.id;
    const rows: [string, string, string, string][] = [
      ['Open', 'Calibration overdue on scale 3', 'opt_containment', 'a0'],
      ['Open', 'Supplier certificate expired', 'opt_action_plan', 'a1'],
      ['Closed', 'Training record missing', 'opt_closed', 'a2'],
    ];
    for (const [g, name, stage, position] of rows)
      await rest(page, 'rpc/create_item', {
        method: 'POST',
        body: {
          p_sheet: nc,
          p_group: group(g),
          p_name: name,
          p_position: position,
          p_values: { [field('stage')]: stage },
        },
      });

    // ── Create › App › CAPA: it uses Core's registers and makes no register of its own
    const wizard = page.getByRole('dialog', { name: 'Create' });
    await expect(async () => {
      await page.keyboard.press('Control+k');
      await expect(wizard).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await wizard.getByTestId('create-card-app').click();
    await wizard.getByTestId('create-app-capa').click();
    const preview = wizard.getByTestId('create-app-preview');
    await expect(preview.getByTestId('create-app-uses')).toHaveText(
      'Uses sheets you already have: Nonconformities and CAPA (Shared registers), Actions (Shared registers).',
    );
    await expect(preview.getByTestId('create-summary')).toHaveText('Creates 1 dashboard · 1 app.');
    await expect(preview.getByTestId('create-uses')).toContainText('No second register is made.');
    await expect(preview.getByRole('list', { name: 'Work screens' })).toContainText(
      'Report a problem · Form on Nonconformities and CAPA',
    );
    await wizard.getByTestId('create-next').click();
    await wizard.getByTestId('create-submit').click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/apps/capa(/[a-z-]+)?$`), {
      timeout: 60_000,
    });

    // ── no second register: the install made no sheet, and its form is on Core's register
    const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
    const [install] = await rest<
      { id: string; version: string; ref_map: Record<string, string> }[]
    >(
      page,
      `pack_installs?org_id=eq.${org!.id}&pack_key=eq.start-capa&status=eq.installed&select=id,version,ref_map`,
    );
    expect(install!.version).toBe('1.2.0');
    expect(Object.keys(install!.ref_map).filter((r) => r.startsWith('sheet:'))).toEqual([]);
    expect(install!.ref_map['view:core:nc.form.startcapa_report']).toBeTruthy();
    expect(
      await rest(page, `sheets?org_id=eq.${org!.id}&pack_install_id=eq.${install!.id}&select=id`),
    ).toEqual([]);
    expect(
      await rest(
        page,
        `sheets?org_id=eq.${org!.id}&name=eq.Corrective%20action%20(CAPA)&select=id`,
      ),
    ).toEqual([]);

    // ── the app reads Core's register: its six screens, Core's items, Core's open count
    await expect(
      page.getByRole('navigation', { name: 'CAPA screens' }).getByRole('link'),
    ).toHaveText([
      'Report a problem',
      'My actions',
      'Needs my approval',
      'All nonconformities',
      'Overview',
      'Workflow',
    ]);
    await page.goto(`/${slug}/apps/capa/all`);
    await expect(page).toHaveURL(new RegExp(`/${slug}/apps/capa/all$`));
    for (const [, name] of rows) await expect(page.getByText(name).first()).toBeVisible();

    await page.goto(`/${slug}/apps/capa/overview`);
    const open = page.getByRole('listitem', { name: 'Open nonconformities' });
    await expect(open).toContainText('2');
    await expect(open).toContainText('of 3 nonconformities in Nonconformities and CAPA');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/capa-on-core-overview.png` });

    // ── Create again: CAPA is ready here, on Core's register
    await expect(async () => {
      await page.keyboard.press('Control+k');
      await expect(wizard).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await wizard.getByTestId('create-card-app').click();
    await expect(wizard.getByTestId('create-app-capa')).toContainText('Ready');
  });
});
