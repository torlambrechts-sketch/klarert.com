import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { generateNKeysBetween } from 'fractional-indexing';
import { MIN_FILL_MS, rest, signIn, viewTab, viewTabNames } from './helpers';

// M6: the Table view (default), phone cards, Kanban, Calendar, the Form view with its public link, filters, sort,
// search and saved views. Uses the seed (pnpm seed): maria@example.com owner, james@example.com editor of
// /meridian. Each test creates its own sheet from the Tracker start (Owner people, Status, Priority severity,
// Due date, Progress percent; groups Open and Done).

test.describe.configure({ mode: 'default' });

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const desktopOnly = (name: string) => test.skip(name === 'phone', 'desktop view');

type FieldRow = { id: string; key: string; config: { options?: { id: string; label: string }[] } };

async function trackerSheet(page: Page, name = `Views ${unique()}`) {
  await page.goto('/meridian/s/new?start=tracker');
  await page.getByLabel('Sheet name').fill(name);
  await expect(page.getByLabel('ID prefix')).not.toHaveValue('');
  // a random prefix: names here share their initials, so suggested prefixes collide between parallel tests
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const prefix = Array.from(
    { length: 5 },
    () => letters[Math.floor(Math.random() * letters.length)],
  ).join('');
  await page.getByLabel('ID prefix').fill(`${prefix}-`);
  await page.getByRole('button', { name: 'Create sheet' }).click();
  await expect(page).toHaveURL(/\/meridian\/s\/[0-9a-f-]{36}$/);
  const url = page.url();
  const sheetId = url.split('/s/')[1]!;
  const [group] = await rest<{ id: string }[]>(
    page,
    `groups?sheet_id=eq.${sheetId}&order=position&limit=1&select=id`,
  );
  const fields = await rest<FieldRow[]>(page, `fields?sheet_id=eq.${sheetId}&select=id,key,config`);
  const field = (key: string) => fields.find((f) => f.key === key)!;
  const option = (key: string, label: string) =>
    field(key).config.options!.find((o) => o.label === label)!.id;
  return { url, sheetId, groupId: group!.id, field, option, name };
}

type Sheet = Awaited<ReturnType<typeof trackerSheet>>;

async function addRows(
  page: Page,
  sheet: Sheet,
  rows: { name: string; values?: Record<string, unknown> }[],
) {
  const keys = generateNKeysBetween(null, null, rows.length);
  await rest(page, 'rpc/create_items', {
    method: 'POST',
    body: {
      p_sheet: sheet.sheetId,
      p_group: sheet.groupId,
      p_rows: rows.map((r, i) => ({
        name: r.name,
        position: keys[i],
        values: r.values ?? {},
      })),
    },
  });
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromToday = (n: number) => iso(new Date(Date.now() + n * 86_400_000));
const views = (page: Page) => page.getByRole('navigation', { name: 'Views' });
const table = (page: Page) => page.getByRole('grid');
const listRow = (page: Page, name: string) =>
  table(page)
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name, exact: true }) });
/** The cell of an item's field in the Table (cells are ids of item and field). */
const cellOf = (page: Page, row: string, fieldId: string) =>
  listRow(page, row).locator(`[id$="-${fieldId}"]`);

async function drag(page: Page, source: Locator, target: Locator) {
  const s = (await source.boundingBox())!;
  const t = (await target.boundingBox())!;
  // grab below the name (the name is a button that opens the item)
  await page.mouse.move(s.x + s.width / 2, s.y + s.height - 8);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2 + 12, s.y + s.height, { steps: 4 });
  await page.mouse.move(t.x + t.width / 2, t.y + 60, { steps: 12 });
  await page.mouse.up();
}

