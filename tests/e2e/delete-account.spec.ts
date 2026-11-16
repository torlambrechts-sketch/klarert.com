import { expect, test, type Page } from '@playwright/test';
import { appMail, completeProfile, freshEmail, signIn } from './helpers';
import { makeSheet, seedItems } from './automation-helpers';

// Your account › Delete my account (docs/05 §1.1, docs/09 §12, migration 0071): the only owner of a workspace is
// refused with the workspace named; a member deletes their account, cannot sign in again, and what they made stays,
// shown as made by "Former member". Desktop and 390 px (phone).

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function newWorkspace(page: Page, who: string, name: string) {
  const slug = `del-${unique()}`;
  await signIn(page, freshEmail('owner'));
  await completeProfile(page, who);
  await page.getByLabel('Workspace name').fill(name);
  await page.getByLabel('Web address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/home$`));
  return slug;
}

async function noSideScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(width);
}

/** Open the dialog from Your account with the keyboard; the confirmation field has focus. */
async function openDeleteDialog(page: Page) {
  await page.goto('/account');
  const panel = page.getByTestId('delete-account-panel');
  await expect(panel).toContainText('Former member');
  await panel.getByRole('button', { name: 'Delete my account' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Delete your account?' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('the only owner of a workspace is refused, and the workspace named', async ({
  page,
}, info) => {
  const name = `Solo ${unique()}`;
  await newWorkspace(page, 'Olga Owner', name);
  const email = (await page.goto('/account'),
  await page.getByTestId('current-email').textContent())!;

  const dialog = await openDeleteDialog(page);
  if (info.project.name === 'phone') await noSideScroll(page);
  const confirm = dialog.getByLabel(`Type ${email} to confirm`);
  await expect(confirm).toBeFocused();

  // the address must match
  await confirm.fill('someone@else.test');
  await dialog.getByRole('button', { name: 'Delete my account' }).click();
  await expect(dialog.getByText('Type your email address exactly as it is shown.')).toBeVisible();

  await confirm.fill(email);
  await dialog.getByRole('button', { name: 'Delete my account' }).click();
  await expect(dialog.getByTestId('delete-account-refusal')).toHaveText(
    `You are the only owner of ${name}. Make someone else owner of ${name} or delete it first.`,
  );

  // nothing happened: still signed in, still the owner
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.goto('/');
  await expect(page.getByText(name).first()).toBeVisible();
});

test('a member deletes their account: signed out, cannot sign in, their item shows "Former member"', async ({
  browser,
}, info) => {
  test.setTimeout(150_000);
  const phone = info.project.name === 'phone' ? { viewport: { width: 390, height: 844 } } : {};
  const ownerCtx = await browser.newContext(phone);
  const owner = await ownerCtx.newPage();
  const company = `Leavers ${unique()}`;
  const slug = await newWorkspace(owner, 'Ada Lovelace', company);
  const sheet = await makeSheet(
    owner,
    'Actions',
    [{ key: 'made_by', name: 'Created by', type: 'meta', config: { which: 'created_by' } }],
    'Action',
    slug,
  );

  // the member: a password account that accepts an editor invite
  const email = freshEmail('mia');
  const password = `Correct horse ${unique()}`;
  await owner.goto(`/${slug}/settings`);
  await owner.getByLabel('Email').fill(email);
  await owner.getByLabel('Role', { exact: true }).selectOption('editor');
  const sentAt = Date.now();
  await owner.getByRole('button', { name: 'Send invite' }).click();
  await expect(owner.getByTestId('invite-result')).toContainText(`Invite sent to ${email}.`);
  const invite = await appMail(email, 'invite', { after: sentAt });

  const ctx = await browser.newContext(phone);
  const member = await ctx.newPage();
  await member.goto('/login?mode=signup');
  await member.getByLabel('Email').fill(email);
  await member.getByLabel('Password').fill(password);
  await member.getByRole('button', { name: 'Create account' }).click();
  await completeProfile(member, 'Mia Member');
  await expect(member.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();
  await member.goto(new URL(invite.link).pathname);
  await member.getByRole('button', { name: 'Accept and join' }).click();
  await expect(member).toHaveURL(new RegExp(`/${slug}/home$`));
  await seedItems(member, sheet, [{ name: 'Fix the lock' }]);

  await owner.goto(sheet.url);
  await expect(sheet.cell(owner, 'Fix the lock', 'Created by')).toContainText('Mia Member');

  // delete: type the address, the account goes, the person lands signed out on a plain page
  const dialog = await openDeleteDialog(member);
  if (info.project.name === 'phone') await noSideScroll(member);
  await dialog.getByLabel(`Type ${email} to confirm`).fill(email.toUpperCase());
  await dialog.getByRole('button', { name: 'Delete my account' }).click();
  await expect(member).toHaveURL(/\/account-deleted$/);
  await expect(member.getByTestId('account-deleted')).toHaveText('Your account has been deleted.');
  if (info.project.name === 'phone') await noSideScroll(member);
  await member.goto('/account');
  await expect(member).toHaveURL(/\/login\?next=%2Faccount$/);

  // the password no longer signs in
  await member.goto('/login');
  await member.getByLabel('Email').fill(email);
  await member.getByLabel('Password').fill(password);
  await member.getByRole('button', { name: 'Sign in' }).click();
  await expect(member.getByText('Email or password is wrong.')).toBeVisible();
  await expect(member).toHaveURL(/\/login/);

  // what she made stays, without her name; she is no longer listed as a member
  await owner.goto(sheet.url);
  await expect(sheet.cell(owner, 'Fix the lock', 'Created by')).toContainText('Former member');
  await expect(sheet.cell(owner, 'Fix the lock', 'Created by')).not.toContainText('Mia');
  await owner.goto(`/${slug}/settings`);
  await expect(owner.getByText('Ada Lovelace', { exact: true }).first()).toBeVisible();
  await expect(owner.getByText('Mia Member', { exact: true })).toHaveCount(0);

  await ctx.close();
  await ownerCtx.close();
});
