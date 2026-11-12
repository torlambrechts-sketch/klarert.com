import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

// Dashboards (docs/05 §4, design "Compliance overview"): the first visit opens (or seeds) the first dashboard; an
// editor makes a new dashboard, adds widgets from the registry, edits, moves and removes them, switches the period
// and renames and deletes the dashboard. Uses the seed (pnpm seed): james@example.com is an editor of /meridian.

test('an editor builds a dashboard: add, edit, move, remove widgets, period, rename, delete', async ({
  page,
}) => {
  await signIn(page, 'james@example.com');
  await page.goto('/meridian/dashboards');
  await expect(page).toHaveURL(/\/meridian\/dashboards\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('main ul.grid > li').first()).toBeVisible();
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    axe.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(' | ')}`),
  ).toEqual([]);

  // a new, empty dashboard
  const name = `Board ${randomUUID().slice(0, 6)}`;
  const firstUrl = page.url();
  // the menu opens once the page is interactive
  await expect(async () => {
    await page.getByRole('button', { name: 'Dashboard options' }).click();
    await expect(page.getByRole('menuitem', { name: 'New dashboard' })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
  await page.getByRole('menuitem', { name: 'New dashboard' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page).not.toHaveURL(firstUrl);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(page.getByText('No widgets yet.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Dashboards' })).toBeVisible();

  const cards = page.locator('main ul.grid > li');
  const add = async (kind: RegExp) => {
    await page.getByRole('button', { name: 'Add widget' }).first().click();
    await dialog.getByRole('radio', { name: kind }).check();
    await dialog.getByRole('button', { name: 'Add widget' }).click();
    await expect(dialog).toBeHidden();
  };

  await add(/^Done by sheet/);
  await expect(page.getByRole('heading', { name: 'Done by sheet', level: 2 })).toBeVisible();
  await add(/^Follow-up health/);
  await expect(page.getByRole('heading', { name: 'Follow-up health', level: 2 })).toBeVisible();
  await expect(cards.nth(1)).toContainText('Evidence expiring in 30 days');
  await add(/^Key figures/);
  await expect(page.getByRole('group', { name: /key figures: choose a figure/i })).toBeVisible();

  // the period switch is a view setting in the URL
  await page.getByRole('link', { name: '6 months' }).click();
  await expect(page).toHaveURL(/months=6/);
  await expect(page.getByRole('link', { name: '6 months' })).toHaveAttribute(
    'aria-current',
    'true',
  );

  // edit the title, move it earlier, remove it
  await page.getByRole('button', { name: 'Options for Follow-up health' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await dialog.getByLabel('Title').fill('Needs chasing');
  await dialog.getByRole('button', { name: 'Save widget' }).click();
  await expect(page.getByRole('heading', { name: 'Needs chasing', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Options for Needs chasing' }).click();
  await page.getByRole('menuitem', { name: 'Move earlier' }).click();
  await expect(cards.first()).toContainText('Needs chasing');
  await page.getByRole('button', { name: 'Options for Needs chasing' }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(page.getByRole('heading', { name: 'Needs chasing' })).toHaveCount(0);
  await expect(cards).toHaveCount(2);

  // rename, then delete
  await page.getByRole('button', { name: 'Dashboard options' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await dialog.getByLabel('Name').fill(`${name} renamed`);
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('heading', { name: `${name} renamed`, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Dashboard options' }).click();
  await page.getByRole('menuitem', { name: 'Delete dashboard' }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(/\/meridian\/dashboards/);
  await expect(page.getByRole('link', { name: `${name} renamed` })).toHaveCount(0);
});
