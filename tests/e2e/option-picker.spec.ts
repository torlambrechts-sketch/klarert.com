import { expect, test, type Browser, type Page } from '@playwright/test';
import { makeSheet, nextAnswer, seedItems, STATUS, type Sheet } from './automation-helpers';
import { popoverGone } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// The option picker (search on top, "Add “…”" for a new option, "Edit options") and where field settings are
// reachable: the picker, the Table column menu and the sheet settings page. Uses the seed (pnpm seed): maria owner,
// james editor, vic viewer of /meridian. Each test makes its own sheet named "OPK …".

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const CATEGORY = {
  options: [
    { id: 'opt_sw', label: 'Software', color: 'blue' },
    { id: 'opt_proc', label: 'Process', color: 'purple' },
  ],
};
type Opt = { id: string; label: string; color: string };

async function categorySheet(page: Page) {
  const sheet = await makeSheet(page, `OPK ${unique()}`, [
    { key: 'status', name: 'Status', type: 'status', config: STATUS },
    { key: 'category', name: 'Category', type: 'dropdown', config: CATEGORY },
  ]);
  const items = await seedItems(page, sheet, [{ name: 'Laptop not encrypted' }]);
  return { sheet, item: items['Laptop not encrypted']!, list: `/meridian/s/${sheet.id}` };
}

/** The Category cell of an item in the Table (cells are ids of item and field). */
const categoryCell = (page: Page, sheet: Sheet, item: string) =>
  page.getByRole('grid').locator(`[id="cell-${item}-${sheet.field('category')}"]`);

const categoryOptions = async (page: Page, sheet: Sheet) =>
  (
    await rest<{ config: { options: Opt[] } }[]>(
      page,
      `fields?id=eq.${sheet.field('category')}&select=config`,
    )
  )[0]!.config.options;

async function as(browser: Browser, email: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await signIn(page, email);
  return page;
}

