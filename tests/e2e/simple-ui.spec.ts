import { execFileSync } from 'node:child_process';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { localSql, seedWorkspace } from './first-sheet-helpers';
import { signIn } from './helpers';

// The Simple step (owner decisions 15 Nov 2026; board review UX-1..UX-15, A1..A13):
// - the side menu has four groups, Work, Registers, Reports and Build; Build only for editors and up, Workspace admin
//   only for admins and owners; viewers see no Build and no "Platform"; there is no menu filter (one search);
// - at 390 px there is one Menu, one Search and one Inbox;
// - Home shows one Next step per installed standard and one test-mode banner.
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
    await shot(page, 'menu-viewer');
  });
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
  installNewest(slug, 'core', 'full');
  installNewest(slug, 'gdpr');
  installNewest(slug, 'iso-27001');

  await signIn(page, 'maria@example.com', `/${slug}/home`);
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
  await vic.close();
});
