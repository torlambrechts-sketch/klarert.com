import { expect, test, type Locator, type Page } from '@playwright/test';
import { nextAnswer } from './automation-helpers';
import { idsOf, seedWorkspace } from './first-sheet-helpers';
import { rest, signIn, panelTab } from './helpers';

// M10 keyboard pass (docs/08-accessibility.md): a core flow with the keyboard only — add an item, set its status,
// open its panel, post an update, close the panel — on the seeded first-sheet template. After the page loads, every
// step is a key press: no clicks.

test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop keyboard'));

/** Press Tab (or Shift+Tab) until `target` has the focus. Fails after `max` presses. */
async function tabTo(page: Page, target: Locator, { max = 120, back = false } = {}) {
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
  }
  await expect(target).toBeFocused();
}

/** The grid's active cell (aria-activedescendant). */
const activeCell = (page: Page) =>
  page.getByRole('grid').evaluate((el) => el.getAttribute('aria-activedescendant'));

test('keyboard only: add an item, set its status, open it, post an update, close it', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const slug = seedWorkspace('fs-kb');
  await signIn(page, 'maria@example.com', `/${slug}/home`);
  const ids = await idsOf(page, slug);
  const ca = ids.sheets['Corrective actions']!;
  await page.goto(`/${slug}/s/${ca}?view=table`);
  await expect(page.locator('[data-testid="inbox-button"][data-state-loaded]')).toBeVisible();
  await expect(page.getByRole('grid').getByText('Guard bypassed on press 3')).toBeVisible();

  // 1. add an item: Tab to "+ New corrective action" (Tab inside the grid moves between cells, like a spreadsheet),
  // Enter opens the New item dialog (docs/05 §3.7) with the name focused; its required Owner is picked with the keys
  // (Due date starts from its default), then Create
  const newButton = page.getByRole('button', { name: 'New corrective action' });
  await tabTo(page, newButton);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'New corrective action' });
  await expect(dialog.getByRole('textbox', { name: /^Name/ })).toBeFocused();
  await page.keyboard.type('Loose cable at line 4');
  await tabTo(page, dialog.getByRole('button', { name: /^Owner/ }));
  await page.keyboard.press('Enter');
  const owners = page.getByRole('listbox', { name: 'Owner' });
  await expect(owners).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(owners).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /^Owner/ })).toContainText('Maria Pereira');
  await tabTo(page, dialog.getByRole('button', { name: 'Create', exact: true }));
  let answered = nextAnswer(page);
  await page.keyboard.press('Enter');
  await answered;
  await expect(dialog).toHaveCount(0);
  await expect(newButton).toBeFocused();
  await expect(
    page.getByRole('grid').getByText('Loose cable at line 4', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('grid').locator('[id^="cell-temp-"]')).toHaveCount(0);
  const item = await ids.item('Corrective actions', 'Loose cable at line 4');

  // 2. into the grid, down to the new item, right to Status, Enter, pick with the arrows, Enter
  await tabTo(page, page.getByRole('grid'));
  for (let i = 0; i < 20 && (await activeCell(page)) !== `cell-${item.id}-name`; i += 1)
    await page.keyboard.press('ArrowDown');
  expect(await activeCell(page)).toBe(`cell-${item.id}-name`);
  // the CAPA sheet has sub-items (Steps): → on a parent's name opens them first (docs/05 §3.2 Keys)
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('grid').getByRole('button', { name: `Hide steps of ${item.display_id}` }),
  ).toHaveAttribute('aria-expanded', 'true');
  expect(await activeCell(page)).toBe(`cell-${item.id}-name`);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const statuses = page.getByRole('listbox', { name: 'Status' });
  await expect(statuses).toBeVisible();
  // New is selected; one down is Investigating
  await page.keyboard.press('ArrowDown');
  answered = nextAnswer(page);
  await page.keyboard.press('Enter');
  await answered;
  await expect(statuses).toHaveCount(0);
  const row = page.getByRole('grid').getByRole('row').filter({ hasText: 'Loose cable at line 4' });
  await expect(row).toContainText('Investigating');

  // 3. back to the name, Space opens the panel
  await expect(page.getByRole('grid')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  expect(await activeCell(page)).toBe(`cell-${item.id}-name`);
  await page.keyboard.press('Space');
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('heading', { name: 'Loose cable at line 4' })).toBeVisible();

  // 4. the Updates tab (tabs: Tab reaches the selected one, arrows move between them), write, post
  await tabTo(page, panel.getByRole('tab', { name: 'Details' }));
  // tab order: Details, the sub-items (Steps), then More ▾ with Files, Updates, Activity log (docs/05 §3.4, docs/18 §3)
  await page.keyboard.press('ArrowRight');
  await expect(panelTab(panel, /^Steps/)).toBeFocused();
  // Tab leaves the tabs for More ▾; Enter opens it on its first item, ↓ moves, Enter picks
  await page.keyboard.press('Tab');
  const more = panel.locator('[role="tablist"] [data-testid="overflow-tabs-more"]');
  await expect(more).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemradio', { name: /^Files/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: /^Updates/ })).toBeFocused();
  await page.keyboard.press('Enter');
  const updatesTab = panelTab(panel, /^Updates/);
  await expect(updatesTab).toBeFocused();
  // the Updates tab is the one shown
  await expect(panel.getByRole('combobox', { name: 'Write an update' })).toBeVisible();
  const box = panel.getByRole('combobox', { name: 'Write an update' });
  await tabTo(page, box);
  await page.keyboard.type('Cable tied back, checking the other lines.');
  await tabTo(page, panel.getByRole('button', { name: 'Post update' }));
  answered = nextAnswer(page);
  await page.keyboard.press('Enter');
  await answered;
  await expect(panel.getByRole('list', { name: 'Updates' })).toContainText(
    'Cable tied back, checking the other lines.',
  );

  // 5. Esc closes; the focus is back in the grid, on the item it was opened from
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('grid')).toBeFocused();
  expect(await activeCell(page)).toBe(`cell-${item.id}-name`);

  const [saved] = await rest<{ values: Record<string, unknown> }[]>(
    page,
    `items?id=eq.${item.id}&select=values`,
  );
  expect(saved!.values[await ids.field('Corrective actions', 'status')]).toBe('opt_investigating');
});
