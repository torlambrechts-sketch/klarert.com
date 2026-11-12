import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { generateNKeysBetween } from 'fractional-indexing';
import { rest, signIn } from './helpers';

// M6: the List view (default), phone cards, Kanban, Calendar, the Form view with its public link, filters, sort,
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
const listTable = (page: Page) => page.getByRole('table');
const listRow = (page: Page, name: string) =>
  listTable(page)
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name, exact: true }) });

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

test('List view: popover editing, add a field, locks, hint and pagination', async ({
  page,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(page, 'maria@example.com');
  const sheet = await trackerSheet(page);
  await expect(views(page).getByRole('link', { name: 'List' })).toHaveAttribute(
    'aria-current',
    'page',
  );
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

  // pagination
  const footer = page.getByText('1–25 of 30');
  await expect(footer).toBeVisible();
  await expect(listRow(page, 'Row 25')).toBeVisible();
  await expect(listRow(page, 'Row 26')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('26–30 of 30')).toBeVisible();
  await expect(listRow(page, 'Row 30')).toBeVisible();
  await page.getByRole('button', { name: 'Prev', exact: true }).click();
  await page.getByLabel('Items per page').selectOption('50');
  await expect(page.getByText('1–30 of 30')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();

  // status is the first column after the name; click a cell to edit it in a popover
  const headers = listTable(page).getByRole('columnheader');
  await expect(headers.nth(1)).toHaveText('Status');
  await page.getByRole('button', { name: 'Status of Row 01' }).click();
  await page
    .getByRole('listbox', { name: 'Status' })
    .getByRole('option', { name: 'Working on it' })
    .click();
  await expect(page.getByRole('button', { name: 'Status of Row 01' })).toContainText(
    'Working on it (needs action)',
  );
  await page.getByRole('button', { name: 'Status of Row 02' }).click();
  await page.getByRole('listbox', { name: 'Status' }).getByRole('option', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Status of Row 02' })).toContainText('Done (done)');

  // locked header: lock with its explanation
  const lock = headers
    .filter({ hasText: 'Progress' })
    .getByLabel('Kept by the app. You can hide it, not delete it.');
  await lock.hover();
  await expect(page.getByRole('tooltip')).toHaveText(
    'Kept by the app. You can hide it, not delete it.',
  );

  // "+" adds a field
  await page.getByRole('button', { name: 'Add a field' }).click();
  await page.getByRole('button', { name: /^Text/ }).first().click();
  await expect(headers.filter({ hasText: /^Text$/ })).toBeVisible();

  // the hint goes and stays gone
  await expect(page.getByText('Click any cell to edit.')).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss hint' }).click();
  await page.reload();
  await expect(page.getByText('1–30 of 30')).toBeVisible();
  await expect(page.getByText('Click any cell to edit.')).toHaveCount(0);
});

test('List view on a phone shows cards', async ({ page }, info) => {
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
  await expect(card).toContainText('overdue');
  await expect(page.getByRole('table')).toHaveCount(0);
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
  await page.getByRole('dialog').getByLabel('Name').fill('Order new gauges');
  await page.getByRole('dialog').getByRole('button', { name: 'Add task' }).click();
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
  await dialog.getByLabel('Name').fill('Toolbox talk');
  await dialog.getByRole('button', { name: 'Add task' }).click();
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
  await page.getByRole('button', { name: 'Create a form' }).click();
  await expect(page.getByRole('heading', { name: 'Form builder' })).toBeVisible();

  // builder: Owner off, Status asked as "How urgent is it?" and required
  await page.getByRole('checkbox', { name: 'Owner' }).uncheck();
  await page.getByLabel('Status label').fill('How urgent is it?');
  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(preview.getByText('How urgent is it?')).toBeVisible();
  await expect(preview.getByText('Owner')).toHaveCount(0);
  await expect
    .poll(async () => {
      const [v] = await rest<
        { config: { form?: { fields: { key: string; label?: string }[] } } }[]
      >(page, `views?sheet_id=eq.${sheet.sheetId}&type=eq.form&select=config`);
      return v?.config.form?.fields.map((f) => f.label ?? f.key).join(',');
    })
    .toBe('How urgent is it?,priority,due_date,progress');

  // internal form: the preview adds an item as Maria
  await preview.getByLabel('Task').fill('Signed-in report');
  await preview.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/^Sent\. .+-001 was added\.$/)).toBeVisible();

  // public link
  await page.getByRole('button', { name: 'Create public link' }).click();
  const link = await page.getByLabel('Public link').inputValue();
  expect(link).toMatch(/\/f\/[0-9a-f]{64}$/);
  await expect(page.getByRole('img', { name: 'QR code of the public link' })).toBeVisible();

  const visitor = await signedOut(browser);
  await visitor.page.goto(link);
  await expect(visitor.page.getByRole('heading', { name: sheet.name })).toBeVisible();
  await expect(visitor.page.getByRole('navigation')).toHaveCount(0);
  await visitor.page.getByRole('button', { name: 'Send' }).click();
  await expect(visitor.page.getByText('Task is required.')).toBeVisible();
  await visitor.page.getByLabel('Task').fill('Oil on the stairs');
  await visitor.page.getByRole('button', { name: /How urgent is it/ }).click();
  await visitor.page.getByRole('option', { name: 'Stuck' }).click();
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
  await page.getByRole('button', { name: 'Disable link' }).click();
  await expect(page.getByRole('button', { name: 'Create public link' })).toBeVisible();
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
  const names = () => listTable(page).locator('tbody td:first-child button').allInnerTexts();
  await expect.poll(names).toEqual(['Pump A seal', 'Pump B seal', 'Valve check', 'Guard rail']);

  // text contains
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('button', { name: 'Add a condition' }).click();
  await page.getByLabel('Condition 1 field').selectOption({ label: 'Name' });
  await page.getByLabel('Condition 1 operator').selectOption({ label: 'contains' });
  await page.getByLabel('Condition 1 value').fill('pump');
  await expect.poll(names).toEqual(['Pump A seal', 'Pump B seal']);
  await expect(page.getByRole('button', { name: 'Filter, 1 active' })).toBeVisible();

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
  await page.getByRole('button', { name: 'Sort', exact: true }).click();
  await page.getByRole('button', { name: 'Add a sort' }).click();
  await page.getByLabel('Sort level 1 field').selectOption({ label: 'Name' });
  await page.getByLabel('Sort level 1 direction').selectOption({ label: 'Z → A, high → low' });
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
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
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
  await expect(views(page).getByRole('link', { name: /My pumps/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
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
  await expect(views(page).getByRole('link', { name: 'Team board' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('[data-lane="Stuck"]')).toBeVisible();
  const sharedUrl = page.url();

  // Maria: sees the shared view, not James's personal one
  const ctx = await browser.newContext();
  const maria = await ctx.newPage();
  await signIn(maria, 'maria@example.com');
  await maria.goto(sheet.url);
  await expect(views(maria).getByRole('link', { name: 'Team board' })).toBeVisible();
  await expect(views(maria).getByRole('link', { name: /My pumps/ })).toHaveCount(0);
  await maria.goto(sharedUrl);
  await expect(views(maria).getByRole('link', { name: 'Team board' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(maria.locator('[data-lane="Stuck"]').getByText('Pump seal')).toBeVisible();
  await maria.goto(personalUrl);
  await expect(
    maria.getByText('That view no longer exists or is not shared with you. Showing the list.'),
  ).toBeVisible();
  await expect(views(maria).getByRole('link', { name: 'List' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(listRow(maria, 'Valve check')).toBeVisible();
  await ctx.close();

  // the deep link still opens James's view for James
  await page.goto(personalUrl);
  await expect(views(page).getByRole('link', { name: /My pumps/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(listRow(page, 'Pump seal')).toBeVisible();
  await expect(listRow(page, 'Valve check')).toHaveCount(0);
});
