import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  addAutomation,
  makeSheet,
  nextAnswer,
  pickStatus,
  runsOf,
  seedItems,
  STATUS,
  type Sheet,
} from './automation-helpers';
import { rest, signIn } from './helpers';

// M8: the Automations page, the builder, recipes, the run log, the sheet's automations side sheet and per-item pauses
// (docs/04 §10–§11). Uses the seed (pnpm seed): maria@example.com owner, james@example.com editor and
// vic@example.com viewer of /meridian. Every sheet is new and has its own ID prefix.

test.describe.configure({ mode: 'default' });
test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop builder'));

const tag = () => randomUUID().slice(0, 6);

type AutomationRow = {
  id: string;
  name: string;
  enabled: boolean;
  source: string;
  trigger: Record<string, unknown>;
  actions: Record<string, unknown>[];
};
const automationsOf = (page: Page, sheet: Sheet) =>
  rest<AutomationRow[]>(
    page,
    `automations?sheet_id=eq.${sheet.id}&select=id,name,enabled,source,trigger,actions&order=created_at`,
  );

/** Pick a status in the value picker's popover and wait for the popover to be gone. */
async function pickOption(page: Page, listbox: string, option: string) {
  await page.getByRole('listbox', { name: listbox }).getByRole('option', { name: option }).click();
  await expect(page.getByRole('listbox', { name: listbox })).toHaveCount(0);
}

test('build "When Status becomes Done → set a date to Today and lock" in the builder; it runs on the next edit', async ({
  page,
}) => {
  await signIn(page, 'james@example.com');
  const sheet = await makeSheet(page, `Builder ${tag()}`, [
    { key: 'status', name: 'Status', type: 'status', config: STATUS },
    { key: 'closed_on', name: 'Closed on', type: 'date', config: { relative: false } },
    { key: 'owner', name: 'Owner', type: 'people', config: { multiple: true } },
  ]);
  const items = await seedItems(page, sheet, [{ name: 'Pump A' }]);

  await page.goto(`/meridian/automations?new=1&sheet=${sheet.id}`);
  await expect(page.getByRole('heading', { name: 'New automation' })).toBeVisible();
  await page
    .getByLabel('Trigger', { exact: true })
    .selectOption({ label: 'a field becomes a value' });
  await page.getByLabel('Trigger field').selectOption({ label: 'Status' });
  await page.getByRole('button', { name: /^Trigger value/ }).click();
  await pickOption(page, 'Status', 'Done');

  await page.getByLabel('Action 1 type').selectOption({ label: 'set a field' });
  await page.getByLabel('Action 1 field').selectOption({ label: 'Closed on' });
  await page.getByRole('button', { name: /^Action 1 value/ }).click();
  const relative = page.getByRole('group', { name: 'Values that change' });
  await relative.getByRole('button', { name: 'Today, the day it runs' }).click();
  await expect(relative).toHaveCount(0);

  await page.getByRole('button', { name: 'Add an action' }).click();
  await page.getByLabel('Action 2 type').selectOption({ label: 'lock the item' });
  await page.getByLabel('Action 2 reason').fill('Closed');
  const name = 'When Status becomes Done → set Closed on to Today and lock';
  await expect(page.getByLabel('Name')).toHaveAttribute('placeholder', name);

  // Test on an item plans the steps and writes nothing
  await page.getByLabel('Item to test on').selectOption(items['Pump A']!);
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  const result = page.getByRole('region', { name: 'Test result' });
  await expect(result.getByText('Would not run on')).toBeVisible();
  await expect(result.getByText('Does not match')).toBeVisible();
  await expect(result.getByText(/^Set Closed on to \d{1,2} \w{3} \d{4}$/)).toBeVisible();
  await expect(result.getByText('Lock the item: Closed')).toBeVisible();
  const [untouched] = await rest<{ locked: boolean; values: Record<string, unknown> }[]>(
    page,
    `items?id=eq.${items['Pump A']}&select=locked,values`,
  );
  expect(untouched).toEqual({ locked: false, values: {} });
  expect(await rest(page, `automation_runs?sheet_id=eq.${sheet.id}&select=id`)).toEqual([]);

  await page.getByRole('button', { name: 'Save and turn on' }).click();
  await expect(page.getByText('Automation saved and turned on.')).toBeVisible();
  await expect(page.getByRole('switch', { name })).toBeChecked();
  const [saved] = await automationsOf(page, sheet);
  expect(saved).toMatchObject({
    name,
    enabled: true,
    source: 'custom',
    trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_done' },
    actions: [
      { type: 'set_field', fieldKey: 'closed_on', value: '$today' },
      { type: 'lock_item', reason: 'Closed' },
    ],
  });

  // it runs when the item is edited
  await page.goto(sheet.url);
  await pickStatus(page, sheet, 'Pump A', 'Done');
  await expect(
    page.getByText(
      new RegExp(`^${name}: Set Closed on to \\d{1,2} \\w{3} \\d{4} · Lock the item: Closed$`),
    ),
  ).toBeVisible();
  await expect(sheet.cell(page, 'Pump A', 'Closed on')).toContainText(/\d/);
  const [after] = await rest<{ locked: boolean }[]>(
    page,
    `items?id=eq.${items['Pump A']}&select=locked`,
  );
  expect(after!.locked).toBe(true);
  expect((await runsOf(page, saved!.id)).map((r) => r.status)).toEqual(['done']);
});

