import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

// Uses the seed (pnpm seed): maria@example.com owns /meridian; vic@example.com is a viewer.

test('owner manages teams, job roles, entities and sites', async ({ page }) => {
  const suffix = Date.now().toString(36);
  await signIn(page, 'maria@example.com');
  await expect(page).toHaveURL(/\/meridian\/home$/);

  // workspace switcher lists the workspace
  await page.getByRole('button', { name: /Switch workspace/ }).click();
  await expect(page.getByRole('menuitem', { name: /Meridian Components Ltd/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/meridian/settings?tab=teams');
  const team = `Audit ${suffix}`;
  await page.getByRole('textbox', { name: 'New team' }).fill(team);
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  const teamRow = page.getByRole('listitem').filter({ has: page.getByText(team, { exact: true }) });
  await expect(teamRow).toBeVisible();
  await teamRow.getByLabel(`Add a person to ${team}`).selectOption({ label: 'James Okafor' });
  await teamRow.getByRole('button', { name: 'Add to team' }).click();
  await expect(
    page.getByRole('list', { name: `Members of ${team}` }).getByText('James Okafor'),
  ).toBeVisible();

  const jobRole = `Internal auditor ${suffix}`;
  await page.getByRole('textbox', { name: 'New job role' }).fill(jobRole);
  await page.getByRole('button', { name: 'Add', exact: true }).last().click();
  await expect(page.getByRole('button', { name: `Delete ${jobRole}` })).toBeVisible();

  await page.goto('/meridian/settings?tab=entities');
  await expect(page.getByText('Leeds')).toBeVisible();
  const entity = `Meridian Nordic AS ${suffix}`;
  await page.getByLabel('Legal entity').fill(entity);
  await page.getByLabel('Country').fill('no');
  await page.getByRole('button', { name: 'Add entity' }).click();
  await page.getByRole('textbox', { name: `New site for ${entity}` }).fill('Oslo');
  await page.getByRole('textbox', { name: `New site for ${entity}` }).press('Enter');
  await expect(
    page.getByRole('list', { name: `Sites of ${entity}` }).getByText('Oslo'),
  ).toBeVisible();

  // clean up so the seed stays as documented
  await page.getByRole('button', { name: `Delete ${entity}` }).click();
  await page.getByRole('button', { name: `Delete ${entity}` }).click();
  await expect(page.getByText(entity)).toHaveCount(0);
});

test('a viewer cannot open workspace settings', async ({ page }) => {
  await signIn(page, 'vic@example.com');
  await page.goto('/meridian/settings');
  await expect(
    page.getByText('Only owners and admins can change workspace settings.'),
  ).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveCount(0);
});
