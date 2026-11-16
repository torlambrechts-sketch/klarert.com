import { expect, test, type Page } from '@playwright/test';
import { accessToken, completeProfile, freshEmail, rest, signIn } from './helpers';

// Your account › Your name (docs/05 §1.1): the name onboarding asked for, changed in place with onboarding's rule and
// initials. A deleted account ("Former member") cannot be renamed. Desktop and 390 px (phone).

type Profile = { display_name: string; initials: string };

async function noSideScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(width);
}

async function myProfile(page: Page, id: string) {
  return (await rest<Profile[]>(page, `profiles?id=eq.${id}&select=display_name,initials`))[0];
}

/** The signed-in person's id, from their access token. */
const userId = async (page: Page) =>
  (
    JSON.parse(
      Buffer.from((await accessToken(page)).split('.')[1]!, 'base64url').toString('utf8'),
    ) as { sub: string }
  ).sub;

test('change your name with the keyboard: required, trimmed, initials follow, saved', async ({
  page,
}) => {
  await signIn(page, freshEmail('name'));
  await completeProfile(page, 'Ada Lovelace');
  await expect(page.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();
  const id = await userId(page);

  await page.goto('/account');
  const panel = page.getByTestId('name-panel');
  await expect(panel.getByRole('heading', { level: 2, name: 'Your name' })).toBeVisible();
  await expect(panel.getByTestId('current-name')).toHaveText('Ada Lovelace');
  await noSideScroll(page);

  // opens in place, the field focused with the current name
  const change = panel.getByRole('button', { name: 'Change name' });
  await change.focus();
  await page.keyboard.press('Enter');
  const field = panel.getByLabel('Your name');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Ada Lovelace');
  await expect(field).toHaveAttribute('maxlength', '80');

  // Cancel gives focus back and changes nothing
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await expect(change).toBeFocused();

  // required
  await page.keyboard.press('Enter');
  await field.fill('   ');
  await field.press('Enter');
  await expect(panel.getByText('Name is required.')).toBeVisible();
  await expect(panel.getByLabel('Your name')).toHaveAttribute('aria-invalid', 'true');
  await expect(panel.getByLabel('Your name')).toHaveValue('   ');
  await noSideScroll(page);

  // saved, trimmed, with initials derived as onboarding derives them
  await panel.getByLabel('Your name').fill('  Grace Brewster Hopper  ');
  await panel.getByLabel('Your name').press('Enter');
  await expect(page.getByText('Your name is saved.')).toBeVisible();
  await expect(panel.getByTestId('current-name')).toHaveText('Grace Brewster Hopper');
  await expect(change).toBeFocused();
  await expect(page.getByRole('main')).toContainText('Grace Brewster Hopper ·');
  expect(await myProfile(page, id)).toEqual({
    display_name: 'Grace Brewster Hopper',
    initials: 'GH',
  });

  // kept after a reload
  await page.reload();
  await expect(page.getByTestId('current-name')).toHaveText('Grace Brewster Hopper');
});

test('a deleted account cannot be renamed, even with a token that is still valid', async ({
  page,
  browser,
}) => {
  const email = freshEmail('named');
  await signIn(page, email);
  await completeProfile(page, 'Ada Lovelace');
  await expect(page.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();
  const id = await userId(page);
  // the session as it is now, kept to try a rename after the account is gone
  const kept = await page.context().storageState();

  await page.goto('/account');
  await page
    .getByTestId('delete-account-panel')
    .getByRole('button', { name: 'Delete my account' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Delete your account?' });
  await dialog.getByLabel(`Type ${email} to confirm`).fill(email);
  await dialog.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page).toHaveURL(/\/account-deleted$/);

  const ctx = await browser.newContext({ storageState: kept });
  const old = await ctx.newPage();
  // profiles_self no longer matches the tombstone: the update changes no row
  expect(
    await rest(old, `profiles?id=eq.${id}`, {
      method: 'PATCH',
      body: { display_name: 'Ada Again', initials: 'AA' },
    }),
  ).toEqual([]);
  expect(await myProfile(old, id)).toEqual({ display_name: 'Former member', initials: '?' });
  // and Your account is not open to it
  await old.goto(new URL('/account', page.url()).toString());
  await expect(old).toHaveURL(/\/login/);
  await ctx.close();
});