test('the builder refuses an automation that would trigger itself', async ({ page }) => {
  await signIn(page, 'james@example.com');
  const sheet = await makeSheet(page, `Loop ${tag()}`, [
    { key: 'status', name: 'Status', type: 'status', config: STATUS },
  ]);
  await page.goto(`/meridian/automations?new=1&sheet=${sheet.id}`);
  await page.getByLabel('Trigger', { exact: true }).selectOption({ label: 'a field changes' });
  await page.getByLabel('Trigger field').selectOption({ label: 'Status' });
  await page.getByLabel('Action 1 type').selectOption({ label: 'set a field' });
  await page.getByLabel('Action 1 field').selectOption({ label: 'Status' });
  await expect(page.getByText(/^This would trigger itself/)).toBeVisible();
  await page.getByRole('button', { name: 'Save and turn on' }).click();
  await expect(page.getByText('Fix the highlighted parts first.')).toBeVisible();
  expect(await automationsOf(page, sheet)).toEqual([]);
});

test('start from a recipe, map its roles to fields, fill the rest and save', async ({ page }) => {
  await signIn(page, 'james@example.com');
  const sheet = await makeSheet(page, `Recipe ${tag()}`, [
    { key: 'state', name: 'State', type: 'status', config: STATUS },
    { key: 'owner', name: 'Owner', type: 'people', config: { multiple: true } },
    { key: 'reviewer', name: 'Reviewer', type: 'people', config: { multiple: true } },
  ]);
  await page.goto(`/meridian/automations?sheet=${sheet.id}`);
  await page.getByRole('link', { name: 'Start from a recipe' }).click();
  await page
    .getByRole('radio', { name: /When status changes to something, notify someone/ })
    .check();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(
    page.getByRole('heading', { name: 'Choose the fields this recipe uses' }),
  ).toBeVisible();
  await expect(page.getByLabel('status field')).toHaveValue('state');
  await expect(page.getByLabel('person field')).toHaveValue('owner');
  await page.getByLabel('person field').selectOption({ label: 'Reviewer' });
  await page.getByRole('button', { name: 'Continue in the builder' }).click();

  // the recipe leaves the status to reach open: saving asks for it
  await page.getByRole('button', { name: 'Save and turn on' }).click();
  await expect(page.getByText('Choose a value.')).toBeVisible();
  await page.getByRole('button', { name: /^Trigger value/ }).click();
  await pickOption(page, 'State', 'Stuck');
  await expect(page.getByLabel('Action 1 message')).toHaveValue('{id} {name} is now {state}.');
  await page.getByRole('button', { name: 'Save and turn on' }).click();
  await expect(page.getByText('Automation saved and turned on.')).toBeVisible();

  const [saved] = await automationsOf(page, sheet);
  expect(saved).toMatchObject({
    name: 'When State becomes Stuck → notify Reviewer',
    source: 'template:status-notify',
    trigger: { type: 'field_becomes', fieldKey: 'state', value: 'opt_stuck' },
    actions: [{ type: 'notify', to: ['field:reviewer'], message: '{id} {name} is now {state}.' }],
  });
  await expect(page.getByText('Recipe · v1')).toBeVisible();
});