test.describe('desktop', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop Table view'));

  test('search, add a new option inline, edit options, and the fields on the settings page', async ({
    page,
  }) => {
    await signIn(page, 'james@example.com');
    const { sheet, item, list } = await categorySheet(page);
    await page.goto(list);
    const cellButton = () => categoryCell(page, sheet, item);

    // the search is on top and focused; typing filters
    await cellButton().dblclick();
    const listbox = page.getByRole('listbox', { name: 'Category' });
    const search = page.getByRole('combobox', { name: 'Search category' });
    await expect(search).toBeFocused();
    await expect(listbox.getByRole('option')).toHaveCount(2);
    await page.keyboard.type('pro');
    await expect(listbox.getByRole('option')).toHaveCount(2);
    await expect(listbox.getByRole('option', { name: 'Process' })).toBeVisible();
    await expect(listbox.getByRole('option', { name: 'Add “pro”' })).toBeVisible();
    await search.fill('zzz');
    await expect(page.getByText('No matches')).toBeVisible();
    // an exact match (any case) offers no new option
    await search.fill('software');
    await expect(listbox.getByRole('option')).toHaveCount(1);
    await expect(listbox.getByRole('option', { name: /^Add/ })).toHaveCount(0);

    // a new name: "Add “Hardware”" is the last row; arrow down to it, Enter adds and picks it
    await search.fill('Hardware');
    const add = listbox.getByRole('option', { name: 'Add “Hardware”' });
    await expect(add).toBeVisible();
    await expect(search).toHaveAttribute('aria-activedescendant', (await add.getAttribute('id'))!);
    const added = nextAnswer(page);
    await page.keyboard.press('Enter');
    await added;
    await expect(listbox).toHaveCount(0);
    await expect(cellButton()).toContainText('Hardware');
    await popoverGone(page);

    const options = await categoryOptions(page, sheet);
    const hardware = options.find((o) => o.label === 'Hardware')!;
    expect(hardware.id).toMatch(/^opt_/);
    expect(['blue', 'purple']).not.toContain(hardware.color);
    await expect
      .poll(
        async () =>
          (
            await rest<{ values: Record<string, unknown> }[]>(
              page,
              `items?id=eq.${item}&select=values`,
            )
          )[0]!.values[sheet.field('category')],
      )
      .toBe(hardware.id);

    // reopening shows it in the list, selected
    await cellButton().dblclick();
    await expect(listbox.getByRole('option', { name: 'Hardware' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // "Edit options" closes the picker and opens the field settings with the options
    await page.getByRole('button', { name: 'Edit options' }).click();
    await expect(listbox).toHaveCount(0);
    const settings = page.getByRole('dialog');
    await expect(settings.getByRole('heading', { name: 'Category' })).toBeVisible();
    await expect(settings.getByLabel('Option 1 label')).toHaveValue('Software');
    await expect(settings.getByLabel('Option 3 label')).toHaveValue('Hardware');
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);

    // the Table column menu has the settings too
    await page.getByRole('button', { name: 'Category column menu' }).first().click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(settings.getByRole('heading', { name: 'Category' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);

    // the sheet settings page lists the fields; Edit opens the same field settings
    await page.goto(`${list}/settings`);
    const fields = page.getByRole('list', { name: 'Fields' });
    await expect(fields.getByRole('listitem')).toHaveCount(2);
    await expect(fields.getByRole('listitem').filter({ hasText: 'Category' })).toContainText(
      'Dropdown',
    );
    await fields.getByRole('button', { name: 'Edit Category' }).click();
    await expect(settings.getByRole('heading', { name: 'Category' })).toBeVisible();
    await expect(settings.getByLabel('Option 3 label')).toHaveValue('Hardware');
    await settings.getByLabel('Option 3 label').fill('Hardware and devices');
    const saved = nextAnswer(page);
    await settings.getByRole('button', { name: 'Save' }).click();
    await saved;
    await expect(settings).toHaveCount(0);
    // renaming the option keeps the value (values are stored by id)
    await page.goto(list);
    await expect(cellButton()).toContainText('Hardware and devices');
  });

  test('a locked field offers no Add or Edit options to editors, and viewers get no picker', async ({
    page,
    browser,
  }) => {
    await signIn(page, 'maria@example.com');
    const { sheet, item, list } = await categorySheet(page);
    await rest(page, `fields?id=eq.${sheet.field('category')}`, {
      method: 'PATCH',
      body: { locked: true },
    });

    // the owner may change a locked field
    await page.goto(list);
    await categoryCell(page, sheet, item).dblclick();
    await page.keyboard.type('Hardware');
    await expect(page.getByRole('option', { name: 'Add “Hardware”' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit options' })).toBeVisible();
    await page.keyboard.press('Escape');
    await popoverGone(page);

    // an editor still picks a value, but cannot add options or open the options
    const james = await as(browser, 'james@example.com');
    await james.goto(list);
    await categoryCell(james, sheet, item).dblclick();
    const listbox = james.getByRole('listbox', { name: 'Category' });
    await expect(listbox).toBeVisible();
    await james.keyboard.type('Hardware');
    await expect(james.getByText('No matches')).toBeVisible();
    await expect(listbox.getByRole('option')).toHaveCount(0);
    await expect(james.getByRole('button', { name: 'Edit options' })).toHaveCount(0);
    await james.getByRole('combobox', { name: 'Search category' }).fill('');
    const answered = nextAnswer(james);
    await listbox.getByRole('option', { name: 'Process' }).click();
    await answered;
    await expect(categoryCell(james, sheet, item)).toContainText('Process');
    // nothing was added to the locked field
    expect((await categoryOptions(james, sheet)).map((o) => o.label)).toEqual([
      'Software',
      'Process',
    ]);
    await james.context().close();

    // a viewer opens no picker at all
    const vic = await as(browser, 'vic@example.com');
    await vic.goto(list);
    await categoryCell(vic, sheet, item).dblclick();
    await expect(
      vic.getByText('You can view this sheet. Ask an editor or admin to change it.').first(),
    ).toBeVisible();
    await expect(vic.getByRole('listbox', { name: 'Category' })).toHaveCount(0);
    await expect(vic.getByRole('option', { name: /^Add/ })).toHaveCount(0);
    await vic.context().close();
  });
});

test.describe('phone', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'phone layout'));

  test('on a phone a new option is added from the item panel', async ({ page }) => {
    await signIn(page, 'james@example.com');
    const { sheet, list } = await categorySheet(page);
    await page.goto(list);
    await page.getByTestId('item-card').filter({ hasText: 'Laptop not encrypted' }).click();
    const panel = page.getByRole('dialog');
    await panel.getByRole('button', { name: /^Edit Category/ }).click();
    await expect(page.getByRole('combobox', { name: 'Search category' })).toBeFocused();
    await page.keyboard.type('Hardware');
    const added = nextAnswer(page);
    await page.getByRole('option', { name: 'Add “Hardware”' }).click();
    await added;
    await expect(page.getByRole('listbox', { name: 'Category' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /^Edit Category/ })).toContainText('Hardware');
    expect((await categoryOptions(page, sheet)).map((o) => o.label)).toContain('Hardware');
  });
});
