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

  await pumpA.getByLabel(/^Move .+-001 to stage$/).selectOption({ label: 'Working on it' });
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
