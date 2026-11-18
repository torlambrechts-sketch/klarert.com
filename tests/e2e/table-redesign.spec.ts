import { expect, test, type Page } from '@playwright/test';
import { rest, signIn } from './helpers';

// T1 Table redesign (docs/18): the option picker by keyboard, a bulk status change with its log entries, grouping
// by status with "+ Add item", the menus' keyboard flow, and the widths at 1920 px and 390 px. Uses the seed: james
// is an editor of /meridian. Each test makes its own Tracker sheet (Owner, Status, Priority, Due date, Progress).

test.describe.configure({ mode: 'default' });

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function trackerSheet(page: Page) {
  await page.goto('/meridian/s/new?start=tracker');
  await page.getByLabel('Sheet name').fill(`T1 ${unique()}`);
  await expect(page.getByLabel('ID prefix')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Create sheet' }).click();
  await expect(page).toHaveURL(/\/meridian\/s\/[0-9a-f-]{36}$/);
  const sheetId = page.url().split('/').at(-1)!;
  await page.goto(`${page.url()}?view=table`);
  return sheetId;
}

const grid = (page: Page) => page.getByRole('grid');
const row = (page: Page, name: string) =>
  grid(page)
    .getByRole('row')
    .filter({ has: page.getByRole('gridcell', { name, exact: false }) });
// Tracker columns after the name: Owner, Status
const statusCell = (page: Page, name: string) => row(page, name).getByRole('gridcell').nth(2);

async function addItems(page: Page, group: string, names: string[]) {
  const input = page.getByRole('textbox', { name: `Add task to ${group}` });
  await input.click();
  for (const n of names) {
    await input.fill(n);
    await input.press('Enter');
    await expect(input).toHaveValue('');
  }
  for (const n of names) await expect(grid(page).getByText(n, { exact: true })).toBeVisible();
  await expect(grid(page).locator('[id^="cell-temp-"]')).toHaveCount(0);
}

test.describe('desktop', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop table'));

  test('the option picker works by keyboard and a bulk status change logs one entry per item', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await signIn(page, 'james@example.com');
    const sheetId = await trackerSheet(page);
    await addItems(page, 'Open', ['Fix guard rail', 'Replace eye-wash', 'Calibrate scale']);

    // one click opens the picker under the cell; arrows move, Enter picks
    await statusCell(page, 'Fix guard rail').click();
    const picker = page.getByRole('listbox', { name: 'Status' });
    await expect(picker).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(picker).toBeHidden();
    await expect(statusCell(page, 'Fix guard rail')).not.toHaveText('Empty');
    // the value fills the cell in its solid colour, with white words
    const box = statusCell(page, 'Fix guard rail').locator('[data-box]');
    await expect(box).toHaveCSS('color', 'rgb(255, 255, 255)');

    // select two rows: the bulk bar sets Status on both
    await row(page, 'Replace eye-wash').getByRole('checkbox').check();
    await row(page, 'Calibrate scale').getByRole('checkbox').check();
    const bar = page.getByRole('region', { name: 'Selected items' });
    await expect(bar).toContainText('2 items selected');
    await bar.getByRole('button', { name: 'Status' }).click();
    await page.getByRole('option', { name: /Done/ }).click();
    await expect(page.getByText('Status changed on 2 items.')).toBeVisible();
    await expect(statusCell(page, 'Replace eye-wash')).toContainText('Done');
    await expect(statusCell(page, 'Calibrate scale')).toContainText('Done');

    const items = await rest<{ id: string; name: string }[]>(
      page,
      `items?sheet_id=eq.${sheetId}&select=id,name`,
    );
    for (const name of ['Replace eye-wash', 'Calibrate scale']) {
      const id = items.find((i) => i.name === name)!.id;
      const log = await rest<{ action: string }[]>(
        page,
        `activity_log?item_id=eq.${id}&action=eq.value.changed&select=action`,
      );
      expect(log).toHaveLength(1);
    }

    // the table fills the card at 1920 px with the side menu collapsed: the last row cell ends at the card's edge
    const collapse = page.getByRole('button', { name: /Collapse (the )?side menu/i });
    if (await collapse.count()) await collapse.first().click();
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const g = document.querySelector<HTMLElement>('[role="grid"]')!;
          const inner = g.firstElementChild as HTMLElement;
          return Math.abs(inner.scrollWidth - g.clientWidth);
        }),
      )
      .toBeLessThanOrEqual(2);
  });

  test('grouping by status puts + Add item in each status, and menus work by keyboard', async ({
    page,
  }) => {
    await signIn(page, 'james@example.com');
    await trackerSheet(page);
    await addItems(page, 'Open', ['Alpha']);

    // More ▾ by keyboard: Enter opens and focuses the first item, ↓ moves, Escape closes and returns focus
    const more = page.getByTestId('more-menu');
    await more.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();

    // Group by › Status
    await more.click();
    await page.getByRole('menuitem', { name: /Group by/ }).click();
    await page.getByRole('menuitemradio', { name: 'Status' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: /^No status/ })).toBeVisible();

    // set Alpha's status, then add an item in that status group: it takes the status
    await statusCell(page, 'Alpha').click();
    await page.getByRole('option', { name: /Working on it/ }).click();
    const group = page.getByRole('heading', { name: /^Working on it/ });
    await expect(group).toBeVisible();
    const input = page.getByRole('textbox', { name: 'Add task to Working on it' });
    await input.fill('Bravo');
    await input.press('Enter');
    await expect(statusCell(page, 'Bravo')).toContainText('Working on it');
  });
});

test('at 390 px nothing scrolls the page sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'james@example.com');
  await trackerSheet(page);
  await expect(page.getByTestId('sheet-toolbar')).toBeVisible();
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(wide).toBeLessThanOrEqual(0);
});
