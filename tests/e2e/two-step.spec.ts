import { expect, test, type Browser, type Page } from '@playwright/test';
import { completeProfile, freshEmail } from './helpers';
import { freshCode } from './totp';

// Two-step sign-in (SA-6, docs/05 §1 Your account and Two-step sign-in, docs/09 §8): setting up an authenticator
// app, the code at sign-in, removing it, and the workspace setting "Require two-step sign-in". Every test makes its
// own accounts and workspace; the codes come from tests/e2e/totp.ts like an authenticator app's.

test.describe.configure({ mode: 'default' });

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A new password account with a profile and, when a slug is given, its own workspace. */
async function newAccount(page: Page, name: string, slug?: string) {
  const email = freshEmail(name.split(' ')[0]!.toLowerCase());
  const password = `Correct horse ${unique()}`;
  await page.goto('/login?mode=signup');
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await completeProfile(page, name);
  if (slug) {
    await page.getByLabel('Workspace name').fill(`Two-step ${slug}`);
    await page.getByLabel('Web address').fill(slug);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/home$`));
  }
  return { email, password };
}

async function signInWithPassword(page: Page, email: string, password: string, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Set up an authenticator app on Your account, with the keyboard. Returns its key. */
async function setUpApp(page: Page, used: Set<number>) {
  const start = page.getByRole('button', {
    name: /^(Set up two-step sign-in|Add another authenticator app)$/,
  });
  await start.focus();
  await page.keyboard.press('Enter');
  const setup = page.getByTestId('two-step-setup');
  await expect(
    setup.getByRole('img', { name: 'QR code to scan with your authenticator app' }),
  ).toBeVisible();
  const secret = (await setup.getByTestId('two-step-secret').getAttribute('data-secret'))!;
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  // the code field has focus: type the code and press Enter
  await expect(setup.getByLabel('3. Enter the 6-digit code the app shows')).toBeFocused();
  await page.keyboard.type(await freshCode(secret, used));
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('two-step-status')).toHaveText('On');
  return secret;
}

async function noSideScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(width);
}

test('set up an authenticator app, sign in with its code, then remove it', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const used = new Set<number>();
  const slug = `ts-${unique()}`;
  const { email, password } = await newAccount(page, 'Tess Step', slug);

  // Your account, from the account menu
  await page.getByRole('button', { name: /account menu for Tess Step/ }).click();
  await page.getByRole('menuitem', { name: 'Your account' }).click();
  await expect(page).toHaveURL(new RegExp(`/account\\?next=%2F${slug}$`));
  await expect(page.getByRole('heading', { name: 'Your account', level: 1 })).toBeVisible();
  await expect(page.getByTestId('two-step-status')).toHaveText('Off');
  await expect(page.getByTestId('signed-in-since')).toHaveText(
    /^Signed in since \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}\.$/,
  );
  if (info.project.name === 'phone') await noSideScroll(page);

  // a wrong first code is refused in words, next to the field
  await page.getByRole('button', { name: 'Set up two-step sign-in' }).click();
  const setup = page.getByTestId('two-step-setup');
  await setup.getByLabel('3. Enter the 6-digit code the app shows').fill('000000');
  await setup.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
  await expect(setup.getByRole('alert')).toHaveText(/That code is not right|6-digit code/);
  await setup.getByRole('button', { name: 'Cancel' }).click();

  const secret = await setUpApp(page, used);
  await expect(page.getByText('Two-step sign-in is on.')).toBeVisible();
  await expect(page.getByTestId('two-step-recovery')).toContainText('If you lose your phone');
  await expect(page.getByTestId('signed-in-since')).toContainText('with two-step sign-in');
  if (info.project.name === 'phone') await noSideScroll(page);

  // sign out, then sign in: the password alone does not open anything
  await page.context().clearCookies();
  await signInWithPassword(page, email, password, `/${slug}/home`);
  await expect(page).toHaveURL(/\/login\/two-step\?next=%2F.+%2Fhome$/);
  await expect(page.getByRole('heading', { name: 'Two-step sign-in' })).toBeVisible();
  if (info.project.name === 'phone') await noSideScroll(page);
  // every page and command treats the half-signed-in session as signed out
  await page.goto(`/${slug}/home`);
  await expect(page).toHaveURL(/\/login\/two-step\?next=/);
  const refused = await page.request.get(
    `/${slug}/files/00000000-0000-4000-8000-000000000000/preview`,
  );
  expect(refused.status()).toBe(401);
  // the login page, opened again, goes back to the code
  await page.goto(`/login?next=/${slug}/home`);
  await expect(page).toHaveURL(/\/login\/two-step\?next=/);

  // wrong code, then the right one, with the keyboard only
  const code = page.getByLabel('6-digit code');
  await expect(code).toBeFocused();
  await page.keyboard.type('123 456');
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('That code is not right. Enter the code the app shows now.'),
  ).toBeVisible();
  await code.fill('');
  await code.focus();
  await page.keyboard.type(await freshCode(secret, used));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/${slug}/home$`));

  // remove it: back to the password only
  await page.goto(`/account?next=/${slug}`);
  await page.getByRole('button', { name: /^Remove Authenticator app, added / }).click();
  await expect(page.getByText(/Two-step sign-in turns off/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep it' })).toBeFocused();
  await page.getByRole('button', { name: 'Remove app' }).click();
  await expect(page.getByTestId('two-step-status')).toHaveText('Off');
  await page.context().clearCookies();
  await signInWithPassword(page, email, password, `/${slug}/home`);
  await expect(page).toHaveURL(new RegExp(`/${slug}/home$`));
});

