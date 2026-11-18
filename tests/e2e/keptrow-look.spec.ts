import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

// The Keptrow look (docs/18 §4–§7, T1): the shell's landmarks and collapse, a menu by keyboard, and nothing that
// scrolls the page sideways at 390 px on the pages of docs/18 §6. Uses the seed: maria@example.com owns /meridian.

test.beforeEach(({}, info) =>
  test.skip(info.project.name !== 'chromium', 'sets its own viewports'),
);

const PAGES = [
  'home',
  'my-work',
  'dashboards',
  'evidence',
  'audit',
  'workflow',
  'automations',
  'design',
  'settings?tab=frameworks',
];

async function firstSheet(page: Page): Promise<string> {
  const link = page
    .getByRole('navigation', { name: 'Side menu' })
    .locator('[data-testid^="rail-sheet-"]')
    .first();
  return (await link.getAttribute('href'))!;
}

test('the shell: top bar, rail, side panel and page; the panel collapses and stays collapsed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'maria@example.com');
  await expect(page).toHaveURL(/\/meridian\/home$/);

  await expect(page.getByRole('banner')).toBeVisible();
  const rail = page.getByRole('navigation', { name: 'Rail' });
  await expect(rail.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  await expect(rail.getByRole('link', { name: 'Workspace admin' })).toBeVisible();
  const side = page.getByRole('navigation', { name: 'Side menu' });
  await expect(side).toBeVisible();
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();

  await rail.getByRole('button', { name: 'Collapse side menu' }).click();
  await expect(side).toBeHidden();
  await expect(rail).toBeVisible();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Side menu' })).toBeHidden();
  await page
    .getByRole('navigation', { name: 'Rail' })
    .getByRole('button', { name: 'Expand side menu' })
    .click();
  await expect(page.getByRole('navigation', { name: 'Side menu' })).toBeVisible();
});

test('a menu by keyboard: Enter opens on the first item, arrows move, Escape returns focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'maria@example.com');
  await page.goto(await firstSheet(page));
  const trigger = page.getByTestId('more-menu');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('at 390 px no page scrolls sideways', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'maria@example.com');
  const sheet = await firstSheet(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [...PAGES.map((p) => `/meridian/${p}`), sheet]) {
    // a page that is still settling can abort the next navigation: ask again once
    await page.goto(path).catch(() => page.goto(path));
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Bottom bar' })).toBeVisible();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(wide, path).toBeLessThanOrEqual(390);
  }
});
