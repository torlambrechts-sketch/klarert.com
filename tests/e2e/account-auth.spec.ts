import { expect, test, type Browser, type Page } from '@playwright/test';
import { completeProfile, freshEmail, signIn } from './helpers';
import { defaultTemplateLink, linkHere, mailTo, openLink, scanLink, type Mail } from './auth-mail';
import { freshCode } from './totp';

// Forgot password, Set a new password and Your account › Email address and Password (docs/05 §1 and §1.1,
// docs/09 §12), through the real emails in Mailpit. Every test makes its own accounts.

test.describe.configure({ mode: 'default' });

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const SAME_ANSWER = 'If an account uses that address, we have sent a link to reset your password.';
const PASSWORD_ALERT = 'Your Keptrow password was changed';
const EMAIL_ALERT = 'The email address of your Keptrow account was changed';
const CONFIRM_EMAIL = 'Confirm the new email address for Keptrow';
const RESET_PAGE = { heading: 'Set a new password', button: 'Continue to set a new password' };
const SIGN_IN_PAGE = { heading: 'Sign in to Keptrow', button: 'Continue' };
const EMAIL_CHANGE_PAGE = { heading: 'Confirm your new email address', button: 'Confirm' };
const LINK_FAILED =
  'This link has to be opened in the same browser you asked from, or it has expired. Ask for a new link.';

/** A security alert (Supabase Auth's notification emails, docs/09 §12): plain, with the Forgot password link. */
function expectAlert(mail: Mail) {
  expect(mail.text).toContain('If this was not you, reset your password now');
  expect(mail.text).toContain('If this was not you, contact support@keptrow.com straight away.');
  expect(mail.text).toContain('tell the owner of your workspace');
  expect(new URL(mail.link).pathname).toBe('/login/forgot-password');
  expect(mail.html).not.toMatch(/<img|src=/i);
}

/** A new password account with a profile, signed in on `page`. */
async function newAccount(page: Page, name: string) {
  const email = freshEmail(name.split(' ')[0]!.toLowerCase());
  const password = `Correct horse ${unique()}`;
  await page.goto('/login?mode=signup');
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await completeProfile(page, name);
  await expect(page.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();
  return { email, password };
}

async function signInWithPassword(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** A second browser signed in as the same person: it must be signed out when the password changes. */
async function otherDevice(browser: Browser, page: Page, email: string, password: string) {
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const other = await context.newPage();
  await signInWithPassword(other, email, password);
  await expect(other).toHaveURL(/\/onboarding$/);
  return other;
}

/** A browser with nothing in it, as on another device: it never asked for the link it opens. */
async function freshBrowser(browser: Browser, page: Page) {
  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: page.viewportSize(),
  });
  return context.newPage();
}

/**
 * A reset email: our own link, to this site's Continue page (`/auth/confirm`, which opens the link only on a click)
 * with the token hash, not to Supabase.
 */
function expectOwnResetLink(mail: Mail) {
  const link = new URL(mail.link);
  expect(link.pathname).toBe('/auth/confirm');
  expect(link.searchParams.get('type')).toBe('recovery');
  expect(link.searchParams.get('next')).toBe('/login/new-password');
  expect(link.searchParams.get('token_hash')).toBeTruthy();
  expect(mail.html).not.toContain('/auth/v1/verify');
  expect(mail.text).toContain('The link works once, for 1 hour, on any device.');
}

async function expectSignedOut(other: Page) {
  await other.goto('/account');
  await expect(other).toHaveURL(/\/login\?next=%2Faccount$/);
  await other.context().close();
}

async function noSideScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(width);
}

/** Ask for a reset link from the sign-in page, with the keyboard. */
async function askForReset(page: Page, email: string) {
  await page.goto('/login');
  const forgot = page.getByRole('link', { name: 'Forgot password' });
  await forgot.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeFocused();
  const started = Date.now();
  await page.keyboard.type(email);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('reset-sent')).toContainText(SAME_ANSWER);
  return started;
}

/** Set a new password on the page a reset link opened: checks the rules first. */
async function setNewPassword(page: Page, password: string) {
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('too short');
  await page.getByLabel('Repeat the new password').fill('too short');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByText('Use at least 12 characters.')).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Repeat the new password').fill(`${password}x`);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByText('The two passwords are not the same.')).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Repeat the new password').fill(password);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByTestId('password-changed')).toContainText(
    'Your password has been changed.',
  );
  await expect(page.getByTestId('password-changed')).toContainText(
    'You are signed out on your other devices.',
  );
}