test('Table view: editing, add a field, locks, hint and all rows reachable', async ({
  page,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(page, 'maria@example.com');
  const sheet = await trackerSheet(page);
  await expect(viewTab(page, 'Table')).toHaveAttribute('aria-current', 'page');
  await addRows(
    page,
    sheet,
    Array.from({ length: 30 }, (_, i) => ({ name: `Row ${String(i + 1).padStart(2, '0')}` })),
  );
  await rest(page, `fields?id=eq.${sheet.field('progress').id}`, {
    method: 'PATCH',
    body: { locked: true },
  });
  await page.reload();

  // every row is reachable in one table that scrolls with the page (no pages)
  await expect(listRow(page, 'Row 01')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(listRow(page, 'Row 30')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(listRow(page, 'Row 01')).toBeVisible();

  // each group card starts with a header row: the item label, then the fields in field order
  const headers = table(page)
    .getByRole('row')
    .filter({ has: page.getByRole('columnheader') })
    .first()
    .getByRole('columnheader');
  await expect(headers).toHaveText([
    'Task',
    'Owner',
    'Status',
    'Priority',
    'Due date',
    /^Progress/,
    '',
  ]);
  // click a cell to select it, click again to edit it in a popover
  const status = sheet.field('status').id;
  await cellOf(page, 'Row 01', status).click();
  await cellOf(page, 'Row 01', status).click();
  await page
    .getByRole('listbox', { name: 'Status' })
    .getByRole('option', { name: 'Working on it' })
    .click();
  await expect(cellOf(page, 'Row 01', status)).toContainText('Working on it (needs action)');
  await cellOf(page, 'Row 02', status).dblclick();
  await page.getByRole('listbox', { name: 'Status' }).getByRole('option', { name: 'Done' }).click();
  await expect(cellOf(page, 'Row 02', status)).toContainText('Done (done)');

  // locked header: lock with its explanation
  const lock = headers
    .filter({ hasText: 'Progress' })
    .getByLabel('Kept by the app. You can hide it, not delete it.');
  await lock.hover();
  await expect(page.getByRole('tooltip')).toHaveText(
    'Kept by the app. You can hide it, not delete it.',
  );

  // "+" adds a field
  await page.getByRole('button', { name: 'Add a field' }).first().click();
  await page.getByRole('button', { name: /^Text/ }).first().click();
  await page.getByRole('button', { name: 'Add field' }).click();
  await expect(headers.filter({ hasText: /^Text$/ })).toBeVisible();

  // no hint line above the table
  await expect(
    page.getByText('Click a cell, then click again or press Enter to edit.'),
  ).toHaveCount(0);
});

test('Table view on a phone shows cards', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout');
  await signIn(page, 'maria@example.com');
  const sheet = await trackerSheet(page);
  await addRows(page, sheet, [
    {
      name: 'Replace the eye-wash bottles',
      values: {
        [sheet.field('status').id]: sheet.option('status', 'Stuck'),
        [sheet.field('due_date').id]: daysFromToday(-3),
      },
    },
  ]);
  await page.reload();
  const card = page.getByTestId('item-card').filter({ hasText: 'Replace the eye-wash bottles' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Stuck');
  await expect(card).toContainText(/-001/);
  await expect(card).toContainText('late');
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('grid')).toHaveCount(0);
  await card.click();
  await expect(page).toHaveURL(/item=/);
});

test('Kanban: dragging a card changes its status, a status rule snaps it back', async ({
  page,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(page, 'james@example.com');
  const sheet = await trackerSheet(page);
  const status = sheet.field('status');
  await addRows(page, sheet, [
    {
      name: 'Calibrate the torque wrench',
      values: { [status.id]: sheet.option('status', 'Not started') },
    },
  ]);
  await page.goto(`${sheet.url}?view=kanban`);
  const lane = (name: string) => page.locator(`[data-lane="${name}"]`);
  const card = page.getByTestId('kanban-card').filter({ hasText: 'Calibrate the torque wrench' });
  await expect(lane('Not started').getByTestId('kanban-card')).toHaveCount(1);
  await expect(lane('Working on it')).toBeVisible();

  await drag(page, card, lane('Working on it'));
  await expect(lane('Working on it').getByTestId('kanban-card')).toHaveCount(1);
  await expect
    .poll(async () => {
      const [it] = await rest<{ values: Record<string, string> }[]>(
        page,
        `items?sheet_id=eq.${sheet.sheetId}&select=values`,
      );
      return it!.values[status.id];
    })
    .toBe(sheet.option('status', 'Working on it'));

  // a status rule: Done needs a due date
  await rest(page, `fields?id=eq.${status.id}`, {
    method: 'PATCH',
    body: {
      rules: [
        {
          id: 'rule_due',
          whenFieldKey: 'status',
          whenValues: [sheet.option('status', 'Done')],
          require: ['due_date'],
          message: 'Add a due date before you close it.',
        },
      ],
    },
  });
  await page.reload();
  await drag(page, card, lane('Done'));
  await expect(page.getByText('Add a due date before you close it.')).toBeVisible();
  await expect(lane('Working on it').getByTestId('kanban-card')).toHaveCount(1);
  await expect(lane('Done').getByTestId('kanban-card')).toHaveCount(0);

  // "+ Add" in a lane creates the item in that lane
  await page.getByRole('button', { name: 'Add an item to Stuck' }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: /^Name/ }).fill('Order new gauges');
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    lane('Stuck').getByTestId('kanban-card').filter({ hasText: 'Order new gauges' }),
  ).toBeVisible();
});

test('Calendar: items on their dates, clicking a day adds an item with that date', async ({
  page,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(page, 'james@example.com');
  const sheet = await trackerSheet(page);
  const due = sheet.field('due_date');
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  await addRows(page, sheet, [
    { name: 'Fire drill', values: { [due.id]: `${ym}-15` } },
    { name: 'No date yet' },
  ]);
  await page.goto(`${sheet.url}?view=calendar`);
  await expect(page.locator(`td[data-date="${ym}-15"]`)).toContainText('Fire drill');
  await expect(page.getByRole('table').getByText('No date yet')).toHaveCount(0);
  await expect(page.locator('td[aria-current="date"]')).toHaveCount(1);

  await page
    .locator(`td[data-date="${ym}-20"]`)
    .getByRole('button', { name: /^Add an item on/ })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Due date:');
  await dialog.getByRole('textbox', { name: /^Name/ }).fill('Toolbox talk');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator(`td[data-date="${ym}-20"]`)).toContainText('Toolbox talk');
  await expect
    .poll(async () => {
      const rows = await rest<{ name: string; values: Record<string, string> }[]>(
        page,
        `items?sheet_id=eq.${sheet.sheetId}&name=eq.Toolbox%20talk&select=name,values`,
      );
      return rows[0]?.values[due.id];
    })
    .toBe(`${ym}-20`);

  // Previous / Next / Today
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator(`td[data-date="${ym}-15"]`)).toHaveCount(0);
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page.locator(`td[data-date="${ym}-15"]`)).toContainText('Fire drill');
});

