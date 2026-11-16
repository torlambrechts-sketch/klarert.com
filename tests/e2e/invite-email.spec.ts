import { expect, test, type Page } from '@playwright/test';
import { appMail, completeProfile, freshEmail, signIn } from './helpers';

// Invites by email (board review A4, docs/09 §10) and the auditor's Start here panel (A10). Locally and in CI the app
// sends through Mailpit (src/server/email), so the mail is read back here. Runs on desktop and at 390 px (phone).

async function newWorkspace(page: Page, who: string, name: string, prefix: string) {
  const slug = `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  await signIn(page, freshEmail('owner'));
  await completeProfile(page, who);
  await page.getByLabel('Workspace name').fill(name);
  await page.getByLabel('Web address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/home$`));
  return slug;
}

test('an admin invites by email; the mail names the workspace and role, its link joins, resend works', async ({
  browser,
}, info) => {
  const phone = info.project.name === 'phone' ? { viewport: { width: 390, height: 844 } } : {};
  const ownerCtx = await browser.newContext(phone);
  const owner = await ownerCtx.newPage();
  const slug = await newWorkspace(owner, 'Ada Lovelace', 'Mail Invites Ltd', 'mail');

  const invitee = freshEmail('invitee');
  await owner.goto(`/${slug}/settings`);
  await owner.getByLabel('Email').fill(invitee);
  await owner.getByLabel('Role', { exact: true }).selectOption('viewer');
  // what the role can do, beside the choice
  await expect(owner.locator('#invite-role-hint')).toHaveText(
    'Viewers see sheets, items and activity, but cannot change anything.',
  );
  const sentAt = Date.now();
  await owner.getByRole('button', { name: 'Send invite' }).click();
  const result = owner.getByTestId('invite-result');
  await expect(result).toContainText(`Invite sent to ${invitee}.`);
  await expect(result).toContainText(/until \d{1,2} [A-Z][a-z]{2} \d{4}\./);
  const shown = (await owner.getByTestId('invite-link').textContent())!;

  const mail = await appMail(invitee, 'invite', { after: sentAt });
  expect(mail.subject).toBe('Ada Lovelace invited you to Mail Invites Ltd on Keptrow');
  // the local sender (EMAIL_FROM unset): the same name and domain as the hosted one (docs/14)
  expect(mail.from).toEqual({ name: 'Keptrow', address: 'no-reply@mail.keptrow.com' });
  expect(mail.text).toContain(
    'Ada Lovelace invited you to join the workspace Mail Invites Ltd on Keptrow as a viewer.',
  );
  expect(mail.text).toContain(
    'Viewers see sheets, items and activity, but cannot change anything.',
  );
  expect(mail.text).toMatch(
    new RegExp(
      `The link works once, for ${invitee.replace(/\./g, '\\.')} only, until \\d{1,2} [A-Z][a-z]{2} \\d{4}\\.`,
    ),
  );
  expect(mail.link).toBe(shown);
  expect(mail.html).not.toMatch(/<img/i);

  // the open invite says when its link ends; resend sends the same link again, once in 10 minutes
  await owner.reload();
  const row = owner
    .getByRole('listitem')
    .filter({ hasText: invitee })
    .filter({ hasText: 'not accepted yet' });
  await expect(row).toContainText(
    /Viewer · not accepted yet · link works until \d{1,2} [A-Z][a-z]{2} \d{4}/,
  );
  const resentAt = Date.now();
  await row.getByRole('button', { name: `Resend the invite to ${invitee}` }).click();
  await expect(owner.getByText(`Invite sent again to ${invitee}`)).toBeVisible();
  const again = await appMail(invitee, 'invite_resend', { after: resentAt });
  expect(again.link).toBe(shown);
  expect(again.subject).toBe(mail.subject);
  await row.getByRole('button', { name: `Resend the invite to ${invitee}` }).click();
  await expect(
    owner.getByText('This invite was sent again less than 10 minutes ago.', { exact: false }),
  ).toBeVisible();

  // the link in the email joins the workspace
  const ctx = await browser.newContext(phone);
  const person = await ctx.newPage();
  await signIn(person, invitee, new URL(mail.link).pathname);
  await completeProfile(person, 'Grace Hopper');
  await expect(person.getByRole('heading', { name: 'Join Mail Invites Ltd' })).toBeVisible();
  await person.getByRole('button', { name: 'Accept and join' }).click();
  await expect(person).toHaveURL(new RegExp(`/${slug}/home$`));

  await owner.reload();
  await expect(owner.getByText('Grace Hopper', { exact: true })).toBeVisible();
  await expect(owner.getByRole('heading', { name: /Open invites/ })).toHaveCount(0);
  await ctx.close();
  await ownerCtx.close();
});

test('an auditor lands on a Start here panel instead of the My work tiles', async ({
  browser,
}, info) => {
  const phone = info.project.name === 'phone' ? { viewport: { width: 390, height: 844 } } : {};
  const ownerCtx = await browser.newContext(phone);
  const owner = await ownerCtx.newPage();
  const slug = await newWorkspace(owner, 'Olga Owner', 'Audited Ltd', 'audited');
  // the owner's Home has the tiles and no panel
  await expect(owner.getByRole('navigation', { name: 'My work at a glance' })).toBeVisible();
  await expect(owner.getByRole('heading', { name: 'Start here' })).toHaveCount(0);

  const auditor = freshEmail('auditor');
  await owner.goto(`/${slug}/settings`);
  await owner.getByLabel('Email').fill(auditor);
  await owner.getByLabel('Role', { exact: true }).selectOption('auditor');
  await owner.getByLabel('Access ends on').fill('2099-12-31');
  const sentAt = Date.now();
  await owner.getByRole('button', { name: 'Send invite' }).click();
  await expect(owner.getByTestId('invite-result')).toContainText(`Invite sent to ${auditor}.`);
  const mail = await appMail(auditor, 'invite', { after: sentAt });
  expect(mail.text).toContain('as an auditor.');
  expect(mail.text).toContain('Your read-only access ends on 31 Dec 2099.');

  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  await signIn(page, auditor, new URL(mail.link).pathname);
  await completeProfile(page, 'Avery Auditor');
  await page.getByRole('button', { name: 'Accept and join' }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/home$`));

  const panel = page.getByRole('region', { name: 'Start here' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Read-only auditor access until 31 Dec 2099.');
  await expect(page.getByRole('navigation', { name: 'My work at a glance' })).toHaveCount(0);
  for (const [name, href] of [
    ['Audit outputs', `/${slug}/audit`],
    ['Statement of applicability', `/${slug}/audit#audit-soa`],
    ['Evidence library', `/${slug}/evidence`],
    ['Activity log', `/${slug}/audit#audit-pack`],
  ] as const)
    await expect(panel.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute(
      'href',
      href,
    );
  // keyboard reachable
  await panel.getByRole('link', { name: /^Evidence library/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/${slug}/evidence`));
  await expect(page.getByRole('heading', { name: 'Evidence library' })).toBeVisible();

  // no horizontal scroll at this width
  await page.goto(`/${slug}/home`);
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await ctx.close();
  await ownerCtx.close();
});
