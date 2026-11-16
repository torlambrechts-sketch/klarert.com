import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PLATFORM_FEATURES } from '@/components/landing/content';
import { readSiteCatalogue } from '@/lib/site/catalogue';
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
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', NOINDEX);

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
  // app pages are kept out of search engines (the root layout's default)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', NOINDEX);
});

// ── the public pages around the product site (owner decisions, 16 Nov 2026) ──

const NOINDEX = /^noindex, nofollow/;
const LEGAL = [
  { path: '/privacy', title: 'Privacy notice', link: 'Privacy notice', signUp: 'privacy notice' },
  { path: '/terms', title: 'Terms', link: 'Terms', signUp: 'terms' },
] as const;

for (const legal of LEGAL)
  test(`${legal.path} is a draft, indexed, reachable from the footer and the sign-up form`, async ({
    page,
  }) => {
    await page.goto('/');
    await page
      .getByRole('contentinfo')
      .getByRole('link', { name: legal.link, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${legal.path}$`));
    await expect(page.getByRole('heading', { level: 1, name: legal.title })).toBeVisible();
    const draft = page.getByRole('note', { name: 'Draft' });
    await expect(draft).toBeVisible();
    await expect(draft).toContainText('Draft, to be reviewed.');
    // placeholders are marked, never filled with a guess
    await expect(page.locator('mark[data-placeholder]').first()).toContainText(/^\[.+\]$/);
    // the tags as served (a client-side visit can stream a second copy of the metadata into the body)
    await page.reload();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index, follow/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `https://www.klarert.com${legal.path}`,
    );
    await expect(
      page.getByRole('contentinfo').getByRole('link', { name: 'support@klarert.com' }),
    ).toHaveAttribute('href', 'mailto:support@klarert.com');
    // the two pages link to each other
    const other = LEGAL.find((l) => l.path !== legal.path)!;
    await expect(
      page.getByRole('article').getByRole('link', { name: other.signUp, exact: true }).last(),
    ).toHaveAttribute('href', other.path);

    // the sign-up form links here; signing in does not carry the line
    await page.goto('/login?mode=signup');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', NOINDEX);
    await expect(page.getByText('By creating an account you agree to the')).toBeVisible();
    await page.getByRole('link', { name: legal.signUp, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${legal.path}$`));
    await page.goto('/login');
    await expect(page.getByText('By creating an account you agree to the')).toHaveCount(0);
  });

test('the privacy notice: sections in order, the facts, no sideways scroll, no axe violations', async ({
  page,
}) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'Who we are',
    'What we collect',
    'Why we use it',
    'Where it is stored',
    'Subprocessors',
    'How long it is kept',
    'Your rights',
    'Contact',
  ]);
  for (const fact of [
    'Frankfurt',
    'fra1',
    'Brevo',
    'Former member',
    'hash-chained',
    'no analytics',
  ])
    await expect(page.getByRole('article')).toContainText(fact);
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bad = result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(' | ')}`);
  expect(bad).toEqual([]);
});

test('robots.txt and sitemap.xml list only the public pages', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  const lines = (await robots.text()).split('\n').map((l) => l.trim());
  const values = (key: string) =>
    lines.filter((l) => l.startsWith(`${key}:`)).map((l) => l.slice(key.length + 1).trim());
  const assets = ['/_next/static/', '/favicon.ico', '/opengraph-image'];
  expect(values('Allow').filter((v) => !assets.includes(v))).toEqual([
    '/$',
    '/privacy$',
    '/terms$',
  ]);
  expect(values('Disallow')).toEqual(['/']);
  expect(values('Sitemap')).toEqual(['https://www.klarert.com/sitemap.xml']);

  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  const locs = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs).toEqual([
    'https://www.klarert.com',
    'https://www.klarert.com/platform',
    'https://www.klarert.com/frameworks',
    'https://www.klarert.com/privacy',
    'https://www.klarert.com/terms',
  ]);
});

test('/opengraph-image is a 1200×630 PNG, named by the public pages', async ({ page, request }) => {
  const res = await request.get('/opengraph-image');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/png');
  const png = await res.body();
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);

  for (const path of ['/', '/platform', '/frameworks', '/privacy', '/terms']) {
    await page.goto(path);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      /^https:\/\/www\.klarert\.com\/opengraph-image/,
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      'summary_large_image',
    );
  }
});

test('the sign-in pages are noindex, / is not', async ({ page }) => {
  for (const path of ['/login', '/login?mode=signup', '/login?mode=link']) {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', NOINDEX);
  }
  await page.goto('/');
  await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute('content', /noindex/);
});

