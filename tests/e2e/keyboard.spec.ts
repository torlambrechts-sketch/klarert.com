import { expect, test, type Locator, type Page } from '@playwright/test';
import { nextAnswer } from './automation-helpers';
import { idsOf, seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

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
  // Enter puts the focus in the add row of the first group; type, Enter
  await tabTo(page, page.getByRole('button', { name: 'New corrective action' }));
  await page.keyboard.press('Enter');
  const add = page.getByRole('textbox', { name: 'Add corrective action to Open' });
  await expect(add).toBeFocused();
  await page.keyboard.type('Loose cable at line 4');
  let answered = nextAnswer(page);
  await page.keyboard.press('Enter');
  await answered;
  await expect(
    page.getByRole('grid').getByText('Loose cable at line 4', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('grid').locator('[id^="cell-temp-"]')).toHaveCount(0);
  const item = await ids.item('Corrective actions', 'Loose cable at line 4');
  await page.keyboard.press('Escape');

  // 2. into the grid, down to the new item, right to Status, Enter, pick with the arrows, Enter
  await tabTo(page, page.getByRole('grid'), { back: true });
  for (let i = 0; i < 20 && (await activeCell(page)) !== `cell-${item.id}-name`; i += 1)
    await page.keyboard.press('ArrowDown');
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
  await page.keyboard.press('ArrowRight');
  const updatesTab = panel.getByRole('tab', { name: /^Updates/ });
  await expect(updatesTab).toBeFocused();
  await expect(updatesTab).toHaveAttribute('aria-selected', 'true');
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