async function invite(owner: Page, slug: string, email: string) {
  await owner.goto(`/${slug}/settings`);
  await owner.getByLabel('Email').fill(email);
  await owner.getByLabel('Role', { exact: true }).selectOption('admin');
  await owner.getByRole('button', { name: 'Send invite' }).click();
  return new URL((await owner.getByTestId('invite-link').textContent())!).pathname;
}

async function newContextPage(browser: Browser, info: { project: { name: string } }) {
  const context = await browser.newContext(
    info.project.name === 'phone' ? { viewport: { width: 390, height: 844 } } : {},
  );
  return context.newPage();
}

test('a workspace that requires two-step sign-in asks members to set it up first', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const used = new Set<number>();
  const slug = `tr-${unique()}`;
  await newAccount(page, 'Olga Owner', slug);

  // the owner cannot require it before they use it themselves
  await page.goto(`/${slug}/settings?tab=security`);
  const toggle = page.getByRole('switch', { name: /Require two-step sign-in for this workspace/ });
  await expect(toggle).toBeDisabled();
  await expect(page.getByText('Set up two-step sign-in for yourself first.')).toBeVisible();
  await page.getByRole('link', { name: 'Open Your account' }).click();
  await expect(page).toHaveURL(/\/account\?next=/);
  await setUpApp(page, used);
  await page.getByRole('link', { name: /^Back to / }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/settings\\?tab=security$`));
  await expect(toggle).toBeEnabled();
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(page.getByText('Two-step sign-in is now required.')).toBeVisible();
  await expect(page.getByTestId('require-two-step-state')).toHaveText('· On');
  if (info.project.name === 'phone') await noSideScroll(page);

  // a new admin without an app is asked to set one up before the workspace opens
  const memberEmail = freshEmail('member');
  const invitePath = await invite(page, slug, memberEmail);
  const member = await newContextPage(browser, info);
  await member.goto('/login?mode=signup');
  await expect(member.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  await member.getByLabel('Email').fill(memberEmail);
  await member.getByLabel('Password').fill(`Correct horse ${unique()}`);
  await member.getByRole('button', { name: 'Create account' }).click();
  await completeProfile(member, 'Mia Member');
  await expect(member.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();
  await member.goto(invitePath);
  await member.getByRole('button', { name: 'Accept and join' }).click();
  await expect(member).toHaveURL(new RegExp(`/account\\?required=${slug}&next=%2F${slug}$`));
  await expect(member.getByTestId('two-step-required')).toContainText(
    `Two-step ${slug} requires two-step sign-in. Set it up below to open the workspace.`,
  );
  // no page and no command of the workspace works until then
  await member.goto(`/${slug}/home`);
  await expect(member).toHaveURL(new RegExp(`/account\\?required=${slug}`));
  const refused = await member.request.get(
    `/${slug}/files/00000000-0000-4000-8000-000000000000/preview`,
  );
  expect(refused.status()).toBe(403);
  expect(await refused.text()).toBe(
    'This workspace requires two-step sign-in. Set it up in Your account, then try again.',
  );
  if (info.project.name === 'phone') await noSideScroll(member);

  await setUpApp(member, new Set());
  await member.getByRole('button', { name: 'Continue to the workspace' }).click();
  await expect(member).toHaveURL(new RegExp(`/${slug}/home$`));

  // admins read the setting; only owners change it
  await member.goto(`/${slug}/settings?tab=security`);
  await expect(
    member.getByRole('switch', { name: /Require two-step sign-in for this workspace/ }),
  ).toBeDisabled();
  await expect(member.getByText('Only owners can change this.')).toBeVisible();

  // turned off again
  await page.goto(`/${slug}/settings?tab=security`);
  await toggle.click();
  await expect(page.getByText('Two-step sign-in is now optional.')).toBeVisible();
  await expect(page.getByTestId('require-two-step-state')).toHaveText('· Off');
  await member.context().close();
});
