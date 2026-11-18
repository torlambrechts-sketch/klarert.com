import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { idsOf, seedWorkspace } from './first-sheet-helpers';
import { signIn, openTab, viewTab } from './helpers';

// The Insights view (docs/05 §3.6) and the comment marker on rows and cards (docs/05 §3.1), against a workspace
// seeded with the first-sheet template: Corrective actions has five items (statuses Investigating, Action set, Stuck,
// New, Verifying; owners Tom, Maria, James; two due dates in the past) and no comments.

test.describe.configure({ mode: 'serial' });

let slug = '';
test.beforeAll(() => {
  slug = seedWorkspace('fs-ins');
});

const views = (page: Page) => page.getByRole('navigation', { name: 'Views' });
const card = (page: Page, title: string) =>
  page
    .locator('section[data-widget]')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const widgetTypes = (page: Page) =>
  page
    .locator('section[data-widget]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-widget')));
const lastRow = (page: Page) => page.getByRole('group', { name: /^Row \d+$/ }).last();

async function axe(page: Page, what: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 160)).join(' | ')}`),
    `${what}: serious or critical axe violations`,
  ).toEqual([]);
}

async function addWidget(
  page: Page,
  slot: Locator,
  type: string,
  setup?: (d: Locator) => Promise<void>,
) {
  await slot.click();
  const dialog = page.getByRole('dialog', { name: 'Add widget' });
  await dialog.getByRole('button', { name: type, exact: true }).click();
  await expect(dialog.getByRole('button', { name: type, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  if (setup) await setup(dialog);
  await dialog.getByRole('button', { name: 'Add widget' }).click();
  await expect(dialog).toBeHidden();
}

test('Insights: default layout, customise every widget type, save, reload, filter the Table', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'phone', 'desktop layout');
  test.setTimeout(180_000);
  await signIn(page, 'maria@example.com', `/${slug}/home`);
  const ids = await idsOf(page, slug);
  const ca = ids.sheets['Corrective actions']!;
  await page.goto(`/${slug}/s/${ca}?view=insights`);

  // the default layout, worked out from the fields
  await expect(viewTab(page, 'Insights')).toHaveAttribute('aria-current', 'page');
  await expect(card(page, 'Total items')).toContainText('5');
  await expect(card(page, 'Completed')).toContainText('0');
  await expect(card(page, 'Overdue')).toContainText('of 5 items');
  await expect(card(page, 'By status')).toContainText('Investigating');
  await expect(card(page, 'By owner')).toBeVisible();
  await expect(card(page, 'Overdue · oldest first')).toContainText('Supplier evaluations overdue');
  const before = await widgetTypes(page);
  expect(before).toEqual(['kpi', 'kpi', 'kpi', 'kpi', 'bars', 'cols', 'bars', 'list']);
  await axe(page, 'Insights');

  // edit mode: two new rows with a layout each, one widget of every type
  await page.getByRole('button', { name: 'Customize' }).click();
  await expect(page.getByRole('region', { name: 'Editing layout' })).toBeVisible();
  await page.getByRole('button', { name: 'Add row' }).click();
  await page.getByRole('button', { name: '1/3 + 1/3 + 1/3', exact: true }).click();
  const slots = () => lastRow(page).getByRole('button', { name: 'Add widget', exact: true });
  await expect(slots()).toHaveCount(3);
  await addWidget(page, slots().first(), 'Number', async (d) => {
    await d.getByLabel('Show', { exact: true }).selectOption({ label: 'Open items' });
  });
  await addWidget(page, slots().first(), 'Bar list');
  await addWidget(page, slots().first(), 'Column chart');
  await expect(slots()).toHaveCount(0);
  await page.getByRole('button', { name: 'Add row' }).click();
  await page.getByRole('button', { name: '1/4 + 1/4 + 1/4 + 1/4', exact: true }).click();
  await addWidget(page, slots().first(), 'Donut', async (d) => {
    await d.getByLabel('Group by').selectOption({ label: 'Owner' });
  });
  await addWidget(page, slots().first(), 'Progress');
  await addWidget(page, slots().first(), 'Item list');
  await addWidget(page, slots().first(), 'Note', async (d) => {
    await d.getByLabel('Text').fill('Target: nothing overdue by the audit.');
    await d.getByLabel('Title').fill('Audit target');
  });
  expect(await widgetTypes(page)).toEqual([
    ...before,
    'kpi',
    'bars',
    'cols',
    'donut',
    'progress',
    'list',
    'note',
  ]);
  await expect(card(page, 'Open items')).toContainText('of 5 items');
  await expect(card(page, 'By owner').last()).toContainText('%');
  await expect(card(page, 'Audit target')).toContainText('Target: nothing overdue by the audit.');

  // edit one: the new bar list groups open items by severity
  await card(page, 'By status')
    .last()
    .getByRole('button', { name: /^Widget options/ })
    .click();
  await page.getByRole('menuitem', { name: 'Configure…' }).click();
  const edit = page.getByRole('dialog', { name: 'Configure widget' });
  await edit.getByLabel('Group by').selectOption({ label: 'Severity' });
  await edit.getByLabel('Show', { exact: true }).selectOption({ label: 'Open items' });
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(card(page, 'By severity')).toContainText('This sheet · Open items');

  // resize: narrower, wider, and wider again where the row has no room
  const open = card(page, 'Open items');
  await open.getByRole('button', { name: 'Narrower (Open items)' }).click();
  await expect(open.getByLabel('Width 1/4')).toBeVisible();
  await open.getByRole('button', { name: 'Wider (Open items)' }).click();
  await expect(open.getByLabel('Width 1/3')).toBeVisible();
  await open.getByRole('button', { name: 'Wider (Open items)' }).click();
  await expect(
    page.getByText('There is no room in this row. Narrow or remove a widget first.'),
  ).toBeVisible();
  await expect(open.getByLabel('Width 1/3')).toBeVisible();

  // move: the note to the left of the list, then back with the keyboard (drag and drop)
  await card(page, 'Audit target')
    .getByRole('button', { name: /^Widget options/ })
    .click();
  await page.getByRole('menuitem', { name: 'Move left' }).click();
  expect((await widgetTypes(page)).slice(-2)).toEqual(['note', 'list']);
  await card(page, 'Audit target').getByRole('button', { name: 'Move Audit target' }).focus();
  // dnd-kit starts a keyboard drag on Space and moves on the next frames: give each key a moment
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await widgetTypes(page)).slice(-2)).toEqual(['list', 'note']);

  // remove the progress widget
  await card(page, 'Completion')
    .getByRole('button', { name: /^Widget options/ })
    .click();
  await page.getByRole('menuitem', { name: 'Remove widget' }).click();
  await expect(card(page, 'Completion')).toHaveCount(0);

  // Done saves the layout as the shared Insights view; it is still there after a reload
  await page
    .getByRole('region', { name: 'Editing layout' })
    .getByRole('button', { name: 'Done' })
    .click();
  await expect(page.getByRole('region', { name: 'Editing layout' })).toBeHidden({
    timeout: 30_000,
  });
  await expect(page.getByText('View saved and shared.')).toBeVisible();
  await expect(page).toHaveURL(/view=[0-9a-f-]{36}/);
  await expect(viewTab(page, 'Insights')).toHaveAttribute('aria-current', 'page');
  const saved = await widgetTypes(page);
  await page.reload();
  await expect(card(page, 'Audit target')).toBeVisible();
  expect(await widgetTypes(page)).toEqual(saved);
  await expect(card(page, 'By severity')).toBeVisible();

  // an item list row opens the item in the panel
  await card(page, 'Overdue · oldest first')
    .getByRole('button', { name: 'Supplier evaluations overdue', exact: true })
    .click();
  await expect(page).toHaveURL(/item=/);
  await expect(page.getByRole('dialog')).toContainText('Supplier evaluations overdue');
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/item=/);

  // a bar opens the Table filtered to that value
  await card(page, 'By status')
    .first()
    .getByRole('button', { name: /^Stuck/ })
    .click();
  await expect(viewTab(page, 'Table')).toHaveAttribute('aria-current', 'page');
  // the Table's Filter ▾ is on, with Stuck ticked in its Status column (docs/18 §4)
  const filterMenu = page.getByTestId('filter-menu');
  await expect(filterMenu).toHaveAccessibleName('Filter, 1 on');
  await filterMenu.click();
  await expect(page.getByRole('menuitemcheckbox', { name: /^Stuck/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Guard bypassed on press 3', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Burrs on bracket 44-210', exact: true }),
  ).toHaveCount(0);

  // a bar of another field: a removable filter chip (Corrective actions starts with Insights hidden: it is in More)
  await views(page).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Insights' }).click();
  await card(page, 'By severity').getByRole('button').filter({ hasText: /\d$/ }).first().click();
  await expect(viewTab(page, 'Table')).toHaveAttribute('aria-current', 'page');
  const chip = page.getByRole('button', { name: /^Remove filter Severity: / });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(chip).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Burrs on bracket 44-210', exact: true }),
  ).toBeVisible();
});

test('a comment shows as a marker on its row and Kanban card at once and after a reload', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'phone', 'desktop table');
  await signIn(page, 'maria@example.com', `/${slug}/home`);
  const ids = await idsOf(page, slug);
  const ca = ids.sheets['Corrective actions']!;
  const item = await ids.item('Corrective actions', 'Shared admin account on firewall');
  await page.goto(`/${slug}/s/${ca}?view=table&item=${item.display_id}`);
  const row = page.getByRole('row').filter({
    has: page.getByRole('button', { name: 'Shared admin account on firewall', exact: true }),
  });
  await expect(row.getByText(/comments?$/)).toHaveCount(0);

  const dialog = page.getByRole('dialog');
  await openTab(dialog, /^Updates/);
  await dialog
    .getByRole('combobox', { name: 'Write an update' })
    .fill('Admin account disabled.\nNew accounts per person.');
  await dialog.getByRole('button', { name: 'Post update' }).click();
  await expect(page.getByText('Update posted.')).toBeVisible();
  await page.keyboard.press('Escape');

  const marker = row.locator('[data-comments]');
  await expect(row.getByText('1 comment', { exact: true })).toBeAttached();
  await expect(marker).toHaveAttribute(
    'title',
    '1 comment. Latest from Maria Pereira: “Admin account disabled.”',
  );

  await page.reload();
  await expect(marker).toHaveAttribute('data-comments', '1');

  await page.goto(`/${slug}/s/${ca}?view=kanban`);
  const kanbanCard = page
    .getByTestId('kanban-card')
    .filter({ hasText: 'Shared admin account on firewall' });
  await expect(kanbanCard.locator('[data-comments="1"]')).toBeVisible();
});

test('phone: Insights cards fill the width, and item cards show the comment marker', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout');
  await signIn(page, 'maria@example.com', `/${slug}/home`);
  const ids = await idsOf(page, slug);
  const ca = ids.sheets['Corrective actions']!;
  await page.goto(`/${slug}/s/${ca}?view=insights`);
  const first = page.locator('section[data-widget]').first();
  await expect(first).toBeVisible();
  const box = (await first.boundingBox())!;
  expect(box.width).toBeGreaterThan(330);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // a comment posted on the phone shows on the item's card
  const item = await ids.item('Corrective actions', 'Burrs on bracket 44-210');
  await page.goto(`/${slug}/s/${ca}?view=table&item=${item.display_id}`);
  const dialog = page.getByRole('dialog');
  await openTab(dialog, /^Updates/);
  await dialog.getByRole('combobox', { name: 'Write an update' }).fill('Lot 2210 quarantined.');
  await dialog.getByRole('button', { name: 'Post update' }).click();
  await expect(page.getByText('Update posted.')).toBeVisible();
  await page.keyboard.press('Escape');
  const cardEl = page.getByTestId('item-card').filter({ hasText: 'Burrs on bracket 44-210' });
  await expect(cardEl.locator('[data-comments="1"]')).toBeVisible();
  await expect(cardEl.getByText('1 comment', { exact: true })).toBeAttached();
});
