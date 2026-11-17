// Screenshots of the example workspace for the public site (docs/17): signs in as the demo login and saves crisp
// WebP files to public/site/screens (1440 px wide at 2x, plus 390 px phone shots), and their sizes to
// src/lib/site/screens.json so the site's images never shift. Everything in them is fictional: nothing is hidden.
// Run: pnpm seed:demo, start the app, then PORT=<port> pnpm screenshots. Not part of CI (tests/e2e is).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { localSql } from '../e2e/first-sheet-helpers';

const ROOT = join(__dirname, '..', '..');
const OUT = join(ROOT, 'public', 'site', 'screens');
const MANIFEST = join(ROOT, 'src', 'lib', 'site', 'screens.json');
const COPY_TO = process.env.SCREENS_COPY_TO;
const SLUG = process.env.DEMO_SLUG ?? 'meridian-demo';
const EMAIL = 'demo@meridian.example';
const PASSWORD = process.env.DEMO_PASSWORD || 'meridian-demo-local';

// sharp comes with Next.js (image optimisation); load it from there rather than adding a dependency
type Sharp = (input: Buffer) => {
  webp(o: { quality: number; effort: number }): {
    toBuffer(o: {
      resolveWithObject: true;
    }): Promise<{ data: Buffer; info: { width: number; height: number } }>;
  };
};
const sharp = createRequire(require.resolve('next/package.json'))('sharp') as Sharp;

type Entry = { file: string; width: number; height: number };
const manifest: Record<string, Entry> = existsSync(MANIFEST)
  ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, Entry>)
  : {};

