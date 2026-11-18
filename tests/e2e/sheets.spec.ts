import { expect, test, type Page } from '@playwright/test';
import { signIn, viewTab, openViewTab } from './helpers';

// M3: app shell, new sheet wizard, CSV import, copy, sheet settings and groups.
// Uses the seed (pnpm seed): james@example.com is an editor of /meridian, vic@example.com a viewer.

// One worker runs this file in order: most tests sign in as the same seeded editor.
test.describe.configure({ mode: 'default' });

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function createFromStart(page: Page, start: string, name: string) {
  await page.goto(`/meridian/s/new?start=${start}`);
  await page.getByLabel('Sheet name').fill(name);
  await expect(page.getByLabel('ID prefix')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Create sheet' }).click();
  await expect(page).toHaveURL(/\/meridian\/s\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  return page.url();
}

async function importCsv(page: Page, name: string, csv: string) {
  await page.goto('/meridian/s/new?start=csv');
  await page.getByLabel('Sheet name').fill(name);
  await page.getByLabel('CSV text').fill(csv);
  await expect(page.getByRole('heading', { name: 'Confirm the fields' })).toBeVisible();
}

test.describe('desktop', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop layout'));

  test('editor creates a sheet from the Tracker start and sees it in the rail with its code', async ({
    page,
  }) => {
    const name = `Tracker ${unique()}`;
    await signIn(page, 'james@example.com');
    await page.goto('/meridian/s/new');
    await expect(page.getByText('Choose a start to continue.')).toBeVisible();
    await page
      .getByRole('main')
      .getByRole('link', { name: /^Tracker/ })
      .click();
    await expect(page).toHaveURL(/start=tracker$/);

    // columns from templates/starts.json, editable
    await expect(page.getByLabel('Name of field 3')).toHaveValue('Priority');
    await expect(page.getByLabel('Type of field 3')).toHaveValue('severity');
    await expect(page.getByLabel('Items are called')).toHaveValue('Task');
    await expect(page.getByLabel('Groups')).toHaveValue('Open, Done');
    await page.getByRole('button', { name: 'Add field' }).click();
    await page.getByLabel('Name of field 6').fill('Evidence link');
    await page.getByLabel('Type of field 6').selectOption('url');
    await page.getByRole('button', { name: 'Move Evidence link up' }).click();
    await expect(page.getByLabel('Name of field 5')).toHaveValue('Evidence link');
    await page.getByRole('button', { name: 'Remove Progress' }).click();

    await page.getByLabel('Sheet name').fill(name);
    // prefix: first letters of up to three words (starts.json)
    await expect(page.getByLabel('ID prefix')).toHaveValue(/^T[A-Z0-9]*\d*-$/);
    await page.getByRole('button', { name: 'Create sheet' }).click();
    await expect(page.getByText('Sheet created.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    // a new sheet opens in the Table view, its groups as sections
    await expect(viewTab(page, 'Table')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('No items yet.').first()).toBeVisible();
    await openViewTab(page, 'Table');
    await expect(page.getByRole('heading', { name: /^Open/ })).toBeVisible();
    await expect(page.getByText('No items yet.').first()).toBeVisible();

    // the rail lists the sheet with a two-character code
    const rail = page.getByRole('navigation', { name: 'Side menu' });
    const link = rail.getByRole('link', { name });
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(link).toHaveAttribute('data-testid', /^rail-sheet-[A-Z0-9]{2}$/);
    const code = (await link.getAttribute('data-testid'))!.replace('rail-sheet-', '');
    await expect(link).toContainText(code);

    // the group menu lists the groups
    // (More ▾ › Show one group, docs/18 §4)
    await page.getByTestId('more-menu').click();
    await page.getByRole('menuitem', { name: /^Show one group/ }).click();
    await expect(page.getByRole('menuitemradio', { name: /All groups/ })).toBeVisible();
    await expect(page.getByRole('menuitemradio', { name: /Done/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // fields were created with their types and keys
    await page.getByRole('link', { name: 'Sheet settings' }).click();
    const fields = page.getByRole('list', { name: 'Fields' });
    await expect(fields.getByText('Priority', { exact: true })).toBeVisible();
    await expect(fields.getByText('{evidence_link}')).toBeVisible();
    await expect(fields.getByText('Progress', { exact: true })).toHaveCount(0);

    // the one search (the top bar's, "/") finds the sheet; the menu has no filter of its own (docs/05 §2.1)
    await expect(rail.getByRole('searchbox')).toHaveCount(0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('/');
    const search = page.getByRole('combobox', { name: 'Search sheets, items and people' });
    await expect(search).toBeFocused();
    await search.fill(name);
    await expect(page.getByRole('option', { name: new RegExp(name) }).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  });

  test('CSV import detects types, lets the person change them and creates items', async ({
    page,
  }) => {
    const name = `Imported ${unique()}`;
    await signIn(page, 'james@example.com');
    await importCsv(
      page,
      name,
      [
        'Item,Owner email,Due,Hours,Status,Website',
        'Calibrate torque wrench,grace@example.com,2026-11-25,2,Open,https://example.com',
        'Replace eye-wash station,tom@example.com,2026-12-11,4,Open,www.example.org',
        'Check ladders,amy@example.com,11/12/2026,two,Open,example.net',
      ].join('\n'),
    );
    await expect(page.getByLabel('Type of Owner email')).toHaveValue('email');
    await expect(page.getByLabel('Type of Due')).toHaveValue('date');
    await expect(page.getByLabel('Type of Hours')).toHaveValue('text');
    await expect(page.getByLabel('Type of Status')).toHaveValue('dropdown');
    await expect(page.getByLabel('Type of Website')).toHaveValue('url');
    await expect(page.getByText('3 rows will become')).toBeVisible();
    // change a type: Hours as a number; "two" does not fit and is left empty
    await page.getByLabel('Type of Hours').selectOption('number');
    await page.getByRole('button', { name: 'Import and create sheet' }).click();
    await expect(
      page.getByText(
        'Sheet created with 3 items. 1 cell was left empty: the value did not match the field type.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText('Replace eye-wash station')).toBeVisible();
    await openViewTab(page, 'Table');
    await expect(page.getByRole('button', { name: /^Imported.*3 items$/ })).toBeVisible();

    await page.getByRole('link', { name: 'Sheet settings' }).click();
    const fields = page.getByRole('list', { name: 'Fields' });
    for (const [field, type] of <[string, string][]>[
      ['Owner email', 'Email'],
      ['Due', 'Date'],
      ['Hours', 'Number'],
      ['Status', 'Dropdown'],
      ['Website', 'URL'],
    ])
      await expect(fields.getByRole('listitem').filter({ hasText: field })).toContainText(type);

    // the prefix is locked now that the sheet has items; renaming still works
    await expect(page.getByLabel('ID prefix')).toBeDisabled();
    await expect(page.getByText('Fixed once the sheet has items')).toBeVisible();
    await page.getByLabel('Sheet name').fill(`${name} renamed`);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Sheet settings saved.')).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Side menu' })
        .getByRole('link', { name: `${name} renamed` }),
    ).toBeVisible();

    // a group with items is deleted only after moving its items
    await page.getByRole('button', { name: 'New group' }).last().click();
    await page.getByRole('textbox', { name: 'New group name' }).fill('Archive');
    await page.getByRole('button', { name: 'Add group' }).click();
    await expect(page.getByLabel('Name of group Archive')).toBeVisible();
    await page.getByRole('button', { name: 'Delete Imported' }).click();
    await expect(page.getByLabel('Move its 3 items to')).toHaveValue(/.+/);
    await page.getByRole('button', { name: 'Move items and delete' }).click();
    await expect(page.getByText('Group deleted.')).toBeVisible();
    await expect(page.getByLabel('Name of group Imported')).toHaveCount(0);
    await page.getByRole('link', { name: /Back to/ }).click();
    await openViewTab(page, 'Table');
    await expect(page.getByRole('button', { name: /^Archive.*3 items$/ })).toBeVisible();
  });

  test('CSV import refuses files over the limits', async ({ page }) => {
    await signIn(page, 'james@example.com');
    await page.goto('/meridian/s/new?start=csv');
    const header = Array.from({ length: 101 }, (_, i) => `c${i}`).join(',');
    await page.getByLabel('CSV text').fill(`${header}\n`);
    await expect(page.getByText('The file has 101 columns. Import at most 100.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import and create sheet' })).toBeDisabled();
  });

  test('copy a sheet: same fields and groups, no items', async ({ page }) => {
    const source = `Register ${unique()}`;
    await signIn(page, 'james@example.com');
    await createFromStart(page, 'register', source);

    await page.goto('/meridian/s/new?start=copy');
    await page.getByLabel('Sheet to copy').selectOption({ label: source });
    await expect(page.getByLabel('Sheet name')).toHaveValue(`${source} copy`);
    await page.getByRole('button', { name: 'Copy sheet' }).click();
    await expect(page.getByText('Sheet copied. Items are not copied.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: `${source} copy` })).toBeVisible();
    await openViewTab(page, 'Table');
    await expect(page.getByRole('button', { name: /^Active.*0 items$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Retired.*0 items$/ })).toBeVisible();
    await page.getByRole('link', { name: 'Sheet settings' }).click();
    const fields = page.getByRole('list', { name: 'Fields' });
    await expect(fields.getByRole('listitem')).toHaveCount(5);
    await expect(fields.getByText('{review_date}')).toBeVisible();
  });

  test('groups: add, rename, recolour, reorder and delete when empty; prefix editable without items', async ({
    page,
  }) => {
    const name = `Log ${unique()}`;
    await signIn(page, 'james@example.com');
    const url = await createFromStart(page, 'log', name);
    await page.goto(`${url}/settings`);

    // the prefix can change while there are no items
    const prefix = `Q${unique()
      .slice(-4)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, 'Z')}-`;
    await page.getByLabel('ID prefix').fill(prefix);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Sheet settings saved.')).toBeVisible();
    await expect(page.getByLabel('ID prefix')).toHaveValue(prefix);

    const groups = page.getByRole('list', { name: 'Groups' });
    await page.getByRole('button', { name: 'New group' }).last().click();
    await page.getByRole('textbox', { name: 'New group name' }).fill('Waiting');
    await page.getByRole('button', { name: 'Add group' }).click();
    await expect(page.getByLabel('Name of group Waiting')).toBeVisible();

    await page.getByLabel('Name of group Open').fill('In progress');
    await page
      .getByRole('form', { name: 'Rename Open' })
      .getByRole('button', { name: 'Rename' })
      .click();
    await expect(page.getByText('Group renamed.')).toBeVisible();
    await expect(page.getByLabel('Name of group In progress')).toBeVisible();

    await page.getByLabel('Colour of Waiting').selectOption('purple');
    await expect(page.getByText('Group colour changed.')).toBeVisible();
    await page.getByRole('button', { name: 'Move Waiting up' }).click();
    await expect(groups.getByRole('listitem').nth(1)).toContainText('Waiting');
    await expect(page.getByText('Group moved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Colour of Waiting')).toHaveValue('purple');
    await expect(groups.getByRole('listitem').nth(1).getByRole('textbox')).toHaveValue('Waiting');

    await page.getByRole('button', { name: 'Delete Waiting' }).click();
    await page.getByRole('button', { name: 'Delete group' }).click();
    await expect(page.getByText('Group deleted.')).toBeVisible();
    await expect(page.getByLabel('Name of group Waiting')).toHaveCount(0);

    // collapse a group on the sheet page
    await page.getByRole('link', { name: /Back to/ }).click();
    await openViewTab(page, 'Table');
    const toggle = page.getByRole('button', { name: /^In progress.*0 items$/ });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // archiving is for owners and admins (docs/02 §6); it hides the sheet from the rail
    await page.goto(`${url}/settings`);
    await expect(page.getByRole('button', { name: 'Archive sheet' })).toHaveCount(0);
    await page.context().clearCookies();
    await signIn(page, 'maria@example.com', `${new URL(url, 'http://x').pathname}/settings`);
    await page.getByRole('button', { name: 'Archive sheet' }).click();
    await page.getByRole('button', { name: 'Archive sheet' }).click();
    await expect(page).toHaveURL(/\/meridian\/home$/);
    await expect(
      page.getByRole('navigation', { name: 'Side menu' }).getByRole('link', { name }),
    ).toHaveCount(0);
  });

  test('a viewer cannot create sheets', async ({ page }) => {
    await signIn(page, 'vic@example.com');
    await expect(page).toHaveURL(/\/meridian\/home$/);
    await expect(
      page
        .getByRole('navigation', { name: 'Side menu' })
        .getByRole('link', { name: 'New sheet', exact: true }),
    ).toHaveCount(0);
    await page.goto('/meridian/s/new?start=tracker');
    await expect(page.getByText('Viewers cannot create sheets.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create sheet' })).toHaveCount(0);
    // no Create button for a viewer, and a way back home (owner decision 15 Nov 2026)
    await expect(page.getByTestId('create-button')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to Home' })).toBeVisible();
  });
});

test.describe('phone', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'phone layout'));

  test('phone shows the bottom bar and the menu sheet: one Menu, one Search, one Inbox', async ({
    page,
  }) => {
    await signIn(page, 'james@example.com');
    await expect(page).toHaveURL(/\/meridian\/home$/);
    const bar = page.getByRole('navigation', { name: 'Bottom bar' });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('link')).toHaveText(['Home', 'My work']);
    await expect(bar.getByRole('button')).toHaveText(['Menu']);
    await expect(page.getByRole('complementary', { name: 'Workspace' })).toBeHidden();
    // one of each across the top bar and the bottom bar (owner decision 15 Nov 2026, UX-6)
    const visible = async (loc: ReturnType<Page['getByRole']>) => {
      let n = 0;
      for (const el of await loc.all()) if (await el.isVisible()) n += 1;
      return n;
    };
    expect(await visible(page.getByRole('button', { name: /menu$/i }))).toBe(1);
    expect(await visible(page.getByRole('combobox', { name: /^Search/ }))).toBe(1);
    expect(await visible(page.getByRole('button', { name: /^Search/ }))).toBe(0);
    expect(await visible(page.getByRole('button', { name: /^Inbox/ }))).toBe(1);
    // 44 px touch targets in the bottom bar
    for (const cell of await bar.locator('a, button').all())
      expect((await cell.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId('inbox-button')).toBeVisible();
    expect((await page.getByTestId('inbox-button').boundingBox())!.height).toBeGreaterThanOrEqual(
      44,
    );

    await bar.getByRole('button', { name: 'Menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Automations' })).toBeVisible();
    // menu rows are 44 px touch targets on a phone
    expect(
      (await menu.getByRole('link', { name: 'Home' }).boundingBox())!.height,
    ).toBeGreaterThanOrEqual(44);
    await menu.getByRole('link', { name: 'New sheet', exact: true }).click();
    await expect(menu).toBeHidden();
    // Create opens at the Sheet card (docs/05 §4 Create); Esc closes it
    const create = page.getByRole('dialog', { name: 'Create' });
    await expect(create.getByRole('link', { name: /^Tracker/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(create).toBeHidden();

    await page.getByRole('combobox', { name: 'Search sheets, items and people' }).click();
    await expect(
      page.getByRole('combobox', { name: 'Search sheets, items and people' }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await page.getByTestId('inbox-button').click();
    const inbox = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Inbox' }) });
    await expect(inbox).toBeVisible();
    // Home's "Needs you" has its own "Open My work" behind the Inbox: this is the Inbox's
    await expect(inbox.getByRole('link', { name: 'Open My work' })).toBeVisible();

    // no horizontal scrolling at 390 px
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
