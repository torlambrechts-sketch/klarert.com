import { expect, test, type Page } from '@playwright/test';
import { generateNKeysBetween } from 'fractional-indexing';
import { rest, signIn } from './helpers';

// The Table view (docs/05 §3.1): one sticky column header for all groups, collapsible group sections, column
// summaries off until switched on (kept in the view), old ?view=list / ?view=grid links, and cards at 390 px.
// Uses the seed (pnpm seed): james@example.com editor of /meridian. Each test makes its own Tracker sheet (Owner
// people, Status, Priority, Due date, Progress; groups Open and Done) with a random ID prefix.

test.describe.configure({ mode: 'default' });

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const prefix = () =>
  Array.from({ length: 5 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');

async function twoGroupSheet(page: Page) {
  await page.goto('/meridian/s/new?start=tracker');
  await page.getByLabel('Sheet name').fill(`Table ${unique()}`);
  await expect(page.getByLabel('ID prefix')).not.toHaveValue('');
  const pre = prefix();
  await page.getByLabel('ID prefix').fill(`${pre}-`);
  await page.getByRole('button', { name: 'Create sheet' }).click();
  await expect(page).toHaveURL(/\/meridian\/s\/[0-9a-f-]{36}$/);
  const url = page.url();
  const sheetId = url.split('/s/')[1]!;
  const groups = await rest<{ id: string; name: string }[]>(
    page,
    `groups?sheet_id=eq.${sheetId}&order=position&select=id,name`,
  );
  const fields = await rest<
    { id: string; key: string; config: { options?: { id: string; label: string }[] } }[]
  >(page, `fields?sheet_id=eq.${sheetId}&select=id,key,config`);
  const field = (key: string) => fields.find((f) => f.key === key)!;
  const option = (key: string, label: string) =>
    field(key).config.options!.find((o) => o.label === label)!.id;
  const [maria] = await rest<{ id: string }[]>(
    page,
    `profiles?display_name=eq.Maria Pereira&select=id`,
  );
  const add = async (group: string, rows: { name: string; values?: Record<string, unknown> }[]) => {
    const keys = generateNKeysBetween(null, null, rows.length);
    await rest(page, 'rpc/create_items', {
      method: 'POST',
      body: {
        p_sheet: sheetId,
        p_group: groups.find((g) => g.name === group)!.id,
        p_rows: rows.map((r, i) => ({ name: r.name, position: keys[i], values: r.values ?? {} })),
      },
    });
  };
  return { url, sheetId, pre, field, option, add, maria: maria!.id };
}

const grid = (page: Page) => page.getByRole('grid');
const groupButton = (page: Page, name: string) =>
  page.getByRole('heading', { name: new RegExp(`^${name}\\s`) }).getByRole('button');

test.describe('desktop', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop table'));

  test('each group card has its own header row, collapsing a group, and old list and grid links', async ({
    page,
  }) => {
    await signIn(page, 'james@example.com');
    const sheet = await twoGroupSheet(page);
    await sheet.add('Open', [
      { name: 'Fix guard rail', values: { [sheet.field('owner').id]: [sheet.maria] } },
      { name: 'Replace eye-wash' },
    ]);
    await sheet.add('Done', [{ name: 'Calibrate scale' }]);
    await page.reload();

    // one row of column headers at the top of each group card
    await expect(groupButton(page, 'Open')).toBeVisible();
    await expect(groupButton(page, 'Done')).toBeVisible();
    const headerRows = grid(page)
      .getByRole('row')
      .filter({ has: page.getByRole('columnheader') });
    await expect(headerRows).toHaveCount(2);
    await expect(grid(page).getByRole('button', { name: 'Status column menu' })).toHaveCount(2);
    // small muted column names (12 px)
    const headSize = await grid(page)
      .getByRole('button', { name: 'Status column menu' })
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(headSize).toBe('12px');
    await expect(
      grid(page).getByRole('checkbox', { name: 'Select all items in Open' }),
    ).toBeVisible();

    // rows show the display id and the owner (the first people field) under the name
    const nameCell = grid(page)
      .getByRole('row')
      .filter({ hasText: 'Fix guard rail' })
      .locator('[data-cell$="|name"]');
    await expect(nameCell).toContainText(new RegExp(`${sheet.pre}-\\d+`));
    await expect(nameCell).toContainText('Maria Pereira');

    // collapse Open with the keyboard: its items go, Done stays, the count stays
    const open = groupButton(page, 'Open');
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await expect(open).toContainText('2 items');
    await expect(grid(page).getByText('Fix guard rail', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Add task to Open' })).toHaveCount(0);
    await expect(grid(page).getByText('Calibrate scale', { exact: true })).toBeVisible();
    // a collapsed card has no header row
    await expect(headerRows).toHaveCount(1);
    await open.click();
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    await expect(grid(page).getByText('Fix guard rail', { exact: true })).toBeVisible();

    // the former view ids open the Table
    for (const old of ['list', 'grid']) {
      await page.goto(`${sheet.url}?view=${old}`);
      await expect(
        page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Table' }),
      ).toHaveAttribute('aria-current', 'page');
      await expect(grid(page).getByText('Calibrate scale', { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('link')).toHaveText([
      /Table/,
      /Board/,
      /Calendar/,
      /Form/,
    ]);
  });

  test('number, option and date columns show summaries by default; a column switches its own off', async ({
    page,
  }) => {
    await signIn(page, 'james@example.com');
    const sheet = await twoGroupSheet(page);
    await sheet.add('Open', [
      { name: 'Alpha', values: { [sheet.field('progress').id]: 20 } },
      { name: 'Bravo', values: { [sheet.field('progress').id]: 60 } },
    ]);
    await sheet.add('Done', [{ name: 'Charlie' }]);
    await page.reload();
    await expect(grid(page).getByText('Alpha', { exact: true })).toBeVisible();

    const summaries = grid(page).getByRole('gridcell', { name: /^Summary of/ });
    await expect(summaries).toHaveCount(2);
    const openSummary = grid(page)
      .getByRole('row')
      .filter({ has: page.getByRole('gridcell', { name: 'Summary of Open' }) });
    await expect(openSummary).toContainText('40');
    await expect(openSummary).toContainText('average');

    // another function from the same menu
    await grid(page).getByRole('button', { name: 'Progress column menu' }).first().click();
    await page.getByRole('menuitem', { name: 'Summary', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Maximum' }).click();
    await expect(openSummary).toContainText('60');

    // kept for this view after a reload
    await page.reload();
    await expect(summaries).toHaveCount(2);
    await expect(openSummary).toContainText('60');

    // a collapsed group has no summary row
    await groupButton(page, 'Done').click();
    await expect(summaries).toHaveCount(1);

    await grid(page).getByRole('button', { name: 'Progress column menu' }).first().click();
    await page.getByRole('menuitem', { name: 'Hide summary' }).click();
    await expect(openSummary).not.toContainText('60');
    await page.reload();
    await expect(grid(page).getByText('Alpha', { exact: true })).toBeVisible();
    await expect(openSummary).not.toContainText('60');
  });

  test('type to edit: a key on a cell opens its editor with that key', async ({ page }) => {
    await signIn(page, 'james@example.com');
    const sheet = await twoGroupSheet(page);
    await sheet.add('Open', [{ name: 'Alpha' }]);
    await page.reload();
    const name = grid(page)
      .getByRole('row')
      .filter({ hasText: 'Alpha' })
      .locator('[data-cell$="|name"]');
    await name.click();
    await page.keyboard.press('B');
    const box = page.getByRole('textbox', { name: 'Task name' });
    await expect(box).toHaveValue('B');
    await page.keyboard.type('ravo');
    await page.keyboard.press('Enter');
    await expect(grid(page).getByText('Bravo', { exact: true })).toBeVisible();
    await expect(grid(page)).toBeFocused();
  });
});

test.describe('phone', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'phone layout'));

  test('at 390 px items are cards under collapsible group titles; + Add and tap to open', async ({
    page,
  }) => {
    await signIn(page, 'james@example.com');
    const sheet = await twoGroupSheet(page);
    await sheet.add('Open', [
      {
        name: 'Replace the eye-wash bottles',
        values: { [sheet.field('status').id]: sheet.option('status', 'Stuck') },
      },
    ]);
    await sheet.add('Done', [{ name: 'Calibrate scale' }]);
    await page.reload();

    await expect(page.getByRole('grid')).toHaveCount(0);
    const cards = page.getByTestId('item-card');
    await expect(cards).toHaveCount(2);
    const card = cards.filter({ hasText: 'Replace the eye-wash bottles' });
    await expect(card).toContainText(`${sheet.pre}-001`);
    await expect(card).toContainText('Stuck');
    await expect(cards.filter({ hasText: 'Calibrate scale' })).toContainText(`${sheet.pre}-002`);
    // nothing wider than the screen
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );

    // the same group titles collapse the cards
    const done = groupButton(page, 'Done');
    await done.click();
    await expect(done).toHaveAttribute('aria-expanded', 'false');
    await expect(cards).toHaveCount(1);

    // + Add in a group
    const add = page.getByRole('textbox', { name: 'Add task to Open' });
    await add.fill('Check the first-aid kit');
    await add.press('Enter');
    await expect(cards.filter({ hasText: 'Check the first-aid kit' })).toBeVisible();
    await expect(cards.filter({ hasText: 'Check the first-aid kit' })).toContainText(
      `${sheet.pre}-003`,
    );

    // tap opens the item panel
    await card.click();
    await expect(page).toHaveURL(/item=/);
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: 'Replace the eye-wash bottles' }),
    ).toBeVisible();
  });
});
