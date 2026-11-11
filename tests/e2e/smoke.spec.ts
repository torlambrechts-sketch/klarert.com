import { expect, test } from '@playwright/test';

test('signed-out visitors land on sign-in without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Compliance OS' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('fonts are self-hosted, no Google Fonts requests', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (req) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(req.url())) external.push(req.url());
  });
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  expect(external).toEqual([]);
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toMatch(/jakarta/i);
});
