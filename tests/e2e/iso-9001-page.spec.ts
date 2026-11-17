import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { FAQ, PROCESSES } from '@/components/landing/iso-9001-content';
import { readStandardPage } from '@/lib/site/standard';

// /standards/iso-9001: the product page for ISO 9001 buyers (static, indexed, in the sitemap). Its facts come from the
// catalogue; its screenshots from the example workspace (public/site/screens).

const PATH = '/standards/iso-9001';

test('headings, the catalogue’s facts, the CTA carries the standard, nothing from other hosts', async ({
  page,
  baseURL,
}) => {
  const foreign: string[] = [];
  const errors: string[] = [];
  const origin = new URL(baseURL!).origin;
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== origin)
      foreign.push(req.url());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  const res = await page.goto(PATH);
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle('ISO 9001 · Compliance OS by Klarert');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('ISO 9001');
  for (const h of [
    'What you get when you install ISO 9001',
    'Every clause as an item you can answer',
    'One record counts for every standard',
    'Moving from ISO 9001:2015 to the 2026 edition',
    'Give your auditor something they can check',
    'Questions before you start',
  ])
    await expect(page.getByRole('heading', { level: 2, name: h })).toBeVisible();
  for (const p of PROCESSES)
    await expect(page.getByRole('heading', { level: 3, name: p.title, exact: true })).toBeVisible();

  // what it installs and the edition status, as the catalogue says them
  const facts = readStandardPage('iso-9001');
  const main = page.getByRole('main');
  for (const s of facts.install.sheets) await expect(main.getByText(s.name).first()).toBeVisible();
  await expect(main).toContainText(facts.editions[1]!.badge!);
  await expect(main).toContainText(facts.editions[1]!.note!);

  // every CTA starts sign-up with the standard
  const ctas = main.getByRole('link', { name: 'Start with ISO 9001' });
  expect(await ctas.count()).toBeGreaterThanOrEqual(2);
  for (const href of await ctas.evaluateAll((els) => els.map((e) => e.getAttribute('href'))))
    expect(href).toBe('/login?mode=signup&standard=iso-9001');

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://www.klarert.com${PATH}`,
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index, follow/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    /^https:\/\/www\.klarert\.com\/opengraph-image/,
  );

  // every screenshot loads, has its size and its caption
  const images = main.getByRole('img');
  const n = await images.count();
  expect(n).toBeGreaterThanOrEqual(PROCESSES.length + 5);
  for (let i = 0; i < n; i += 1) {
    const img = images.nth(i);
    await img.scrollIntoViewIfNeeded();
    await expect(img).toHaveAttribute('width', /\d+/);
    await expect(img).toHaveAttribute('height', /\d+/);
    await expect
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  }
  await expect(main.getByText('Example workspace: Meridian Components Ltd')).toHaveCount(n);

  // the questions open
  await main.getByText(FAQ[0]!.q).click();
  await expect(main.getByText(FAQ[0]!.a)).toBeVisible();

  await page.waitForLoadState('networkidle');
  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});

test('no serious axe violations, no sideways scroll, linked from / and /frameworks', async ({
  page,
}) => {
  await page.goto(PATH);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    result.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((x) => x.html.slice(0, 120)).join(' | ')}`),
  ).toEqual([]);

  await page.goto('/');
  await page.getByRole('main').getByRole('link', { name: 'ISO 9001', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${PATH}$`));

  await page.goto('/frameworks');
  await page
    .getByRole('article', { name: 'ISO 9001 quality', exact: true })
    .getByRole('link', { name: 'More about ISO 9001 quality' })
    .click();
  await expect(page).toHaveURL(new RegExp(`${PATH}$`));
});
