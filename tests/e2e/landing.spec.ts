import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { completeProfile, freshEmail, signIn } from './helpers';

// The public product site at `/` for signed-out visitors (owner decision, 16 Nov 2026). Signed-in people still go
// straight on to their workspace or onboarding.

const HERO = 'Run your management system in one shared spreadsheet';

test('signed out, / is the product site: hero, standards, no errors, nothing from other hosts', async ({
  page,
  baseURL,
}) => {
  const errors: string[] = [];
  const foreign: string[] = [];
  const origin = new URL(baseURL!).origin;
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== origin)
      foreign.push(req.url());
  });

  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle('Compliance OS by Klarert');
  await expect(page.getByRole('heading', { level: 1, name: HERO })).toBeVisible();
  await expect(page.getByRole('banner').getByText('by Klarert')).toBeVisible();
  for (const name of ['ISO/IEC 27001', 'ISO 9001', 'GDPR', 'NIS2', 'Corrective actions'])
    await expect(page.getByRole('listitem').filter({ hasText: name }).first()).toBeVisible();
  // one h1, then h2 sections
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 2, name: 'Built to be checked' })).toBeVisible();

  // indexed, with a canonical address and Open Graph tags
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    /^https:\/\/www\.klarert\.com\/?$/,
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index, follow/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    'Compliance OS by Klarert',
  );

  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
  expect(foreign).toEqual([]);
});

test('no serious or critical axe violations (WCAG 2.1 AA)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: HERO })).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bad = result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(' | ')}`);
  expect(bad).toEqual([]);
});

test('the skip link comes first and moves to the content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
  await page.keyboard.press('Tab');
  // the next stop is inside the content: the hero's first action
  await expect(
    page.getByRole('main').getByRole('link', { name: 'Create account' }).first(),
  ).toBeFocused();
});

test('Sign in and Create account lead to the sign-in page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('main').getByRole('link', { name: 'Sign in' }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Sign in' })).toBeVisible();

  await page.goto('/');
  await page.getByRole('banner').getByRole('link', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/login\?mode=signup$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Create an account' })).toBeVisible();
});

test('at 390 px the page does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: HERO })).toBeVisible();
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
});

test('signed in, / still goes on to onboarding, then to the workspace', async ({ page }) => {
  const slug = `landing-${Date.now().toString(36)}`;
  await signIn(page, freshEmail('landing'));
  await completeProfile(page, 'Ada Lovelace');
  await expect(page.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();

  // a profile but no workspace yet: onboarding
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel('Workspace name').fill('Landing check');
  await page.getByLabel('Web address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/home$`));

  // a member: straight on to the workspace, never the product site
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/${slug}/home$`));
  await expect(
    page.getByRole('heading', { level: 1, name: /Run your management system/ }),
  ).toHaveCount(0);
});
