import { expect, test, type Page } from '@playwright/test';
import { rest, signIn } from './helpers';

// M4: the Table view's grid interactions and the command layer. Uses the seed (pnpm seed): maria@example.com owner, james@example.com
// editor, vic@example.com viewer of /meridian. Each test creates its own sheet from the Tracker start
// (Owner people, Status, Priority severity, Due date, Progress percent; groups Open and Done).

test.describe.configure({ mode: 'default' });
test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop grid'));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function trackerSheet(page: Page, name = `Grid ${unique()}`) {
  await page.goto('/meridian/s/new?start=tracker');
  await page.getByLabel('Sheet name').fill(name);
  await expect(page.getByLabel('ID prefix')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Create sheet' }).click();
  await expect(page).toHaveURL(/\/meridian\/s\/[0-9a-f-]{36}$/);
  const url = `${page.url()}?view=table`;
  await page.goto(url);
  await expect(page.getByRole('grid')).toBeVisible();
  return url;
}

const grid = (page: Page) => page.getByRole('grid');
const cell = (page: Page, item: string, column: string) =>
  grid(page)
    .getByRole('row')
    .filter({ has: page.getByRole('gridcell', { name: item, exact: false }) })
    .getByRole('gridcell')
    .nth(columnIndex[column] ?? 0);
// Tracker columns after the name: Owner, Status, Priority, Due date, Progress
const columnIndex: Record<string, number> = {
  name: 0,
  Owner: 1,
  Status: 2,
  Priority: 3,
  'Due date': 4,
  Progress: 5,
};

async function addItems(page: Page, group: string, names: string[]) {
  const input = page.getByRole('textbox', { name: `Add task to ${group}` });
  await input.click();
  for (const n of names) {
    await input.fill(n);
    await input.press('Enter');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
  }
  for (const n of names) await expect(grid(page).getByText(n, { exact: true })).toBeVisible();
  // saved: no row still waits for its id
  await expect(grid(page).locator('[id^="cell-temp-"]')).toHaveCount(0);
}

test('editor adds items with Enter to continue and edits cells with the keyboard', async ({
  page,
}) => {
  await signIn(page, 'james@example.com');
  await trackerSheet(page);
  await addItems(page, 'Open', ['Fix guard rail', 'Replace eye-wash', 'Calibrate scale']);
  await expect(page.getByRole('heading', { name: /^Open\s*3 items/ })).toBeVisible();

  // name → Owner: arrows move, Enter edits
  await cell(page, 'Fix guard rail', 'name').click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const people = page.getByRole('listbox', { name: 'Owner' });
  await expect(people).toBeVisible();
  await page.keyboard.press('Enter'); // first person is me (James)
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(cell(page, 'Fix guard rail', 'Owner')).toContainText('James');

  // Status: Enter, arrows, Enter
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox', { name: 'Status' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'Fix guard rail', 'Status')).toContainText('Working on it');

  // Due date: type a UK date
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Due date' }).fill('20/11/2030');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'Fix guard rail', 'Due date')).toContainText('20 Nov');

  // Progress (percent): a bad value is refused in the editor, then a number saves
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const progress = page.getByRole('textbox', { name: 'Progress' });
  await progress.fill('lots');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'from 0 to 100' })).toBeVisible();
  await progress.fill('40');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'Fix guard rail', 'Progress')).toContainText('40%');

  // Esc cancels an edit; Delete clears
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Progress' }).fill('99');
  await page.keyboard.press('Escape');
  await expect(cell(page, 'Fix guard rail', 'Progress')).toContainText('40%');
  await page.keyboard.press('Delete');
  await expect(page.getByText('1 cell cleared')).toBeVisible();
  await expect(cell(page, 'Fix guard rail', 'Progress')).not.toContainText('40%');

  // the values were saved: reload shows them
  await page.reload();
  await expect(cell(page, 'Fix guard rail', 'Status')).toContainText('Working on it');
  await expect(cell(page, 'Fix guard rail', 'Due date')).toContainText('20 Nov');
});

const sheetIdOf = (url: string) => url.match(/\/s\/([0-9a-f-]{36})/)![1]!;

async function columnSettings(page: Page, column: string) {
  await grid(page)
    .getByRole('button', { name: `${column} column menu` })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  return page.getByRole('dialog');
}