test('the public pages and the sign-up form ask nothing of other hosts', async ({
  page,
  baseURL,
}) => {
  const foreign: string[] = [];
  const origin = new URL(baseURL!).origin;
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== origin)
      foreign.push(req.url());
  });
  for (const path of [
    '/',
    '/platform',
    '/frameworks',
    '/privacy',
    '/terms',
    '/login?mode=signup',
    '/login',
  ]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect(foreign).toEqual([]);
});

// ── /platform and /frameworks (the product pages around the landing page) ──

const axeBad = async (page: Page) => {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(' | ')}`);
};

const noSidewaysScroll = async (page: Page) => {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
};

const PRODUCT_PAGES = [
  { path: '/platform', nav: 'Platform', title: 'Platform · Compliance OS by Klarert' },
  { path: '/frameworks', nav: 'Frameworks', title: 'Frameworks · Compliance OS by Klarert' },
] as const;

for (const p of PRODUCT_PAGES)
  test(`${p.path}: from the header, one h1, the active nav item, indexed, axe, 390 px`, async ({
    page,
  }) => {
    await page.goto('/');
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 768) {
      // phones: the header's menu
      await page.getByRole('banner').locator('summary').click();
    }
    await page.getByRole('banner').getByRole('link', { name: p.nav, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${p.path}$`));
    await expect(page).toHaveTitle(p.title);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    if (viewport && viewport.width >= 768)
      await expect(
        page.getByRole('banner').getByRole('link', { name: p.nav, exact: true }),
      ).toHaveAttribute('aria-current', 'page');

    await page.reload();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index, follow/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `https://www.klarert.com${p.path}`,
    );
    await noSidewaysScroll(page);
    expect(await axeBad(page)).toEqual([]);
    await expect(
      page.getByRole('contentinfo').getByRole('link', { name: 'support@klarert.com' }),
    ).toHaveAttribute('href', 'mailto:support@klarert.com');
  });

test('/platform has a section for every part of the product, linked from the landing page', async ({
  page,
}) => {
  await page.goto('/platform');
  await expect(page.getByRole('heading', { level: 2 })).toContainText(
    PLATFORM_FEATURES.map((f) => f.title).concat(['Start with your first sheet']),
  );
  await page.goto('/');
  await page
    .getByRole('main')
    .getByRole('link', { name: /^More about this\s+\(An activity log you can verify\)$/ })
    .click();
  await expect(page).toHaveURL(/\/platform#activity$/);
  await expect(
    page.getByRole('heading', { level: 2, name: /activity log you can verify/ }),
  ).toBeInViewport();
});

test('/frameworks lists every set and every framework edition of the catalogue', async ({
  page,
}) => {
  const site = readSiteCatalogue();
  await page.goto('/frameworks');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Frameworks and ready-made sets' }),
  ).toBeVisible();
  for (const g of site.groups)
    await expect(page.getByRole('heading', { level: 2, name: g.title })).toBeVisible();
  const sets = [site.foundation!, ...site.groups.flatMap((g) => g.sets)];
  expect(sets.length).toBeGreaterThanOrEqual(8);
  for (const s of sets) {
    const card = page.getByRole('article', { name: s.title, exact: true });
    await expect(card).toBeVisible();
    for (const sheet of s.sheets) await expect(card.getByText(sheet.name).first()).toBeVisible();
    await expect(
      card.getByRole('link', { name: `Create account to set up ${s.title}` }),
    ).toHaveAttribute('href', '/login?mode=signup');
  }
  for (const l of site.libraries)
    await expect(page.getByRole('heading', { level: 3, name: l.title, exact: true })).toBeVisible();
  // the plain words, never the manifest's
  await expect(page.getByRole('main')).not.toContainText('(add-on)');
  await expect(page.getByRole('main')).not.toContainText('Core registers');
  await expect(page.getByRole('main')).toContainText('Withdrawn · replaced by ISO 9001:2026');
});

test('the sign-in pages: the new frame keeps the form, the terms line on sign-up, no axe violations', async ({
  page,
}) => {
  await page.goto('/login?mode=signup');
  await expect(page.getByRole('heading', { level: 1, name: 'Compliance OS' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Create an account' })).toBeVisible();
  await expect(page.getByText('By creating an account you agree to the')).toBeVisible();
  await expect(
    page.getByRole('banner').getByRole('link', { name: /Compliance OS/ }),
  ).toHaveAttribute('href', '/');
  await noSidewaysScroll(page);
  expect(await axeBad(page)).toEqual([]);
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 2, name: 'Sign in' })).toBeVisible();
  await noSidewaysScroll(page);
  expect(await axeBad(page)).toEqual([]);
});
