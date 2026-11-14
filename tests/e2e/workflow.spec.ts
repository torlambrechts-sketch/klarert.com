import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { addAutomation, makeSheet, nextAnswer, seedItems, STATUS } from './automation-helpers';
import { rest, signIn } from './helpers';

// The workflow page (docs/05 §4): one row per sheet, opened in place to its steps (the stage field's options);
// Running now lists the items that are not done and moves them through setValues, so status rules (a comment) and
// automations apply. Uses the seed (pnpm seed): james@example.com is an editor of /meridian.

test('a sheet opens to its steps; Running now moves items, asks for a comment and runs automations', async ({
  page,
}) => {
  await signIn(page, 'james@example.com');
  const name = `Lifecycle ${randomUUID().slice(0, 6)}`;
  const sheet = await makeSheet(page, name, [
    {
      key: 'status',
      name: 'Status',
      type: 'status',
      config: STATUS,
      rules: [
        { id: 'r1', whenFieldKey: 'status', whenValues: ['opt_stuck'], requireComment: true },
      ],
    },
  ]);
  await addAutomation(page, sheet, {
    name: 'Post when stuck',
    trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_stuck' },
    actions: [{ type: 'post_update', message: 'Stuck: {name}' }],
  });
  const items = await seedItems(page, sheet, [
    { name: 'Pump A', values: { [sheet.field('status')]: 'opt_todo' } },
    { name: 'Pump B', values: { [sheet.field('status')]: 'opt_done' } },
  ]);

  await page.goto(`/meridian/workflow?sheet=${sheet.id}`);
  await expect(page.getByRole('heading', { name: 'Workflow', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: `Steps of ${name}` })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  const steps = page.getByRole('list', { name: `${name} steps` });
  await expect(steps.getByRole('listitem')).toHaveCount(4);
  await expect(steps.getByRole('listitem').nth(2)).toContainText('Stuck');
  await expect(steps.getByRole('listitem').nth(2)).toContainText('Comment required');
  await expect(steps.getByRole('listitem').nth(2)).toContainText('Post when stuck');

  // the search keeps only matching sheets
  await page.getByLabel('Search workflows').fill(name);
  await expect(page.getByTestId('workflow-row')).toHaveCount(1);

  // Running now: Pump A is not done, Pump B is
  const running = page.getByRole('list', { name: 'Running now' });
  const pumpA = running
    .getByRole('listitem')
    .filter({ hasText: name })
    .filter({ hasText: 'Pump A' });
  await expect(pumpA).toContainText(`${name} · Not started`);
  await expect(
    running.getByRole('listitem').filter({ hasText: name }).filter({ hasText: 'Pump B' }),
  ).toHaveCount(0);

  const moved = nextAnswer(page);
  await pumpA.getByLabel(/^Move .+-001 to stage$/).selectOption({ label: 'Working on it' });
  await moved;
  await expect(pumpA).toContainText(`${name} · Working on it`);

  // Stuck needs a comment; then the automation runs
  await pumpA.getByLabel(/^Move .+-001 to stage$/).selectOption({ label: 'Stuck' });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').fill('Waiting for a seal');
  const answered = nextAnswer(page);
  await dialog.getByRole('button', { name: 'Save with comment' }).click();
  await answered;
  await expect(page.getByText(/^Post when stuck: Post an update$/)).toBeVisible();
  await expect(pumpA).toContainText(`${name} · Stuck`);

  const [row] = await rest<{ values: Record<string, unknown> }[]>(
    page,
    `items?id=eq.${items['Pump A']}&select=values`,
  );
  expect(row!.values[sheet.field('status')]).toBe('opt_stuck');
});

// A workspace can have tens of thousands of open items (docs/05 §4): Running now and a stage's items keep only the
// rows near the viewport in the page, each row knows its place in the whole list, and the keyboard still reaches
// every row (tabbing scrolls the next rows into the page).
test('Running now with hundreds of items: only nearby rows are in the page; Tab reaches the rest', async ({
  page,
}) => {
  await signIn(page, 'james@example.com');
  const name = `Backlog ${randomUUID().slice(0, 6)}`;
  const sheet = await makeSheet(page, name, [
    { key: 'status', name: 'Status', type: 'status', config: STATUS },
  ]);
  const count = 400;
  await seedItems(
    page,
    sheet,
    Array.from({ length: count }, (_, i) => ({
      name: `Task ${i + 1}`,
      values: { [sheet.field('status')]: 'opt_todo' },
    })),
  );

  await page.goto(`/meridian/workflow?sheet=${sheet.id}`);
  await page.getByLabel('Search workflows').fill(name);
  await expect(page.getByTestId('workflow-row')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Running now' })).toContainText(
    `Workflows matching “${name}” · ${count} items not done`,
  );
  const running = page.getByRole('list', { name: 'Running now' });
  const rows = running.getByRole('listitem');
  await expect(rows.first()).toHaveAttribute('aria-posinset', '1');
  await expect(rows.first()).toHaveAttribute('aria-setsize', String(count));
  const shown = await rows.count();
  expect(shown).toBeGreaterThan(5);
  expect(shown).toBeLessThan(80);

  // the keyboard: each row has its stage picker and Open; Tab from the first row's Open walks down the list
  await running.getByRole('link', { name: /^Open .+-001 Task 1$/ }).focus();
  for (let i = 0; i < 2 * 60; i += 1) await page.keyboard.press('Tab');
  await expect(running.getByRole('link', { name: /^Open .+-061 Task 61$/ })).toBeFocused();
  expect(await rows.count()).toBeLessThan(count);

  // the end of the list is in the page once it is scrolled to
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(running.getByRole('link', { name: /^Open .+-400 Task 400$/ })).toBeVisible();

  // a stage's own item list is just as light
  await page
    .getByRole('list', { name: `${name} steps` })
    .getByRole('button', { name: 'Items in Not started' })
    .click();
  const stage = page.getByRole('list', { name: 'Items in Not started' });
  await expect(stage.getByRole('listitem').first()).toHaveAttribute('aria-setsize', String(count));
  expect(await stage.getByRole('listitem').count()).toBeLessThan(80);
});