async function shoot(
  page: Page,
  name: string,
  clip?: { x: number; y: number; width: number; height: number },
) {
  await page.waitForLoadState('networkidle');
  // no blinking caret, no transitions in the middle of a frame
  await page.addStyleTag({
    content:
      '*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }',
  });
  await page.waitForTimeout(700);
  const png = await page.screenshot({ clip, animations: 'disabled' });
  const file = `${name}.webp`;
  const out = await sharp(png)
    .webp({ quality: 80, effort: 6 })
    .toBuffer({ resolveWithObject: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, file), out.data);
  manifest[name] = { file, width: out.info.width, height: out.info.height };
  writeFileSync(MANIFEST, `${JSON.stringify(sortKeys(manifest), null, 2)}\n`);
  if (COPY_TO) {
    mkdirSync(COPY_TO, { recursive: true });
    copyFileSync(join(OUT, file), join(COPY_TO, file));
  }
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

const sql = (q: string) => localSql(q).trim();
const orgId = () => sql(`select id from orgs where slug = '${SLUG}'`);
const sheet = (name: string) =>
  sql(
    `select id from sheets where org_id = '${orgId()}' and name = '${name.replace(/'/g, "''")}' and archived_at is null and parent_sheet_id is null limit 1`,
  );
const library = (key: string, version: string) =>
  sql(
    `select id from sheets where org_id = '${orgId()}' and is_library and settings->'framework'->>'key' = '${key}' and settings->'framework'->>'version' = '${version}'`,
  );
const displayId = (sheetId: string, nameLike: string) =>
  sql(
    `select display_id from items where sheet_id = '${sheetId}' and name like '${nameLike}' limit 1`,
  );
const ownKey = () =>
  sql(
    `select settings->'framework'->>'key' from sheets where org_id = '${orgId()}' and is_library and settings->'framework'->>'key' like 'w%-%' limit 1`,
  );

async function signIn(page: Page) {
  await page.goto(`/login?next=${encodeURIComponent(`/${SLUG}/home`)}`);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(new RegExp(`/${SLUG}/home`));
}

/** A sheet in its Table, optionally with one item open in the panel. */
async function openSheet(page: Page, name: string, itemLike?: string, tab?: RegExp) {
  const id = sheet(name);
  expect(id, name).not.toBe('');
  const item = itemLike ? displayId(id, itemLike) : '';
  await page.goto(`/${SLUG}/s/${id}${item ? `?item=${item}` : ''}`);
  await expect(page.getByRole('main')).toBeVisible();
  if (item) {
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    if (tab) await dialog.getByRole('tab', { name: tab }).click();
  }
}

test.describe.configure({ mode: 'serial' });

test('the example workspace, desktop', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await signIn(page);

  await page.goto(`/${SLUG}/home`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shoot(page, 'home-next-steps');

  await openSheet(page, 'Risk register');
  await shoot(page, 'risk-register');

  await page.goto(`/${SLUG}/s/${library('iso-9001', '2015')}`);
  await expect(page.getByRole('main')).toBeVisible();
  await shoot(page, 'iso-9001-library');

  await page.goto(`/${SLUG}/audit/soa/${library('iso-27001', '2022')}`);
  await expect(page.getByRole('main')).toBeVisible();
  await shoot(page, 'soa');

  // a nonconformity with its history, and the audit trail verified
  await openSheet(page, 'Nonconformities and CAPA', 'NC-2026-019%', /^Activity log/);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Verify audit trail' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Audit trail intact' })).toBeVisible();
  await shoot(page, 'capa-item-panel');

  await openSheet(page, 'Internal audits');
  await shoot(page, 'internal-audits');

  await openSheet(page, 'Management reviews', 'Management review %20%');
  await shoot(page, 'management-review');

  await openSheet(page, 'External providers');
  await shoot(page, 'supplier-evaluation');

  await openSheet(page, 'Measuring equipment');
  await shoot(page, 'calibration');

  await openSheet(page, 'Documents and policies', 'PR-008%');
  await shoot(page, 'document-approvals');

  await openSheet(page, 'Customer feedback and complaints');
  await shoot(page, 'complaints');

  await openSheet(page, 'Objectives and KPIs', 'On-time delivery%', /^Activity log/);
  await shoot(page, 'objectives');

  await page.goto(`/${SLUG}/dashboards`);
  await expect(page.getByRole('main')).toBeVisible();
  await shoot(page, 'dashboards');

  await page.goto(`/${SLUG}/s/${sheet('Nonconformities and CAPA')}?view=insights`);
  await expect(page.getByRole('main')).toBeVisible();
  await shoot(page, 'insights');

  await page.goto(`/${SLUG}/design?show=map`);
  await expect(page.getByRole('main')).toBeVisible();
  await shoot(page, 'design-map');

  await page.goto(`/${SLUG}/automations?tab=runs`);
  await expect(page.getByRole('main')).toBeVisible();
  await shoot(page, 'automation-run-log');

  await page.goto(`/${SLUG}/automations`);
  await expect(page.getByRole('main')).toBeVisible();
  await shoot(page, 'automations');

  await page.goto(`/${SLUG}/audit`);
  await expect(page.getByRole('main')).toBeVisible();
  await shoot(page, 'audit-pack');

  await page.goto(`/${SLUG}/settings?tab=frameworks`);
  const adopted = page.getByRole('list', { name: 'Adopted frameworks' });
  await expect(adopted).toBeVisible();
  await shoot(page, 'frameworks-coverage');

  const yours = page.getByRole('heading', { name: 'Your frameworks' });
  await yours.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -80));
  await shoot(page, 'frameworks-yours');

  await page.goto(`/${SLUG}/settings?tab=frameworks`);
  await expect(adopted).toBeVisible();
  await adopted.getByRole('button', { name: 'Move ISO 9001:2015 to ISO 9001:2026' }).click();
  const move = page.getByRole('dialog');
  await expect(move.getByRole('list', { name: 'What moving does' })).toBeVisible({
    timeout: 60_000,
  });
  await shoot(page, 'edition-move-preview');
  await move.getByRole('button', { name: 'Cancel' }).click();

  const own = library(ownKey(), '1');
  await page.goto(`/${SLUG}/s/${own}?item=${displayId(own, 'Calibrated gauges')}`);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page
    .getByRole('dialog')
    .getByText('Your mapping')
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await shoot(page, 'own-framework');
});

// Whole-page shots of the ISO 9001 page for review (PAGE_SHOTS_TO=<dir>), never written to the repository.
test('the ISO 9001 page, whole', async ({ browser, baseURL }, info) => {
  const dir = process.env.PAGE_SHOTS_TO;
  test.skip(!dir, 'set PAGE_SHOTS_TO to a folder');
  // 1x: a whole long page at 2x would pass the browser's largest image
  const context = await browser.newContext({
    baseURL,
    viewport: { width: info.project.name === 'phone' ? 390 : 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto('/standards/iso-9001');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // let every lazy image load before the shot
  for (let y = 0; y < (await page.evaluate(() => document.body.scrollHeight)); y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForLoadState('networkidle');
  mkdirSync(dir!, { recursive: true });
  await page.screenshot({
    path: join(dir!, `iso-9001-page-${info.project.name === 'phone' ? 390 : 1440}.png`),
    fullPage: true,
  });
});

test('the example workspace, phone', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone');
  await signIn(page);
  await page.goto(`/${SLUG}/home`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shoot(page, 'home-phone');
  await openSheet(page, 'Nonconformities and CAPA', 'NC-2026-019%');
  await shoot(page, 'capa-phone');
  await openSheet(page, 'Measuring equipment');
  await shoot(page, 'calibration-phone');
});
