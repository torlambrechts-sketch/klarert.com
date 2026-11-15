import { expect, test } from '@playwright/test';
import { completeProfile, freshEmail } from './helpers';

test('create an account with a password, sign out, sign in again, wrong password refused', async ({
  page,
}) => {
  const email = freshEmail('pw');
  const password = `Correct horse ${Date.now()}`;

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Create an account' }).click();
  // the sign-up form replaces the sign-in form on navigation; type only once it is there
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Use at least 10 characters.')).toBeVisible();

  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await completeProfile(page, 'Pat Password');
  await expect(page.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();

  // sign out by clearing the session, then sign in with the password
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Email or password is wrong.' }),
  ).toBeVisible();

  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});

// SA-2: `next` after sign-in, onboarding or the two-step code only ever names a page on this site
// (src/lib/safe-next.ts). Browsers read `/\evil.com` and `/<tab>/evil.com` as another host.
const UNSAFE_NEXT = [
  '/\\evil.com',
  '/\t/evil.com',
  '/%5Cevil.com',
  '//evil.com',
  'https://evil.com',
  '/%09/evil.com',
];

test('sign-in never sends people to another site', async ({ page }) => {
  const email = freshEmail('redirect');
  const password = `Correct horse ${Date.now()}`;
  await page.goto('/login?mode=signup');
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await completeProfile(page, 'Rita Redirect');
  await expect(page.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();

  // signed in: /login sends people on to `next`, only when it is a path here
  for (const next of UNSAFE_NEXT) {
    const res = await page.request.get(`/login?next=${encodeURIComponent(next)}`, {
      maxRedirects: 0,
    });
    expect(res.status(), next).toBe(307);
    expect(res.headers()['location'], next).toBe('/');
  }
  const safe = await page.request.get(`/login?next=${encodeURIComponent('/onboarding?x=1')}`, {
    maxRedirects: 0,
  });
  expect(safe.headers()['location']).toBe('/onboarding?x=1');

  // the magic-link callback (no code: back to sign-in) and the password form ignore it too
  const callback = await page.request.get(
    `/auth/callback?next=${encodeURIComponent(UNSAFE_NEXT[0]!)}`,
    { maxRedirects: 0 },
  );
  expect(new URL(callback.headers()['location']!).host).toBe(new URL(page.url()).host);
  await page.context().clearCookies();
  await page.goto(`/login?next=${encodeURIComponent(UNSAFE_NEXT[0]!)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});