/** Paste through the grid's paste handler, as Ctrl+V does. */
async function paste(page: Page, text: string) {
  await page.getByRole('grid').evaluate((el, t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, text);
}

async function copy(page: Page) {
  return page.getByRole('grid').evaluate((el) => {
    const dt = new DataTransfer();
    el.dispatchEvent(
      new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    return dt.getData('text/plain');
  });
}

test('paste TSV from a spreadsheet reports skipped cells, and copy gives TSV back', async ({
  page,
}) => {
  await signIn(page, 'james@example.com');
  await trackerSheet(page);
  await addItems(page, 'Open', ['Alpha', 'Bravo', 'Charlie']);
  await cell(page, 'Alpha', 'Status').click();
  await paste(page, 'Done\tHigh\t20/11/2030\nStuck\tLow\tsoon\nWorking on it\tCritical\t46346\n');
  await expect(page.getByText('8 cells pasted, 1 skipped: not a date')).toBeVisible();
  await expect(cell(page, 'Alpha', 'Status')).toContainText('Done');
  await expect(cell(page, 'Bravo', 'Priority')).toContainText('Low');
  await expect(cell(page, 'Bravo', 'Due date')).not.toContainText(/\d/);
  await expect(cell(page, 'Charlie', 'Due date')).toContainText('20 Nov');

  // shift-click selects a range; copy gives TSV
  await cell(page, 'Alpha', 'Status').click();
  await cell(page, 'Bravo', 'Priority').click({ modifiers: ['Shift'] });
  expect(await copy(page)).toBe('Done\tHigh\nStuck\tLow');
  await page.reload();
  await expect(cell(page, 'Charlie', 'Status')).toContainText('Working on it');
});

test('status rules block until the field is filled; comment on value posts an update', async ({
  page,
}) => {
  await signIn(page, 'james@example.com');
  const url = await trackerSheet(page);
  await addItems(page, 'Open', ['Leaking valve']);

  const settings = await columnSettings(page, 'Status');
  await settings.getByRole('button', { name: 'Add rule' }).click();
  const rule1 = settings.getByRole('group', { name: 'Rule 1' });
  await rule1.getByRole('checkbox', { name: 'Done' }).check();
  await rule1.getByRole('checkbox', { name: 'Due date' }).check();
  await rule1.getByLabel('Message when blocked').fill('Add the due date before closing.');
  await settings.getByRole('button', { name: 'Add rule' }).click();
  const rule2 = settings.getByRole('group', { name: 'Rule 2' });
  await rule2.getByRole('checkbox', { name: 'Stuck' }).check();
  await rule2.getByRole('checkbox', { name: 'Ask for a comment' }).check();
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Field settings saved.')).toBeVisible();

  // Done is blocked while Due date is empty
  await cell(page, 'Leaking valve', 'Status').click();
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: /Done/ }).click();
  await expect(page.getByText('Add the due date before closing.')).toBeVisible();
  await expect(cell(page, 'Leaking valve', 'Status')).not.toContainText('Done');

  // fill the date, then Done passes
  await cell(page, 'Leaking valve', 'Due date').click();
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Due date' }).fill('1 Dec 2030');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'Leaking valve', 'Due date')).toContainText('1 Dec');
  await cell(page, 'Leaking valve', 'Status').click();
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: /Done/ }).click();
  await expect(cell(page, 'Leaking valve', 'Status')).toContainText('Done');

  // Stuck asks for a comment
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: /Stuck/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a comment' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Comment').fill('Waiting for the supplier.');
  await dialog.getByRole('button', { name: 'Save with comment' }).click();
  await expect(page.getByText('Saved with your comment.')).toBeVisible();
  await expect(cell(page, 'Leaking valve', 'Status')).toContainText('Stuck');

  // the comment is an update on the item and the note of the activity entry
  const sheetId = sheetIdOf(url);
  const [item] = await rest<{ id: string }[]>(page, `items?sheet_id=eq.${sheetId}&select=id`);
  const updates = await rest<{ body: string; kind: string }[]>(
    page,
    `item_updates?item_id=eq.${item!.id}&select=body,kind`,
  );
  expect(updates).toEqual([{ body: 'Waiting for the supplier.', kind: 'update' }]);
  const log = await rest<{ note: string }[]>(
    page,
    `activity_log?item_id=eq.${item!.id}&action=eq.value.changed&note=not.is.null&select=note`,
  );
  expect(log.map((l) => l.note)).toContain('Waiting for the supplier.');
});

