import { expect, test } from '@playwright/test';
import { completeProfile, freshEmail, signIn } from './helpers';

test('sign up, create a workspace, invite a colleague who accepts', async ({ browser }) => {
  const owner = await browser.newPage();
  const ownerEmail = freshEmail('owner');
  const slug = `acme-${Date.now().toString(36)}`;

  await signIn(owner, ownerEmail);
  await completeProfile(owner, 'Ada Lovelace');

  await expect(owner.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();
  await owner.getByLabel('Workspace name').fill('Acme Engineering');
  await expect(owner.getByLabel('Web address')).toHaveValue('acme-engineering');
  await owner.getByLabel('Web address').fill(slug);
  await owner.getByRole('button', { name: 'Create workspace' }).click();
  await expect(owner).toHaveURL(new RegExp(`/${slug}/home$`));
  // Home greets by the hour in the workspace's time zone (src/engine/home.ts greeting)
  await expect(
    owner.getByRole('heading', { name: /^Good (morning|afternoon|evening), Ada$/ }),
  ).toBeVisible();

  // invite
  const inviteeEmail = freshEmail('invitee');
  await owner.goto(`/${slug}/settings`);
  await owner.getByLabel('Email').fill(inviteeEmail);
  await owner.getByLabel('Role', { exact: true }).selectOption('viewer');
  await owner.getByRole('button', { name: 'Create invite link' }).click();
  const link = (await owner.getByTestId('invite-link').textContent())!;
  expect(link).toMatch(/\/invite\/[0-9a-f]{48}$/);
  await expect(owner.getByText(inviteeEmail)).toBeVisible();

  // accept in a separate browser session
  const inviteeCtx = await browser.newContext();
  const invitee = await inviteeCtx.newPage();
  const invitePath = new URL(link).pathname;
  await signIn(invitee, inviteeEmail, invitePath);
  await completeProfile(invitee, 'Grace Hopper');
  await expect(invitee.getByRole('heading', { name: 'Join Acme Engineering' })).toBeVisible();
  await expect(invitee.getByText('Ada Lovelace invited')).toBeVisible();
  await invitee.getByRole('button', { name: 'Accept and join' }).click();
  await expect(invitee).toHaveURL(new RegExp(`/${slug}/home$`));

  // the viewer cannot manage the workspace
  await invitee.goto(`/${slug}/settings`);
  await expect(
    invitee.getByText('Only owners and admins can change workspace settings.'),
  ).toBeVisible();

  // the owner sees the new member; the invite is gone
  await owner.reload();
  await expect(owner.getByText('Grace Hopper', { exact: true })).toBeVisible();
  await expect(owner.getByRole('heading', { name: /Open invites/ })).toHaveCount(0);

  // the last owner cannot leave
  await owner.getByRole('button', { name: 'Leave', exact: true }).click();
  await owner.getByRole('button', { name: 'Leave workspace' }).click();
  await expect(owner.getByText('A workspace needs at least one owner.')).toBeVisible();

  await inviteeCtx.close();
});

test('an invite only works for the address it was sent to', async ({ browser }) => {
  const owner = await browser.newPage();
  const slug = `wrong-${Date.now().toString(36)}`;
  await signIn(owner, freshEmail('owner'));
  await completeProfile(owner, 'Owner Person');
  await owner.getByLabel('Workspace name').fill('Wrong Address Ltd');
  await owner.getByLabel('Web address').fill(slug);
  await owner.getByRole('button', { name: 'Create workspace' }).click();
  await expect(owner).toHaveURL(new RegExp(`/${slug}/home$`));
  await owner.goto(`/${slug}/settings`);
  await owner.getByLabel('Email').fill(freshEmail('intended'));
  await owner.getByRole('button', { name: 'Create invite link' }).click();
  const link = (await owner.getByTestId('invite-link').textContent())!;

  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await signIn(other, freshEmail('someone-else'), new URL(link).pathname);
  await completeProfile(other, 'Someone Else');
  await expect(other.getByText(/Sign out and sign in as/)).toBeVisible();
  await expect(other.getByRole('button', { name: 'Accept and join' })).toHaveCount(0);
  await ctx.close();
});
