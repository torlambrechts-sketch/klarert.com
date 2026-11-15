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
  expect(family).toMatch(/geist/i);
});

test('an unknown address shows the app’s own 404 page with a way back', async ({ page }) => {
  const res = await page.goto('/auth/no-such-page');
  expect(res?.status()).toBe(404);
  await expect(page).toHaveTitle('Page not found · Compliance OS');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to your workspace' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('every response says who may frame it, how to read its type and what to send as a referrer', async ({
  request,
}) => {
  for (const path of ['/login', '/auth/no-such-page']) {
    const h = (await request.get(path, { maxRedirects: 0 })).headers();
    expect(h['content-security-policy'], path).toContain("frame-ancestors 'self'");
    expect(h['x-frame-options'], path).toBe('SAMEORIGIN');
    expect(h['x-content-type-options'], path).toBe('nosniff');
    expect(h['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
    expect(h['x-powered-by'], path).toBeUndefined();
    // SA-7: no camera, microphone, location …; HTTPS only for two years
    expect(h['permissions-policy'], path).toContain('camera=()');
    expect(h['permissions-policy'], path).toContain('microphone=()');
    expect(h['permissions-policy'], path).toContain('geolocation=()');
    expect(h['strict-transport-security'], path).toBe('max-age=63072000; includeSubDomains');
  }
  // a public form's link is its key: never sent as a referrer (docs/05 §3.3)
  const form = await request.get('/f/no-such-token', { maxRedirects: 0 });
  expect(form.headers()['referrer-policy']).toBe('no-referrer');
});
