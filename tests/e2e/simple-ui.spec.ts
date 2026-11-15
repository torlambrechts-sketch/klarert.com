import { execFileSync } from 'node:child_process';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { localSql, seedWorkspace } from './first-sheet-helpers';
import { signIn } from './helpers';

// The Simple step (owner decisions 15 Nov 2026; board review UX-1..UX-15, A1..A13):
// - the side menu has four groups, Work, Registers, Reports and Build; Build only for editors and up, Workspace admin
//   only for admins and owners; viewers see no Build and no "Platform"; there is no menu filter (one search);
// - at 390 px there is one Menu, one Search and one Inbox;
// - Home shows one Next step per installed standard and one test-mode banner.
// Second round (owner decisions 15 Nov 2026):
// - Create only for editors, admins and owners: viewers and auditors have no Create button, and Create and the New
//   sheet page refuse them with a way back to Home;
// - Getting started only until the first standard is installed; Home has no "New sheet" button;
// - the levels read Basic, Recommended and Everything (never Standard).
// SIMPLE_SHOTS=<dir> saves the screenshots of Home and of the menu as owner and as viewer.

const SHOTS = process.env.SIMPLE_SHOTS;

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  const phone = test.info().project.name === 'phone';
  const size = phone ? '390' : 'desktop';
  // the whole menu in view on a desktop, and the page loaded behind it
  if (!phone) await page.setViewportSize({ width: 1280, height: 960 });
  await expect(page.getByTestId('home-summary')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${name}-${size}.png`, fullPage: false });
}

/** The side menu: the rail on a desktop, the Menu sheet from the bottom bar on a phone. */
async function openMenu(page: Page): Promise<Locator> {
  if (test.info().project.name === 'phone') {
    await page
      .getByRole('navigation', { name: 'Bottom bar' })
      .getByRole('button', { name: 'Menu' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Menu' });
    await expect(sheet).toBeVisible();
    return sheet.getByRole('navigation', { name: 'Side menu' });
  }
  return page.getByRole('complementary', { name: 'Workspace' }).getByRole('navigation', {
    name: 'Side menu',
  });
}

const headings = (menu: Locator) => menu.getByRole('heading', { level: 2 });
const group = (menu: Locator, name: string) => menu.getByRole('region', { name, exact: true });

test.describe('the side menu by role', () => {
  // a fresh workspace of the seed (Maria owner, James editor, Vic viewer; the folder "Your sheets" with two sheets)
  let slug = '';
  test.beforeAll(({}, info) => {
    slug = seedWorkspace(info.project.name === 'phone' ? 'smmp' : 'smm');
  });

  test('an owner sees Work, Registers, Reports and Build with Workspace admin', async ({
    page,
  }) => {
    await signIn(page, 'maria@example.com', `/${slug}/home`);
    await page.goto(`/${slug}/home`);
    const menu = await openMenu(page);
    await expect(headings(menu)).toHaveText(['Work', 'Registers', 'Reports', 'Build']);
    await expect(group(menu, 'Work').getByRole('link')).toContainText(['Home', 'My work']);
    await expect(group(menu, 'Reports').getByRole('link')).toHaveText([
      'Dashboards',
      'Evidence library',
      'Audit outputs',
    ]);
    await expect(group(menu, 'Build').getByRole('link')).toHaveText([
      'Workflow',
      'Automations',
      'Design',
      'Workspace admin',
    ]);
    await expect(menu.getByText('Platform', { exact: true })).toHaveCount(0);
    await expect(menu.getByText('Insights', { exact: true })).toHaveCount(0);
    // one search: the menu has no filter box of its own
    await expect(menu.getByRole('searchbox')).toHaveCount(0);
    await expect(menu.getByTestId('create-button')).toBeVisible();
    await shot(page, 'menu-owner');
  });

  test('an editor sees Build without Workspace admin', async ({ page }) => {
    await signIn(page, 'james@example.com', `/${slug}/home`);
    await page.goto(`/${slug}/home`);
    const menu = await openMenu(page);
    await expect(headings(menu)).toHaveText(['Work', 'Registers', 'Reports', 'Build']);
    await expect(group(menu, 'Build').getByRole('link')).toHaveText([
      'Workflow',
      'Automations',
      'Design',
    ]);
    await expect(menu.getByRole('link', { name: 'Workspace admin' })).toHaveCount(0);
    // Create stays for editors (the same check as Build)
    await expect(menu.getByTestId('create-button')).toBeVisible();
  });

  test('a viewer sees no Build', async ({ page }) => {
    await signIn(page, 'vic@example.com', `/${slug}/home`);
    await page.goto(`/${slug}/home`);
    const menu = await openMenu(page);
    await expect(headings(menu)).toHaveText(['Work', 'Registers', 'Reports']);
    await expect(group(menu, 'Build')).toHaveCount(0);
    for (const name of ['Workflow', 'Automations', 'Design', 'Workspace admin'])
      await expect(menu.getByRole('link', { name, exact: true })).toHaveCount(0);
    // a viewer keeps the reports and the sheets
    await expect(group(menu, 'Reports').getByRole('link')).toHaveText([
      'Dashboards',
      'Evidence library',
      'Audit outputs',
    ]);
    await expect(group(menu, 'Registers').getByRole('link').first()).toBeVisible();
    // no Create button for a viewer, on the desktop menu or the phone menu (owner decision 15 Nov 2026)
    await expect(menu.getByRole('button', { name: /^Create/ })).toHaveCount(0);
    await expect(page.getByTestId('create-button')).toHaveCount(0);
    await shot(page, 'menu-viewer');
  });

  test('a viewer cannot reach Create: no shortcut, and the New sheet page leads back home', async ({
    page,
  }) => {
    await signIn(page, 'vic@example.com', `/${slug}/home`);
    await page.goto(`/${slug}/home`);
    await expect(page.getByTestId('home-summary')).toBeVisible();
    // Ctrl/Cmd+K opens nothing for a viewer
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog', { name: 'Create' })).toHaveCount(0);
    await expect(page.getByTestId('create-wizard')).toHaveCount(0);
    // the wizard's address refuses with a short message and a link back to Home
    await page.goto(`/${slug}/s/new`);
    await expect(page.getByText('Viewers cannot create sheets.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create sheet' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Back to Home' }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/home$`));
  });
});