async function signedOut(browser: Browser) {
  const ctx = await browser.newContext();
  return { ctx, page: await ctx.newPage() };
}

test('Form view: builder, internal form and a public link that works signed out until disabled', async ({
  page,
  browser,
}, info) => {
  desktopOnly(info.project.name);
  test.setTimeout(150_000);
  await signIn(page, 'maria@example.com');
  const sheet = await trackerSheet(page);
  await page.goto(`${sheet.url}?view=form`);
  await expect(
    page.getByText('No forms yet. Collect items from people without sheet access.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New form' }).first().click();
  const create = page.getByRole('dialog', { name: 'New form' });
  await create.getByLabel('Name').fill('Report');
  await create.getByRole('button', { name: 'Create form' }).click();
  await expect(page.getByRole('textbox', { name: 'Form name' })).toHaveValue('Report');

  // builder: Owner (a person) is never asked on a public form; Status asked as "How urgent is it?" and required
  await expect(page.getByRole('switch', { name: 'Ask Owner' })).toHaveCount(0);
  await page.getByLabel('Status label').fill('How urgent is it?');
  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(preview.getByLabel('Status label')).toHaveValue('How urgent is it?');
  await expect(preview.getByText('Owner')).toHaveCount(0);
  await expect
    .poll(async () => {
      const [v] = await rest<
        { config: { form?: { fields: { key: string; label?: string }[] } } }[]
      >(page, `views?sheet_id=eq.${sheet.sheetId}&type=eq.form&select=config`);
      return v?.config.form?.fields.map((f) => f.label ?? f.key).join(',');
    })
    .toBe('How urgent is it?,priority,due_date,progress');

  // a public form opens only with a reviewed privacy notice
  const settings = page.getByRole('region', { name: 'Settings' });
  await settings.getByLabel('Purpose').fill('To track the tasks people report.');
  await settings.getByLabel('Legal basis').selectOption('legitimate_interests');
  await settings.getByLabel('Who receives the answers').fill('The team.');
  await settings.getByLabel('How long answers are kept').fill('One year.');
  await settings.getByLabel('Rights and contact').fill('Ask the owner.');
  await settings.getByRole('button', { name: 'Mark as reviewed' }).click();
  await expect(settings.getByText(/^Reviewed by Maria/)).toBeVisible();
  await page.getByRole('radio', { name: 'Open' }).click();
  await expect(page.getByRole('radio', { name: 'Open' })).toHaveAttribute('aria-checked', 'true');

  // internal use: the preview adds an item as Maria
  await page.getByRole('button', { name: 'Preview' }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview' });
  await dialog.getByLabel('Task').fill('Signed-in report');
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/^Sent\. .+-001 was added\.$/)).toBeVisible();
  await page.keyboard.press('Escape');

  // public link
  await page.getByRole('button', { name: 'Share form' }).click();
  const share = page.getByRole('dialog', { name: /^Share/ });
  await share.getByRole('button', { name: 'Create public link' }).click();
  const link = await share.getByLabel('Public link').inputValue();
  expect(link).toMatch(/\/f\/[0-9a-f]{64}$/);
  await expect(share.getByRole('img', { name: /^QR code of the link to/ })).toBeVisible();

  const visitor = await signedOut(browser);
  await visitor.page.goto(link);
  await expect(visitor.page.getByRole('heading', { name: 'Report' })).toBeVisible();
  await expect(visitor.page.getByRole('navigation')).toHaveCount(0);
  await visitor.page.getByRole('button', { name: 'Send' }).click();
  await expect(visitor.page.getByText('Task is required.')).toBeVisible();
  await visitor.page.getByLabel('Task').fill('Oil on the stairs');
  await visitor.page.getByRole('button', { name: /How urgent is it/ }).click();
  await visitor.page.getByRole('option', { name: 'Stuck' }).click();
  await visitor.page.waitForTimeout(MIN_FILL_MS);
  await visitor.page.getByRole('button', { name: 'Send' }).click();
  await expect(visitor.page.getByText('Thank you. Your answers were sent.')).toBeVisible();
  await expect(visitor.page.getByText(/-002$/)).toBeVisible();

  const [created] = await rest<{ name: string; values: Record<string, string> }[]>(
    page,
    `items?sheet_id=eq.${sheet.sheetId}&name=eq.Oil%20on%20the%20stairs&select=name,values`,
  );
  expect(created!.values[sheet.field('status').id]).toBe(sheet.option('status', 'Stuck'));
  const [log] = await rest<{ actor_kind: string }[]>(
    page,
    `activity_log?sheet_id=eq.${sheet.sheetId}&action=eq.item.created&order=at.desc&limit=1&select=actor_kind`,
  );
  expect(log!.actor_kind).toBe('form');

  // disable: the link stops working
  await share.getByRole('button', { name: 'Disable link' }).click();
  await share.getByRole('alert').getByRole('button', { name: 'Disable link' }).click();
  await expect(share.getByRole('button', { name: 'Create public link' })).toBeVisible();
  await visitor.page.goto(link);
  await expect(
    visitor.page.getByRole('heading', { name: 'This form is not available' }),
  ).toBeVisible();
  await visitor.ctx.close();
});

