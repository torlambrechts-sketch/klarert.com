import { expect, test, type Page } from '@playwright/test';
import { generateNKeysBetween } from 'fractional-indexing';
import { rest, signIn } from './helpers';

// Wide tables (docs/05 §3.1): column groups defined by owners and admins (a group's columns sit together), collapsed
// per view into a stub, the view bar (saved Table views as chips, Show all, the unsaved dot, Save as view…, Update),
// "Hidden · N", edge shadows, ←/→ sideways scrolling with the grid focused, the pinned scrollbar, the current row while
// the item panel is open, and phone cards. Uses the seed: maria@example.com owns /meridian. Each test makes its own
// Tracker sheet with eight extra text columns, so the table is wider than the window.

test.describe.configure({ mode: 'default' });

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const prefix = () =>
  Array.from({ length: 5 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');

async function wideSheet(page: Page) {
  await page.goto('/meridian/s/new?start=tracker');
  await page.getByLabel('Sheet name').fill(`Wide ${unique()}`);
  await expect(page.getByLabel('ID prefix')).not.toHaveValue('');
  await page.getByLabel('ID prefix').fill(`${prefix()}-`);
  await page.getByRole('button', { name: 'Create sheet' }).click();
  await expect(page).toHaveURL(/\/meridian\/s\/[0-9a-f-]{36}$/);
  const url = page.url();
  const sheetId = url.split('/s/')[1]!;
  const [sheet] = await rest<{ org_id: string }[]>(page, `sheets?id=eq.${sheetId}&select=org_id`);
  const existing = await rest<{ position: string }[]>(
    page,
    `fields?sheet_id=eq.${sheetId}&select=position&order=position.desc&limit=1`,
  );
  const keys = generateNKeysBetween(existing[0]!.position, null, 8);
  await rest(page, 'fields', {
    method: 'POST',
    body: keys.map((position, i) => ({
      org_id: sheet!.org_id,
      sheet_id: sheetId,
      key: `note_${i + 1}`,
      name: `Note ${i + 1}`,
      type: 'text',
      position,
      width: 180,
      config: {},
    })),
  });
  const groups = await rest<{ id: string; name: string }[]>(
    page,
    `groups?sheet_id=eq.${sheetId}&order=position&select=id,name`,
  );
  const items = generateNKeysBetween(null, null, 3);
  await rest(page, 'rpc/create_items', {
    method: 'POST',
    body: {
      p_sheet: sheetId,
      p_group: groups[0]!.id,
      p_rows: ['Fix guard rail', 'Replace eye-wash', 'Calibrate scale'].map((name, i) => ({
        name,
        position: items[i],
        values: {},
      })),
    },
  });
  await page.reload();
  return { url, sheetId };
}

const grid = (page: Page) => page.getByRole('grid');
const chips = (page: Page) => page.getByRole('tablist', { name: 'Saved views of this table' });
const chip = (page: Page, name: string | RegExp) => chips(page).getByRole('tab', { name });
/** Column names of the first card's header row, in order (the rendered ones). */
const headers = (page: Page) =>
  grid(page)
    .getByRole('row')
    .filter({ has: page.getByRole('columnheader') })
    .first()
    .getByRole('button', { name: / column menu$/ })
    .evaluateAll((els) =>
      els
        .map((el) => ({
          name: el.getAttribute('aria-label')!.replace(/ column menu$/, ''),
          left: el.getBoundingClientRect().left,
        }))
        .sort((a, b) => a.left - b.left)
        .map((x) => x.name),
    );

test.describe('desktop', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop table'));

  test('an admin groups columns, collapses a group, saves views as chips and updates one', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, 'maria@example.com');
    await wideSheet(page);
    await expect(grid(page).getByText('Fix guard rail', { exact: true })).toBeVisible();

    // groups: "Plan" gets Due date and Note 2; Note 2 moves next to Due date
    await page.getByRole('button', { name: /^Columns/ }).click();
    await page.getByRole('button', { name: 'Edit column groups' }).click();
    await page.getByLabel('New group').fill('Plan');
    await page.getByRole('button', { name: 'Add group' }).click();
    await expect(page.getByText('Added Plan.')).toBeVisible();
    await page.getByLabel('Add a column to Plan').selectOption('due_date');
    await expect(page.getByRole('list', { name: 'Columns in Plan' })).toContainText('Due date');
    await page.getByLabel('Add a column to Plan').selectOption('note_2');
    await expect(page.getByRole('list', { name: 'Columns in Plan' })).toContainText('Note 2');
    await page.keyboard.press('Escape');
    await expect
      .poll(async () => {
        const h = await headers(page);
        return h.slice(h.indexOf('Due date'), h.indexOf('Due date') + 2);
      })
      .toEqual(['Due date', 'Note 2']);
    // the label line: Plan over its two columns
    const plan = grid(page).getByRole('button', { name: /^Plan/, expanded: true }).first();
    await expect(plan).toContainText('2');

    // collapse Plan: a stub "Plan · 2 hidden" and "Hidden · 2"
    await plan.click();
    await expect(grid(page).getByRole('button', { name: 'Plan · 2 hidden' }).first()).toBeVisible();
    await expect(
      grid(page)
        .getByRole('button', { name: /column menu$/ })
        .filter({ hasText: 'Due date' }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Hidden · 2' })).toBeVisible();
    // hide Note 8 too: Hidden · 3; the button opens the Columns menu at its hidden list
    await page.getByRole('button', { name: /^Columns/ }).click();
    // unticked, the column moves to the hidden list
    await page.getByRole('checkbox', { name: 'Show Note 8' }).click();
    await expect(page.getByRole('button', { name: 'Show Note 8' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Hidden · 3' }).click();
    await expect(page.getByRole('heading', { name: 'Hidden · 3' })).toBeFocused();
    await page.keyboard.press('Escape');

    // save it as a shared view: the chip appears, chosen
    await page.getByRole('button', { name: 'Save view' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('View name').fill('Essentials');
    await dialog.getByRole('checkbox', { name: /Share with everyone/ }).check();
    await dialog.getByRole('button', { name: 'Save view' }).click();
    await expect(chip(page, 'Essentials')).toHaveAttribute('aria-selected', 'true');
    await expect(chip(page, 'Essentials')).not.toContainText('unsaved');

    // Show all, then back to Essentials
    await chip(page, 'Show all').click();
    await expect(chip(page, 'Show all')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: /^Hidden ·/ })).toHaveCount(0);
    await expect(
      grid(page).getByRole('button', { name: 'Due date column menu' }).first(),
    ).toBeVisible();
    await chip(page, 'Essentials').click();
    await expect(chip(page, 'Essentials')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Hidden · 3' })).toBeVisible();

    // a change: the unsaved dot and Update
    await grid(page).getByRole('button', { name: /^Plan/, expanded: false }).first().click();
    await expect(chip(page, 'Essentials')).toContainText('unsaved changes');
    await page.getByRole('button', { name: 'Update “Essentials”' }).click();
    await expect(page.getByText('“Essentials” updated.')).toBeVisible();
    await expect(chip(page, 'Essentials')).not.toContainText('unsaved');
    await page.reload();
    await expect(chip(page, 'Essentials')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Hidden · 1' })).toBeVisible();

    // another change saved as a new view from the bar
    await grid(page).getByRole('button', { name: /^Plan/, expanded: true }).first().click();
    await page.getByRole('button', { name: 'Save as view…' }).click();
    await dialog.getByLabel('View name').fill('Auditor');
    await dialog.getByRole('button', { name: 'Save view' }).click();
    await expect(chip(page, 'Auditor')).toHaveAttribute('aria-selected', 'true');
    await expect(chip(page, 'Essentials')).toHaveAttribute('aria-selected', 'false');
  });

  test('an editor cannot change groups; edge shadows, ←/→ and the pinned scrollbar scroll the table', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, 'james@example.com');
    await wideSheet(page);
    await page.getByRole('button', { name: /^Columns/ }).click();
    await expect(page.getByRole('checkbox', { name: 'Show Note 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit column groups' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    const g = grid(page);
    const left = () => g.evaluate((el) => el.scrollLeft);
    await expect(g.getByText('Fix guard rail', { exact: true })).toBeVisible();
    // more columns to the right: the right edge shadow; nothing scrolled yet: no left one
    await expect(g).toHaveAttribute('data-more-right', 'true');
    await expect(page.locator('[data-edge="right"]')).toBeVisible();
    await expect(g).toHaveAttribute('data-scrolled-left', 'false');
    await expect(page.getByRole('button', { name: 'More columns →' })).toHaveCount(0);

    // focus with no active cell: → scrolls by at least a column, ← back
    await g.focus();
    expect(await g.getAttribute('aria-activedescendant')).toBeNull();
    await page.keyboard.press('ArrowRight');
    await expect.poll(left).toBeGreaterThanOrEqual(80);
    await expect(g).toHaveAttribute('data-scrolled-left', 'true');
    const once = await left();
    await page.keyboard.press('ArrowRight');
    await expect.poll(left).toBeGreaterThanOrEqual(once + 80);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(left).toBe(once);
    // the name column's edge line once scrolled
    const nameCell = g
      .locator('[data-cell$="|name"]')
      .first()
      .locator('xpath=ancestor::*[contains(@class,"sticky")][1]');
    await expect
      .poll(() => nameCell.evaluate((el) => getComputedStyle(el).boxShadow))
      .not.toBe('none');

    // a smooth scroll on the grid moves it all the way (the pinned bar does not pull it back)
    await g.evaluate((el) => el.scrollTo({ left: 0 }));
    await expect.poll(left).toBe(0);
    await g.evaluate((el) => el.scrollBy({ left: 400, behavior: 'smooth' }));
    await expect.poll(left).toBeGreaterThanOrEqual(395);
    // dragging the pinned scrollbar moves the table with it
    const bar = page.locator('[data-scrollbar]');
    await expect.poll(() => bar.evaluate((el) => el.scrollLeft)).toBeGreaterThanOrEqual(395);
    await bar.hover();
    await bar.evaluate((el) => {
      el.scrollLeft = 120;
    });
    await expect.poll(left).toBe(120);

    // a cell arrow still moves the active cell
    await g.locator('[data-cell$="|name"]').first().click();
    await page.keyboard.press('ArrowRight');
    await expect(g).toHaveAttribute('aria-activedescendant', /-[0-9a-f-]{36}$/);
  });

  test('the item panel’s item is the current row, and J / K move it', async ({ page }) => {
    await signIn(page, 'james@example.com');
    await wideSheet(page);
    await grid(page).getByRole('button', { name: 'Fix guard rail', exact: true }).click();
    // the panel is a modal dialog: the grid leaves the accessibility tree while it is open
    const current = page.locator('[role="grid"] [data-current="true"]');
    await expect(current).toContainText('Fix guard rail');
    await expect(page.getByRole('dialog').first()).toContainText('Fix guard rail');
    await page.keyboard.press('j');
    await expect(current).toContainText('Replace eye-wash');
    await page.keyboard.press('k');
    await expect(current).toContainText('Fix guard rail');
    await page.keyboard.press('Escape');
    await expect(current).toHaveCount(0);
  });
});

test('390 px: cards stay as they are and the view chips scroll sideways', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'phone cards');
  await signIn(page, 'maria@example.com');
  await wideSheet(page);
  await expect(page.getByRole('grid')).toHaveCount(0);
  await expect(page.getByText('Fix guard rail', { exact: true })).toBeVisible();
  const list = chips(page);
  await expect(list).toBeVisible();
  expect(await list.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
  // the save actions live in the Columns menu here
  await expect(page.getByRole('button', { name: 'Save as view…' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