test('add a field from the picker, change its settings and change its type with a preview', async ({
  page,
}) => {
  await signIn(page, 'james@example.com');
  await trackerSheet(page);
  await addItems(page, 'Open', ['One', 'Two']);

  await grid(page).getByRole('button', { name: 'Add a field' }).first().click();
  await page.getByRole('button', { name: 'Number', exact: true }).click();
  await expect(page.getByLabel('Field name')).toHaveValue('Number');
  await page.getByRole('button', { name: 'Add field' }).click();
  await expect(page.getByText('Field added.')).toBeVisible();
  await expect(
    grid(page).getByRole('button', { name: 'Number column menu' }).first(),
  ).toBeVisible();

  const settings = await columnSettings(page, 'Number');
  await settings.getByLabel('Field name').fill('Score');
  await settings.getByLabel('Unit').fill('pts');
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Field settings saved.')).toBeVisible();
  await expect(grid(page).getByRole('button', { name: 'Score column menu' }).first()).toBeVisible();

  const scoreCell = (item: string) =>
    grid(page).getByRole('row').filter({ hasText: item }).getByRole('gridcell').nth(6);
  await scoreCell('One').click();
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Score' }).fill('3');
  await page.keyboard.press('Enter');
  await expect(scoreCell('One')).toContainText('3 pts');
  await scoreCell('Two').click();
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Score' }).fill('12');
  await page.keyboard.press('Enter');
  await expect(scoreCell('Two')).toContainText('12 pts');

  const again = await columnSettings(page, 'Score');
  await again.getByLabel('Change type to').selectOption({ label: 'Rating' });
  await again.getByRole('button', { name: 'Preview' }).click();
  await expect(again.getByText('2 of 2 values convert')).toBeVisible();
  await again.getByRole('button', { name: 'Change type' }).click();
  await expect(page.getByText('Type changed.')).toBeVisible();
  await expect(scoreCell('One').getByRole('img', { name: '3 of 5 stars' })).toBeVisible();
  await expect(scoreCell('Two').getByRole('img', { name: '5 of 5 stars' })).toBeVisible();
});

test('bulk archive with Undo, and dragging a row to another group', async ({ page }) => {
  await signIn(page, 'james@example.com');
  await trackerSheet(page);
  await addItems(page, 'Open', ['Keep me', 'Archive A', 'Archive B']);

  await page.getByRole('checkbox', { name: 'Select Archive A' }).check();
  await page.getByRole('checkbox', { name: 'Select Archive B' }).click({ modifiers: ['Shift'] });
  const bar = page.getByRole('region', { name: 'Selected items' });
  await expect(bar).toContainText('2 selected');
  await bar.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.getByText('2 items archived.')).toBeVisible();
  await expect(grid(page).getByText('Archive A')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('2 items restored.')).toBeVisible();
  await expect(grid(page).getByText('Archive A', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Open\s*3 items/ })).toBeVisible();

  // drag "Keep me" into Done
  const handle = page.getByRole('button', { name: 'Drag Keep me to move it' });
  const target = page.getByRole('textbox', { name: 'Add task to Done' });
  const from = (await handle.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 5 });
  await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect(page.getByText('Moved to Done.')).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Done\s*1 item/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /^Done\s*1 item/ })).toBeVisible();
});

test('a viewer sees a read-only grid', async ({ page, browser }) => {
  await signIn(page, 'james@example.com');
  const url = await trackerSheet(page);
  await addItems(page, 'Open', ['Visible to all']);

  const vic = await browser.newPage();
  await signIn(vic, 'vic@example.com');
  await vic.goto(url);
  await expect(
    vic.getByText('You can view this sheet. Ask an editor or admin to change it.').first(),
  ).toBeVisible();
  await expect(vic.getByRole('grid').getByText('Visible to all', { exact: true })).toBeVisible();
  await expect(vic.getByRole('textbox', { name: /Add task/ })).toHaveCount(0);
  await expect(vic.getByRole('checkbox', { name: 'Select Visible to all' })).toHaveCount(0);
  await expect(vic.getByRole('button', { name: 'Add a field' })).toHaveCount(0);
  await expect(vic.getByRole('button', { name: /^New task/ })).toHaveCount(0);
  await cell(vic, 'Visible to all', 'Status').click();
  await vic.keyboard.press('Enter');
  await expect(vic.getByRole('listbox', { name: 'Status' })).toHaveCount(0);
  await vic.close();
});