test('forgot password: the same answer for every address, the link on another device, a new password, sign in with it', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180_000);
  const { email, password } = await newAccount(page, 'Rory Reset');
  const other = await otherDevice(browser, page, email, password);
  await page.context().clearCookies();

  // an address without an account gets the very same answer
  await askForReset(page, freshEmail('nobody'));
  if (info.project.name === 'phone') await noSideScroll(page);

  const started = await askForReset(page, email);
  const mail = await mailTo(email, started);
  expect(mail.subject).toBe('Reset your Keptrow password');
  expect(mail.text).toContain('If you did not ask for this, you can ignore this email.');
  expect(mail.html).not.toMatch(/<img|src=/i);
  expectOwnResetLink(mail);

  // opened on another device: a browser that never asked for it. A link scanner opened it first (a plain GET): that
  // shows the Continue page only and leaves the token unused
  const device = await freshBrowser(browser, page);
  await scanLink(device, mail.link);
  await scanLink(device, mail.link);
  await openLink(device, mail.link, {
    ...RESET_PAGE,
    check: async () => {
      if (info.project.name === 'phone') await noSideScroll(device);
    },
  });
  await expect(device).toHaveURL(/\/login\/new-password$/);
  if (info.project.name === 'phone') await noSideScroll(device);
  const newPassword = `Battery staple ${unique()}`;
  await setNewPassword(device, newPassword);
  await device.getByRole('link', { name: 'Continue' }).click();
  await expect(device).toHaveURL(/\/onboarding$/);
  await device.context().close();

  // the link works once: Continue a second time says so and offers a new one
  const again = await freshBrowser(browser, page);
  await openLink(again, mail.link, RESET_PAGE);
  await expect(again).toHaveURL(/\/login\/forgot-password\?error=expired$/);
  await expect(again.getByTestId('reset-link-failed').getByRole('alert')).toHaveText(
    'This link has expired or was already used. Ask for a new link.',
  );
  await again.context().close();

  // the other browser was signed out; the old password no longer works, the new one does
  await expectSignedOut(other);
  await page.context().clearCookies();
  await signInWithPassword(page, email, password);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Email or password is wrong.' }),
  ).toBeVisible();
  await page.getByLabel('Password').fill(newPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  // a session from a sign-in link (its token also says `otp`) is no reset session: the password changes in Your
  // account, with the current one
  await page.context().clearCookies();
  await signIn(page, email);
  await page.goto('/login/new-password');
  await expect(page).toHaveURL(/\/account$/);

  // without a session from a reset link, the page sends people to ask for one
  await page.context().clearCookies();
  await page.goto('/login/new-password');
  await expect(page).toHaveURL(/\/login\/forgot-password\?error=link$/);
  await expect(page.getByTestId('reset-link-failed').getByRole('alert')).toHaveText(LINK_FAILED);
});

test('forgot password with Supabase default email (hosted until our templates are applied): another browser is told why and asks again', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150_000);
  const { email } = await newAccount(page, 'Pia Pkce');
  await page.context().clearCookies();

  // the default email links to Supabase Auth's verify step, which comes back with a code only the asking browser can use
  let started = await askForReset(page, email);
  const device = await freshBrowser(browser, page);
  await openLink(device, defaultTemplateLink((await mailTo(email, started)).link));
  await expect(device).toHaveURL(/\/login\/forgot-password\?error=link$/);
  await expect(device.getByTestId('reset-link-failed').getByRole('alert')).toHaveText(LINK_FAILED);
  if (info.project.name === 'phone') await noSideScroll(device);
  const askAgain = device.getByRole('link', { name: 'Ask for a new link' });
  await expect(askAgain).toBeFocused();
  await device.keyboard.press('Enter');
  await expect(device).toHaveURL(/\/login\/forgot-password$/);
  await expect(device.getByLabel('Email')).toBeFocused();
  await device.context().close();

  // in the browser that asked, the same kind of link opens Set a new password
  await page.waitForTimeout(2500); // a newer email than the first, past Supabase Auth's 1 s limit
  started = await askForReset(page, email);
  await openLink(page, defaultTemplateLink((await mailTo(email, started)).link));
  await expect(page).toHaveURL(/\/login\/new-password$/);
  await setNewPassword(page, `Battery staple ${unique()}`);
});