test.describe('Home without a standard', () => {
  test('Getting started points an editor to Create; Home has no New sheet button', async ({
    page,
  }, info) => {
    const slug = seedWorkspace(info.project.name === 'phone' ? 'smep' : 'sme', { empty: true });
    await signIn(page, 'james@example.com', `/${slug}/home`);
    await page.goto(`/${slug}/home`);
    const main = page.getByRole('main');
    await expect(page.getByTestId('home-summary')).toBeVisible();
    // no "New sheet" on Home (owner decision 15 Nov 2026): Create and the "+" next to Registers start a sheet
    await expect(main.getByRole('button', { name: /New sheet/ })).toHaveCount(0);
    await expect(main.getByRole('link', { name: /New sheet/ })).toHaveCount(0);
    // no sheets yet: Getting started shows, its first step opens Create at the Sheet card
    await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
    const checklist = page.getByTestId('checklist');
    await expect(checklist).toContainText('Create a sheet');
    await checklist.getByRole('link', { name: 'Open Create' }).click();
    const create = page.getByRole('dialog', { name: 'Create' });
    await expect(create.getByRole('link', { name: /^Tracker/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(create).toBeHidden();
  });
});

test('the levels read Basic, Recommended and Everything, never Standard', async ({
  page,
}, info) => {
  const slug = seedWorkspace(info.project.name === 'phone' ? 'smlp' : 'sml');
  await signIn(page, 'maria@example.com', `/${slug}/home`);
  await page.goto(`/${slug}/settings?tab=packs`);
  const list = page.getByRole('list', { name: 'Available packs' });
  const core = list
    .getByRole('listitem')
    .filter({ has: page.getByText('Shared registers', { exact: true }) });
  await expect(core).toContainText('Basic or Recommended or Everything');
  await expect(list).not.toContainText(/Standard or|or Standard\b/);
  const gdpr = list.getByRole('listitem').filter({ hasText: 'GDPR privacy' });
  await expect(gdpr).toContainText('Recommended or Everything');
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    await gdpr.getByRole('button', { name: /^Preview GDPR privacy/ }).click();
    await expect(dialog).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  const levels = dialog.getByRole('group', { name: 'Choose a level' });
  await expect(levels.getByRole('radio', { name: 'Recommended', exact: true })).toBeChecked();
  await expect(levels.getByRole('radio', { name: 'Everything', exact: true })).toBeVisible();
  await expect(levels.getByRole('radio', { name: 'Standard', exact: true })).toHaveCount(0);
  await expect(dialog.getByTestId('installs-first')).toContainText(
    'Installs Shared registers 1.3.0 (Recommended) first.',
  );
});

test.describe('phone', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'phone layout'));

  test('one Menu, one Search and one Inbox at 390 px', async ({ page }) => {
    await signIn(page, 'vic@example.com', '/meridian/home');
    await page.goto('/meridian/home');
    const count = async (loc: Locator) => {
      let n = 0;
      for (const el of await loc.all()) if (await el.isVisible()) n += 1;
      return n;
    };
    await expect(page.getByTestId('inbox-button')).toBeVisible();
    expect(await count(page.getByRole('button', { name: /menu$/i }))).toBe(1);
    expect(
      await count(page.getByRole('combobox', { name: 'Search sheets, items and people' })),
    ).toBe(1);
    expect(await count(page.getByRole('button', { name: /^Search$/ }))).toBe(0);
    expect(await count(page.getByRole('button', { name: /^Inbox/ }))).toBe(1);
    expect(await count(page.getByRole('button', { name: 'Open menu' }))).toBe(0);
    const bar = page.getByRole('navigation', { name: 'Bottom bar' });
    for (const cell of await bar.locator('a, button').all()) {
      const box = (await cell.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});

/** The newest catalogue version of a pack, installed with the service role as the app would. */
function installNewest(slug: string, key: string, level?: string) {
  const version = localSql(
    `select version from packs where key = '${key}'
      order by string_to_array(version, '.')::int[] desc limit 1`,
  ).trim();
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
    { encoding: 'utf8', stdio: 'pipe', timeout: 120_000 },
  );
}

test('Home shows one Next step per standard and one test-mode banner', async ({ page }, info) => {
  test.setTimeout(300_000);
  const slug = seedWorkspace(info.project.name === 'phone' ? 'smhp' : 'smh', { empty: true });
  // the shared registers (no setup of their own), then two standards with a setup each
  await signIn(page, 'maria@example.com', `/${slug}/home`);
  await page.goto(`/${slug}/home`);
  // before any standard: the generic Getting started checklist (no sheets yet)
  await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
  await expect(page.getByTestId('checklist')).toBeVisible();

  installNewest(slug, 'core', 'full');
  installNewest(slug, 'gdpr');
  installNewest(slug, 'iso-27001');

  await page.goto(`/${slug}/home`);
  const cards = page.getByTestId('next-step-card');
  await expect(cards).toHaveCount(2);
  // in install order, by the standard's plain name (no "(add-on)")
  await expect(cards.nth(0).getByRole('heading', { level: 2 })).toHaveText(
    'Next step: GDPR privacy',
  );
  await expect(cards.nth(1).getByRole('heading', { level: 2 })).toHaveText(
    'Next step: ISO/IEC 27001:2022 ISMS',
  );
  for (const card of await cards.all()) {
    await expect(card).toContainText(/Step \d+ of \d+ · \d+% done/);
    await expect(card.getByRole('progressbar')).toBeVisible();
    await expect(card.getByRole('link', { name: /^See all \d+ steps$/ })).toBeVisible();
  }
  await expect(page.getByText('(add-on)')).toHaveCount(0);
  // GDPR at its first level, which reads Recommended (never Standard)
  await expect(cards.nth(0)).toContainText(/% done · Recommended/);
  await expect(cards.nth(0)).not.toContainText(/· Standard\b/);
  // a standard is installed: its Next step cards take over from Getting started (owner decision 15 Nov 2026)
  await expect(page.getByTestId('checklist')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Getting started' })).toHaveCount(0);
  // and Home has no "New sheet" button
  await expect(page.getByRole('main').getByRole('button', { name: /New sheet/ })).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('link', { name: /New sheet/ })).toHaveCount(0);

  const banner = page.getByTestId('test-mode-banner');
  await expect(banner).toHaveCount(1);
  await expect(banner.getByRole('heading')).toHaveText(/^\d+ automations are in test mode\.$/);
  await expect(banner.getByRole('link')).toHaveText(['Review and turn on']);
  if (info.project.name === 'phone')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  await shot(page, 'home');

  // dismissing a card hides that one only, in this browser
  await cards
    .nth(0)
    .getByRole('button', { name: 'Dismiss the next step for GDPR privacy' })
    .click();
  await expect(cards).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('next-step-card')).toHaveCount(1);

  // an auditor gets no first-run cards and no Getting started (owner decision 15 Nov 2026)
  localSql(
    `update memberships m set role = 'auditor', expires_at = now() + interval '30 days'
       from orgs o, auth.users u
      where m.org_id = o.id and o.slug = '${slug}' and m.user_id = u.id and u.email = 'vic@example.com'`,
  );
  const vic = await page.context().browser()!.newPage();
  await signIn(vic, 'vic@example.com', `/${slug}/home`);
  await vic.goto(`/${slug}/home`);
  await expect(vic.getByTestId('home-summary')).toBeVisible();
  await expect(vic.getByTestId('next-step-card')).toHaveCount(0);
  await expect(vic.getByTestId('checklist')).toHaveCount(0);
  await expect(vic.getByTestId('test-mode-banner')).toHaveCount(0);
  // no Create for an auditor either, and the New sheet page refuses them
  await expect(vic.getByTestId('create-button')).toHaveCount(0);
  await vic.goto(`/${slug}/s/new`);
  await expect(vic.getByText('Auditors cannot create sheets.')).toBeVisible();
  await expect(vic.getByRole('link', { name: 'Back to Home' })).toBeVisible();
  await vic.close();
});
