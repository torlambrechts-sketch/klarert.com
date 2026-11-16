import { expect, test, type Browser, type Page } from '@playwright/test';
import { completeProfile, freshEmail } from './helpers';
import { mailTo, openLink, type Mail } from './auth-mail';
import { freshCode } from './totp';

// Forgot password, Set a new password and Your account › Email address and Password (docs/05 §1 and §1.1,
// docs/09 §12), through the real emails in Mailpit. Every test makes its own accounts.

test.describe.configure({ mode: 'default' });

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const SAME_ANSWER = 'If an account uses that address, we have sent a link to reset your password.';
const PASSWORD_ALERT = 'Your Compliance OS password was changed';
const EMAIL_ALERT = 'The email address of your Compliance OS account was changed';
const CONFIRM_EMAIL = 'Confirm the new email address for Compliance OS';

/** A security alert (Supabase Auth's notification emails, docs/09 §12): plain, with the Forgot password link. */
function expectAlert(mail: Mail) {
  expect(mail.text).toContain('If this was not you, reset your password now');
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

test('forgot password: the same answer for every address, the link, a new password, sign in with it', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150_000);
  const { email, password } = await newAccount(page, 'Rory Reset');
  const other = await otherDevice(browser, page, email, password);
  await page.context().clearCookies();

  // an address without an account gets the very same answer
  await askForReset(page, freshEmail('nobody'));
  if (info.project.name === 'phone') await noSideScroll(page);

  const started = await askForReset(page, email);
  const mail = await mailTo(email, started);
  expect(mail.subject).toBe('Reset your Compliance OS password');
  expect(mail.text).toContain('If you did not ask for this, you can ignore this email.');
  expect(mail.html).not.toMatch(/<img|src=/i);
  await openLink(page, mail.link);
  await expect(page).toHaveURL(/\/login\/new-password$/);
  if (info.project.name === 'phone') await noSideScroll(page);
  const newPassword = `Battery staple ${unique()}`;
  await setNewPassword(page, newPassword);
  await page.getByRole('link', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

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

  // without a session from a reset link, the page sends people to ask for one
  await page.context().clearCookies();
  await page.goto('/login/new-password');
  await expect(page).toHaveURL(/\/login\/forgot-password\?error=link$/);
  await expect(page.getByRole('alert').filter({ hasText: 'Ask for a new one.' })).toBeVisible();
});

test('forgot password with two-step sign-in: the code comes before the new password', async ({
  page,
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
  await openLink(page, (await mailTo(email, started)).link);
  // the reset link signs in with the first step only: the code is owed before the password can change
  await expect(page).toHaveURL(/\/login\/two-step\?next=%2Flogin%2Fnew-password$/);
  if (info.project.name === 'phone') await noSideScroll(page);
  await expect(page.getByLabel('6-digit code')).toBeFocused();
  await page.keyboard.type(await freshCode(secret, used));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/login\/new-password$/);
  const newPassword = `Battery staple ${unique()}`;
  await setNewPassword(page, newPassword);

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
    `The password of the Compliance OS account for ${email} was changed`,
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
  const confirmedAt = Date.now();
  await openLink(page, toNew.link);
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