test('forgot password with two-step sign-in, on another device: the code comes before the new password', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180_000);
  const used = new Set<number>();
  const { email } = await newAccount(page, 'Tara Twostep');
  await page.goto('/account');
  await page.getByRole('button', { name: 'Set up two-step sign-in' }).click();
  const setup = page.getByTestId('two-step-setup');
  const secret = (await setup.getByTestId('two-step-secret').getAttribute('data-secret'))!;
  await setup
    .getByLabel('3. Enter the 6-digit code the app shows')
    .fill(await freshCode(secret, used));
  await setup.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
  await expect(page.getByTestId('two-step-status')).toHaveText('On');
  await page.context().clearCookies();

  const started = await askForReset(page, email);
  const mail = await mailTo(email, started);
  expectOwnResetLink(mail);
  const device = await freshBrowser(browser, page);
  await scanLink(device, mail.link);
  await openLink(device, mail.link, RESET_PAGE);
  // the reset link signs in with the first step only: the code is owed before the password can change
  await expect(device).toHaveURL(/\/login\/two-step\?next=%2Flogin%2Fnew-password$/);
  if (info.project.name === 'phone') await noSideScroll(device);
  // without the code, Set a new password is not reachable
  await device.goto('/login/new-password');
  await expect(device).toHaveURL(/\/login\/two-step\?next=%2Flogin%2Fnew-password$/);
  await expect(device.getByLabel('6-digit code')).toBeFocused();
  await device.keyboard.type(await freshCode(secret, used));
  await device.keyboard.press('Enter');
  await expect(device).toHaveURL(/\/login\/new-password$/);
  const newPassword = `Battery staple ${unique()}`;
  await setNewPassword(device, newPassword);
  await device.context().close();

  // sign in with the new password: the code is still asked for
  await page.context().clearCookies();
  await signInWithPassword(page, email, newPassword);
  await expect(page).toHaveURL(/\/login\/two-step/);
  await page.getByLabel('6-digit code').fill(await freshCode(secret, used));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test('Your account: change the password, then the email address', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150_000);
  const { email, password } = await newAccount(page, 'Cleo Change');
  const other = await otherDevice(browser, page, email, password);
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Your account', level: 1 })).toBeVisible();
  await expect(page.getByTestId('current-email')).toHaveText(email);
  if (info.project.name === 'phone') await noSideScroll(page);

  // Password, with the keyboard: the current one is checked, the new one typed twice
  const passwordPanel = page.getByTestId('password-panel');
  const change = passwordPanel.getByRole('button', { name: 'Change password' });
  await change.focus();
  await page.keyboard.press('Enter');
  await expect(passwordPanel.getByLabel('Current password')).toBeFocused();
  const newPassword = `Battery staple ${unique()}`;
  await page.keyboard.type('not my password');
  await passwordPanel.getByLabel('New password', { exact: true }).fill(newPassword);
  await passwordPanel.getByLabel('Repeat the new password').fill(newPassword);
  await passwordPanel.getByRole('button', { name: 'Change password' }).click();
  await expect(passwordPanel.getByText('That is not your current password.')).toBeVisible();
  await passwordPanel.getByLabel('Current password').fill(password);
  await passwordPanel.getByLabel('New password', { exact: true }).fill(newPassword);
  await passwordPanel.getByLabel('Repeat the new password').fill('something else entirely');
  await passwordPanel.getByRole('button', { name: 'Change password' }).click();
  await expect(passwordPanel.getByText('The two passwords are not the same.')).toBeVisible();
  await passwordPanel.getByLabel('Current password').fill(password);
  await passwordPanel.getByLabel('New password', { exact: true }).fill(newPassword);
  await passwordPanel.getByLabel('Repeat the new password').fill(newPassword);
  const changedAt = Date.now();
  await passwordPanel.getByRole('button', { name: 'Change password' }).click();
  await expect(passwordPanel.getByRole('status')).toHaveText(
    'Your password has been changed. You are signed out on your other devices.',
  );
  // the security alert
  const passwordAlert = await mailTo(email, changedAt, PASSWORD_ALERT);
  expect(passwordAlert.text).toContain(
    `The password of the Keptrow account for ${email} was changed`,
  );
  expectAlert(passwordAlert);
  await expect(passwordPanel.getByRole('button', { name: 'Change password' })).toBeFocused();
  await expectSignedOut(other);

  // Email address: links to both addresses; the address changes once the links are opened
  const emailPanel = page.getByTestId('email-panel');
  await emailPanel.getByRole('button', { name: 'Change email' }).click();
  await expect(emailPanel.getByLabel('New email address')).toBeFocused();
  await page.keyboard.type(email);
  await page.keyboard.press('Enter');
  await expect(emailPanel.getByText('That is already your email address.')).toBeVisible();
  const newEmail = freshEmail('cleo.new');
  const started = Date.now();
  await emailPanel.getByLabel('New email address').fill(newEmail);
  await emailPanel.getByRole('button', { name: 'Send confirmation links' }).click();
  await expect(page.getByTestId('email-pending')).toContainText(
    `Waiting for confirmation: ${newEmail}`,
  );
  await expect(page.getByTestId('current-email')).toHaveText(email);
  if (info.project.name === 'phone') await noSideScroll(page);
  const toOld = await mailTo(email, started, CONFIRM_EMAIL);
  const toNew = await mailTo(newEmail, started, CONFIRM_EMAIL);
  for (const mail of [toOld, toNew]) {
    expect(mail.subject).toBe(CONFIRM_EMAIL);
    expect(mail.text).toContain(newEmail);
    expect(mail.text).toContain('If you did not ask for this, you can ignore this email.');
  }
  // the local stack has email confirmation off, so Supabase Auth takes one link (hosted: both, docs/09 §12)
  expect(new URL(toNew.link).pathname).toBe('/auth/confirm');
  await scanLink(page, toNew.link);
  await page.reload();
  await expect(page.getByTestId('current-email')).toHaveText(email);
  const confirmedAt = Date.now();
  await openLink(page, toNew.link, {
    ...EMAIL_CHANGE_PAGE,
    check: async () => {
      if (info.project.name === 'phone') await noSideScroll(page);
    },
  });
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByTestId('current-email')).toHaveText(newEmail);
  await expect(page.getByTestId('email-pending')).toHaveCount(0);
  // the security alert goes to the old address
  const emailAlert = await mailTo(email, confirmedAt, EMAIL_ALERT);
  expect(emailAlert.text).toContain(`from ${email} to ${newEmail}`);
  expectAlert(emailAlert);

  // sign in with the new address and the new password
  await page.context().clearCookies();
  await signInWithPassword(page, newEmail, newPassword);
  await expect(page).toHaveURL(/\/onboarding$/);
});

