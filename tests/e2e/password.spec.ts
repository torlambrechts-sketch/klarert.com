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
