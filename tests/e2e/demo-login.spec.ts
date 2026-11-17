// The sign-in page's "Try the demo workspace" link and the read-only demo login (docs/17 The live demo, owner decision
// 17 Nov 2026). The link is off unless NEXT_PUBLIC_DEMO_EMAIL is set (src/lib/demo-login.ts reads it when the page
// renders), so this starts a second server from the same production build with the variables set. The demo login is
// a viewer: here a fresh account, a viewer in a seeded workspace, stands in for demo@meridian.example (CI does not
// build the demo workspace). It signs in with the details the page shows, cannot change an item and has no
// Workspace admin. Runs at 390 px too (the phone project).
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { localSql, seedWorkspace } from './first-sheet-helpers';
import { completeProfile, freshEmail } from './helpers';

const PORT = Number(process.env.PORT ?? 3000);
const DEMO_PORT = PORT + 17;
const DEMO_URL = `http://localhost:${DEMO_PORT}`;

test.describe.configure({ mode: 'serial' });

let server: ChildProcess | null = null;
let slug = '';
const viewer = { email: '', password: '' };

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  viewer.email = freshEmail('demo-viewer');
  viewer.password = `Demo viewer ${Date.now()}`;

  // the viewer: an account with a password, a viewer in a seeded workspace
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/login?mode=signup');
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  await page.getByLabel('Email').fill(viewer.email);
  await page.getByLabel('Password').fill(viewer.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await completeProfile(page, 'Sam Carter');
  await expect(page.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();
  await ctx.close();
  slug = seedWorkspace('demo-viewer');
  localSql(
    `insert into memberships (org_id, user_id, role)
     select o.id, u.id, 'viewer' from orgs o, auth.users u
      where o.slug = '${slug}' and u.email = '${viewer.email}'`,
  );

  // a second server from the same build, with the demo variables set
  if (!existsSync('.next/BUILD_ID')) return;
  server = spawn('pnpm', ['exec', 'next', 'start', '--port', String(DEMO_PORT)], {
    env: {
      ...process.env,
      NEXT_PUBLIC_DEMO_EMAIL: viewer.email,
      NEXT_PUBLIC_DEMO_PASSWORD: viewer.password,
    },
    stdio: 'ignore',
    detached: true,
  });
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${DEMO_URL}/login`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, message: 'the demo server starts' },
    )
    .toBe(200);
});

test.afterAll(() => {
  if (server?.pid) {
    try {
      process.kill(-server.pid);
    } catch {
      server.kill();
    }
  }
});

test('the demo link is off by default', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try the demo workspace' })).toHaveCount(0);
  await page.goto('/login?demo=1');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Demo workspace' })).toHaveCount(0);
  await expect(page.getByLabel('Email')).toHaveValue('');
});

test('with the demo set, the link shows the details and the viewer signs in, read only', async ({
  page,
}) => {
  test.skip(!server, 'needs a production build (pnpm build) to start the second server');
  await page.goto(`${DEMO_URL}/login`);
  await page.getByRole('link', { name: 'Try the demo workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Demo workspace' })).toBeVisible();
  await expect(page.getByTestId('demo-email')).toHaveText(viewer.email);
  await expect(page.getByTestId('demo-password')).toHaveText(viewer.password);
  await expect(page.getByRole('link', { name: 'Try the demo workspace' })).toHaveCount(0);
  // nothing runs off the side at 390 px
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);

  // the details are filled in: sign in
  await expect(page.getByLabel('Email')).toHaveValue(viewer.email);
  await expect(page.getByLabel('Password')).toHaveValue(viewer.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname !== '/login');

  // an item opens read only
  const [sheetId, displayId] = localSql(
    `select s.id || '|' || i.display_id from items i join sheets s on s.id = i.sheet_id
       join orgs o on o.id = s.org_id
      where o.slug = '${slug}' and i.archived_at is null and s.parent_sheet_id is null
      order by s.position, i.position limit 1`,
  )
    .trim()
    .split('|');
  await page.goto(`${DEMO_URL}/${slug}/s/${sheetId}?item=${displayId}`);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText('You can view this item. Ask an editor or admin to change it.'),
  ).toBeVisible();

  // no Workspace admin: not in the menus, and the page says so
  await page.goto(`${DEMO_URL}/${slug}/home`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Workspace admin' })).toHaveCount(0);
  await page.goto(`${DEMO_URL}/${slug}/settings`);
  await expect(
    page.getByText('Only owners and admins can change workspace settings.'),
  ).toBeVisible();
});