test('sign-in link: a link scanner and another site cannot use it up; Continue signs in, once', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150_000);
  const { email } = await newAccount(page, 'Sami Scanner');
  await page.context().clearCookies();

  await page.goto('/login?mode=link');
  await page.getByLabel('Work email').fill(email);
  const started = Date.now();
  await page.getByRole('button', { name: 'Send sign-in link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const mail = await mailTo(email, started);
  const link = new URL(mail.link);
  expect(link.pathname).toBe('/auth/confirm');
  expect(link.searchParams.get('type')).toBe('email');

  // the scanner's GET shows the page only
  const device = await freshBrowser(browser, page);
  await scanLink(device, mail.link);

  // a form on another site (or a request with no browser headers) posting the token to the callback is refused,
  // and the token stays unused
  const form = {
    token_hash: link.searchParams.get('token_hash')!,
    type: 'email',
    redirect_to: link.searchParams.get('redirect_to') ?? '',
  };
  const posts: Record<string, string>[] = [
    { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
    { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' },
    {},
  ];
  for (const headers of posts) {
    const res = await device.request.post('/auth/callback', { form, headers, maxRedirects: 0 });
    expect(res.status()).toBe(303);
    const to = new URL(res.headers()['location']!);
    expect(`${to.pathname}${to.search}`).toBe('/login?error=link');
  }

  // the person's click signs in
  await openLink(device, mail.link, {
    ...SIGN_IN_PAGE,
    check: async () => {
      if (info.project.name === 'phone') await noSideScroll(device);
    },
  });
  await expect(device).toHaveURL(/\/onboarding$/);
  await device.context().close();

  // Continue a second time: the link was used
  const again = await freshBrowser(browser, page);
  await openLink(again, mail.link, SIGN_IN_PAGE);
  await expect(again).toHaveURL(/\/login\?error=link$/);
  await expect(
    again.getByRole('alert').filter({
      hasText: 'That sign-in link has expired or was already used. Sign in again.',
    }),
  ).toBeVisible();
  await again.context().close();

  // a link with its token cut off says so, and offers the way back
  const broken = await freshBrowser(browser, page);
  await broken.goto(`${(await linkHere(mail.link)).split('?')[0]}?type=email`);
  await expect(broken.getByTestId('email-link-broken')).toBeVisible();
  await expect(broken.getByRole('link', { name: 'Back to sign in' })).toBeFocused();
  await broken.context().close();
});