test('turning an automation off stops it; duplicate and delete', async ({ page }) => {
  await signIn(page, 'james@example.com');
  const sheet = await makeSheet(page, `Toggle ${tag()}`, [
    { key: 'status', name: 'Status', type: 'status', config: STATUS },
  ]);
  const id = await addAutomation(page, sheet, {
    name: 'Post on done',
    trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_done' },
    actions: [{ type: 'post_update', message: 'Done: {name}' }],
  });
  await seedItems(page, sheet, [{ name: 'Valve' }]);

  await page.goto(`/meridian/automations?sheet=${sheet.id}`);
  const toggle = page.getByRole('switch', { name: 'Post on done' });
  await expect(toggle).toBeChecked();
  const answered = nextAnswer(page);
  await toggle.click();
  await answered;
  await expect(page.getByText('“Post on done” is off. It will not run.')).toBeVisible();
  await expect(toggle).not.toBeChecked();

  await page.goto(sheet.url);
  await pickStatus(page, sheet, 'Valve', 'Done');
  expect(await runsOf(page, id)).toEqual([]);

  await page.goto(`/meridian/automations?sheet=${sheet.id}`);
  await page.getByRole('button', { name: 'More actions for Post on done' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.getByText('Copy saved. It is off until you turn it on.')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Copy of Post on done' })).not.toBeChecked();
  await expect(page.getByRole('menu')).toHaveCount(0);

  await page.getByRole('button', { name: 'More actions for Copy of Post on done' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(
    page.getByText('“Copy of Post on done” deleted. Its runs stay in the run log.'),
  ).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Copy of Post on done' })).toHaveCount(0);
  expect((await automationsOf(page, sheet)).map((a) => [a.name, a.enabled])).toEqual([
    ['Post on done', false],
  ]);
});

test('the run log lists runs with their steps, links to the item and filters by outcome', async ({
  page,
}) => {
  await signIn(page, 'james@example.com');
  const sheet = await makeSheet(page, `Runs ${tag()}`, [
    { key: 'status', name: 'Status', type: 'status', config: STATUS },
  ]);
  await addAutomation(page, sheet, {
    name: 'Post on done',
    trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_done' },
    actions: [{ type: 'post_update', message: 'Done: {name}' }],
  });
  await addAutomation(page, sheet, {
    name: 'Broken follow-up',
    trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_done' },
    actions: [{ type: 'create_item', sheetId: null, name: 'Follow-up: {name}', link: true }],
  });
  await seedItems(page, sheet, [{ name: 'Gasket' }]);
  await page.goto(sheet.url);
  await pickStatus(page, sheet, 'Gasket', 'Done');
  await expect(page.getByText(/^Post on done: Post an update$/)).toBeVisible();

  await page.goto(`/meridian/automations?tab=runs&sheet=${sheet.id}`);
  const runs = page
    .getByRole('list', { name: 'Runs' })
    .getByRole('listitem')
    .filter({ hasText: 'Gasket' });
  await expect(runs).toHaveCount(2);
  const done = runs.filter({ hasText: 'Post on done' });
  await expect(done.getByText('Done', { exact: true })).toBeVisible();
  await expect(done.getByRole('link', { name: /Gasket/ })).toHaveAttribute(
    'href',
    new RegExp(`/meridian/s/${sheet.id}\\?item=${sheet.idPrefix}001$`),
  );
  await done.getByRole('button', { name: '1 step' }).click();
  await expect(done.getByRole('button', { name: '1 step' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(done.getByRole('list', { name: 'Steps' }).getByText('Post an update')).toBeVisible();

  await page.getByLabel('Outcome').selectOption({ label: 'Failed' });
  await expect(runs).toHaveCount(1);
  await expect(runs.first()).toContainText('Broken follow-up');
  await expect(runs.first()).toContainText('Choose the sheet to create on.');
  await expect(page).toHaveURL(/outcome=failed/);
});

test('the sheet header opens this sheet’s automations in a side sheet', async ({ page }) => {
  await signIn(page, 'james@example.com');
  const sheet = await makeSheet(page, `Side ${tag()}`, [
    { key: 'status', name: 'Status', type: 'status', config: STATUS },
  ]);
  await addAutomation(page, sheet, {
    name: 'Post on done',
    trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_done' },
    actions: [{ type: 'post_update', message: 'Done' }],
  });
  await page.goto(sheet.url);
  const button = page.getByRole('button', { name: /^Automations/ });
  await expect(button).toHaveAccessibleName('Automations 1');
  await button.click();
  const side = page.getByRole('dialog', { name: 'Automations' });
  await expect(side.getByRole('switch', { name: 'Post on done' })).toBeChecked();
  await expect(side.getByText('When Status becomes Done')).toBeVisible();
  await expect(side.getByRole('link', { name: 'New automation' })).toHaveAttribute(
    'href',
    `/meridian/automations?new=1&sheet=${sheet.id}`,
  );
  await side.getByRole('link', { name: 'Post on done' }).click();
  await expect(page.getByRole('heading', { name: 'Edit automation' })).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveValue('Post on done');
});

test('pausing an automation on one item: it skips that item and runs for another', async ({
  page,
}) => {
  await signIn(page, 'james@example.com');
  const sheet = await makeSheet(page, `Pause ${tag()}`, [
    { key: 'status', name: 'Status', type: 'status', config: STATUS },
  ]);
  const id = await addAutomation(page, sheet, {
    name: 'Post on done',
    trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_done' },
    actions: [{ type: 'post_update', message: 'Done' }],
  });
  const items = await seedItems(page, sheet, [{ name: 'First pump' }, { name: 'Second pump' }]);

  await page.goto(`${sheet.url}&item=${sheet.idPrefix}001`);
  const panel = page.getByRole('dialog', { name: /First pump/ });
  const pause = panel.getByRole('switch', { name: 'Run “Post on done” on this item' });
  await expect(pause).toBeChecked();
  const answered = nextAnswer(page);
  await pause.click();
  await answered;
  await expect(
    page.getByText(/“Post on done” is paused for .+-001\. It still runs on other items\./),
  ).toBeVisible();
  await expect(pause).not.toBeChecked();
  await expect(panel.getByText(/^Paused for this item/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  await pickStatus(page, sheet, 'First pump', 'Done');
  await pickStatus(page, sheet, 'Second pump', 'Done');
  await expect(page.getByText(/^Post on done: Post an update$/)).toBeVisible();
  const runs = await rest<{ item_id: string }[]>(
    page,
    `automation_runs?automation_id=eq.${id}&select=item_id`,
  );
  expect(runs).toEqual([{ item_id: items['Second pump'] }]);
  const log = await rest<{ action: string; note: string }[]>(
    page,
    `activity_log?item_id=eq.${items['First pump']}&action=eq.automation.paused&select=action,note`,
  );
  expect(log).toEqual([{ action: 'automation.paused', note: 'Post on done' }]);
});

test('a viewer sees read-only automation lists', async ({ page, browser }) => {
  await signIn(page, 'james@example.com');
  const sheet = await makeSheet(page, `Viewer ${tag()}`, [
    { key: 'status', name: 'Status', type: 'status', config: STATUS },
  ]);
  await addAutomation(page, sheet, {
    name: 'Post on done',
    trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_done' },
    actions: [{ type: 'post_update', message: 'Done' }],
  });
  await seedItems(page, sheet, [{ name: 'Seen' }]);

  const vic = await browser.newPage();
  await signIn(vic, 'vic@example.com');
  await vic.goto(`/meridian/automations?sheet=${sheet.id}`);
  await expect(
    vic.getByText('You can see automations and their runs. Ask an editor or admin to change them.'),
  ).toBeVisible();
  await expect(vic.getByRole('switch', { name: 'Post on done' })).toBeDisabled();
  await expect(vic.getByRole('link', { name: 'New automation' })).toHaveCount(0);
  await expect(vic.getByRole('link', { name: 'Start from a recipe' })).toHaveCount(0);
  await expect(vic.getByRole('button', { name: 'More actions for Post on done' })).toHaveCount(0);
  await expect(vic.getByRole('link', { name: 'Post on done' })).toHaveCount(0);

  await vic.goto(`/meridian/automations?new=1&sheet=${sheet.id}`);
  await expect(
    vic.getByText('Viewers cannot change automations. Ask an editor or admin.'),
  ).toBeVisible();

  await vic.goto(`${sheet.url}&item=${sheet.idPrefix}001`);
  await expect(vic.getByRole('switch', { name: 'Run “Post on done” on this item' })).toBeDisabled();
  await vic.close();
});