test('a locked item blocks an editor but not an admin', async ({ page, browser }) => {
  await signIn(page, 'maria@example.com');
  const url = await trackerSheet(page);
  await addItems(page, 'Open', ['Approved policy']);
  await page.getByRole('checkbox', { name: 'Select Approved policy' }).check();
  await page
    .getByRole('region', { name: 'Selected items' })
    .getByRole('button', { name: 'Actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Lock' }).click();
  await page.getByLabel('Reason').fill('Approved by QA');
  await page.getByRole('dialog').getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByText('Item locked.')).toBeVisible();

  const james = await browser.newPage();
  await signIn(james, 'james@example.com');
  await james.goto(url);
  await expect(james.getByRole('grid').getByText('Locked: Approved by QA')).toBeAttached();
  await cell(james, 'Approved policy', 'Status').click();
  await james.keyboard.press('Enter');
  await expect(
    james.getByText('This item is locked: Approved by QA. Only owners and admins can change it.'),
  ).toBeVisible();
  await expect(james.getByRole('listbox', { name: 'Status' })).toHaveCount(0);
  await james.close();

  // the admin can still change it
  await cell(page, 'Approved policy', 'Status').click();
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: /Working on it/ }).click();
  await expect(cell(page, 'Approved policy', 'Status')).toContainText('Working on it');
  await page.reload();
  await expect(cell(page, 'Approved policy', 'Status')).toContainText('Working on it');
});

test('a second person sees a cell edit through realtime', async ({ page, browser }) => {
  await signIn(page, 'james@example.com');
  const url = await trackerSheet(page);
  await addItems(page, 'Open', ['Shared item']);

  const maria = await browser.newPage();
  await signIn(maria, 'maria@example.com');
  await maria.goto(url);
  await expect(maria.getByRole('grid').getByText('Shared item', { exact: true })).toBeVisible();
  await expect(maria.getByText('live updates paused')).toHaveCount(0);
  await maria.waitForTimeout(1500); // let the realtime channel join

  await cell(page, 'Shared item', 'Status').click();
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: /Stuck/ }).click();
  await expect(cell(page, 'Shared item', 'Status')).toContainText('Stuck');
  await expect(cell(maria, 'Shared item', 'Status')).toContainText('Stuck', { timeout: 10_000 });

  // a new item appears too
  await addItems(page, 'Open', ['Second item']);
  await expect(maria.getByRole('grid').getByText('Second item', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await maria.close();
});

test('a sheet of 10 000 items and 30 fields scrolls without errors', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, 'james@example.com');
  const url = await trackerSheet(page, `Big ${unique()}`);
  const sheetId = sheetIdOf(url);
  const [group] = await rest<{ id: string }[]>(
    page,
    `groups?sheet_id=eq.${sheetId}&order=position&limit=1&select=id`,
  );
  const [{ org_id }] = await rest<[{ org_id: string }]>(
    page,
    `sheets?id=eq.${sheetId}&select=org_id`,
  );
  // 25 more text fields: 30 in all
  await rest(page, 'fields', {
    method: 'POST',
    body: Array.from({ length: 25 }, (_, i) => ({
      org_id,
      sheet_id: sheetId,
      key: `extra_${i + 1}`,
      name: `Extra ${i + 1}`,
      type: 'text',
      position: `b${String(i).padStart(2, '0')}`,
      width: 120,
    })),
  });
  const fields = await rest<{ id: string; key: string }[]>(
    page,
    `fields?sheet_id=eq.${sheetId}&key=like.extra_*&select=id,key`,
  );
  const rows = Array.from({ length: 10_000 }, (_, i) => ({
    name: `Row ${String(i + 1).padStart(5, '0')}`,
    position: `a${String(i).padStart(6, '0')}`,
    values: Object.fromEntries(fields.slice(0, 5).map((f) => [f.id, `${f.key} ${i + 1}`])),
  }));
  expect(
    await rest<number>(page, 'rpc/create_items', {
      method: 'POST',
      body: { p_sheet: sheetId, p_group: group!.id, p_rows: rows },
    }),
  ).toBe(10_000);

  const started = Date.now();
  await page.goto(url);
  await expect(page.getByRole('heading', { name: /^Open\s*10,000 items/ })).toBeVisible({
    timeout: 60_000,
  });
  const loadMs = Date.now() - started;
  const g = grid(page);
  await expect(g.getByText('Row 00001', { exact: true })).toBeVisible();
  // only a window of rows and columns is in the DOM
  expect(await g.getByRole('gridcell').count()).toBeLessThan(1500);
  // rows scroll with the page; columns scroll inside the grid
  for (const top of [50_000, 150_000, 300_000]) {
    await page.evaluate((y) => window.scrollTo(0, y), top);
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(g.getByText('Row 10000', { exact: true })).toBeVisible();
  await g.evaluate((el) => (el.scrollLeft = el.scrollWidth));
  await expect(g.getByRole('button', { name: 'Extra 25 column menu' }).first()).toBeVisible();
  expect(errors).toEqual([]);
  test.info().annotations.push({ type: 'load', description: `${loadMs} ms to show 10 000 items` });
});