test('filters, sort and search', async ({ page }, info) => {
  desktopOnly(info.project.name);
  await signIn(page, 'james@example.com');
  const sheet = await trackerSheet(page);
  const s = sheet.field('status').id;
  const d = sheet.field('due_date').id;
  await addRows(page, sheet, [
    {
      name: 'Pump A seal',
      values: { [s]: sheet.option('status', 'Working on it'), [d]: daysFromToday(-5) },
    },
    {
      name: 'Pump B seal',
      values: { [s]: sheet.option('status', 'Done'), [d]: daysFromToday(-5) },
    },
    {
      name: 'Valve check',
      values: { [s]: sheet.option('status', 'Not started'), [d]: daysFromToday(10) },
    },
    { name: 'Guard rail', values: { [s]: sheet.option('status', 'Stuck') } },
  ]);
  await page.reload();
  const names = () => table(page).locator('[data-cell$="|name"] button').allInnerTexts();
  await expect.poll(names).toEqual(['Pump A seal', 'Pump B seal', 'Valve check', 'Guard rail']);

  // text contains
  // the view's conditions: Filter ▾ › Conditions… (docs/18 §4)
  await page.getByTestId('filter-menu').click();
  await page.getByRole('menuitem', { name: /^Conditions/ }).click();
  await page.getByRole('button', { name: 'Add a condition' }).click();
  await page.getByLabel('Condition 1 field').selectOption({ label: 'Name' });
  await page.getByLabel('Condition 1 operator').selectOption({ label: 'contains' });
  await page.getByLabel('Condition 1 value').fill('pump');
  await expect.poll(names).toEqual(['Pump A seal', 'Pump B seal']);
  await expect(page.getByTestId('filter-menu')).toHaveAttribute('aria-label', 'Filter, 1 on');

  // status is any of
  await page.getByLabel('Condition 1 field').selectOption({ label: 'Status' });
  await page.getByLabel('Condition 1 operator').selectOption({ label: 'is any of' });
  await page.getByRole('checkbox', { name: 'Working on it' }).check();
  await page.getByRole('checkbox', { name: 'Not started' }).check();
  await expect.poll(names).toEqual(['Pump A seal', 'Valve check']);

  // date overdue (done items are never overdue)
  await page.getByLabel('Condition 1 field').selectOption({ label: 'Due date' });
  await page.getByLabel('Condition 1 operator').selectOption({ label: 'is overdue' });
  await expect.poll(names).toEqual(['Pump A seal']);
  await page.getByRole('button', { name: 'Clear all' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(names).toEqual(['Pump A seal', 'Pump B seal', 'Valve check', 'Guard rail']);

  // sort by name, Z → A
  // Sort ▾: a click sorts ascending, the next descending (docs/18 §4)
  await page.getByTestId('sort-menu').click();
  const byName = page.getByRole('menuitemcheckbox', { name: /^Name/ });
  await byName.click();
  await expect(byName).toContainText('Ascending');
  await byName.click();
  await expect(byName).toContainText('Descending');
  await page.keyboard.press('Escape');
  await expect.poll(names).toEqual(['Valve check', 'Pump B seal', 'Pump A seal', 'Guard rail']);

  // search, kept in the URL
  await page.getByRole('searchbox', { name: 'Search this sheet' }).fill('seal');
  await expect.poll(names).toEqual(['Pump B seal', 'Pump A seal']);
  await expect(page).toHaveURL(/q=seal/);
  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Search this sheet' })).toHaveValue('seal');
  await expect.poll(names).toEqual(['Pump B seal', 'Pump A seal']);
});

test('saved views: personal stays personal, shared is shared, ?view= opens a view', async ({
  page,
  browser,
}, info) => {
  desktopOnly(info.project.name);
  test.setTimeout(150_000);
  await signIn(page, 'james@example.com');
  const sheet = await trackerSheet(page);
  await addRows(page, sheet, [
    { name: 'Pump seal', values: { [sheet.field('status').id]: sheet.option('status', 'Stuck') } },
    { name: 'Valve check' },
  ]);
  await page.reload();

  // a personal view with a filter
  // the view's conditions: Filter ▾ › Conditions… (docs/18 §4)
  await page.getByTestId('filter-menu').click();
  await page.getByRole('menuitem', { name: /^Conditions/ }).click();
  await page.getByRole('button', { name: 'Add a condition' }).click();
  await page.getByLabel('Condition 1 field').selectOption({ label: 'Name' });
  await page.getByLabel('Condition 1 operator').selectOption({ label: 'contains' });
  await page.getByLabel('Condition 1 value').fill('pump');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save view' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('View name').fill('My pumps');
  await expect(dialog.getByRole('checkbox', { name: /Share with everyone/ })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Save view' }).click();
  await expect(viewTab(page, /My pumps/)).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(/view=[0-9a-f-]{36}/);
  const personalUrl = page.url();
  await expect(listRow(page, 'Valve check')).toHaveCount(0);

  // a shared Kanban view
  await views(page).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'New view' }).click();
  await dialog.getByLabel('View name').fill('Team board');
  await dialog.getByRole('radio', { name: 'Kanban' }).check();
  await dialog.getByRole('checkbox', { name: /Share with everyone/ }).check();
  await dialog.getByRole('button', { name: 'Create view' }).click();
  await expect(viewTab(page, 'Team board')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-lane="Stuck"]')).toBeVisible();
  const sharedUrl = page.url();

  // Maria: sees the shared view, not James's personal one
  const ctx = await browser.newContext();
  const maria = await ctx.newPage();
  await signIn(maria, 'maria@example.com');
  await maria.goto(sheet.url);
  expect(await viewTabNames(maria)).toContainEqual(expect.stringMatching(/^Team board/));
  expect(await viewTabNames(maria)).not.toContainEqual(expect.stringMatching(/My pumps/));
  await maria.goto(sharedUrl);
  await expect(viewTab(maria, 'Team board')).toHaveAttribute('aria-current', 'page');
  await expect(maria.locator('[data-lane="Stuck"]').getByText('Pump seal')).toBeVisible();
  await maria.goto(personalUrl);
  await expect(
    maria.getByText('That view no longer exists or is not shared with you. Showing the table.'),
  ).toBeVisible();
  await expect(viewTab(maria, 'Table')).toHaveAttribute('aria-current', 'page');
  await expect(listRow(maria, 'Valve check')).toBeVisible();
  await ctx.close();

  // the deep link still opens James's view for James
  await page.goto(personalUrl);
  await expect(viewTab(page, /My pumps/)).toHaveAttribute('aria-current', 'page');
  await expect(listRow(page, 'Pump seal')).toBeVisible();
  await expect(listRow(page, 'Valve check')).toHaveCount(0);
});
