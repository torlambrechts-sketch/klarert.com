import { expect, test, type Page } from '@playwright/test';
import { rest, signIn } from './helpers';

// Per-sheet tabs (docs/02 sheets.settings.tabs, docs/05 §3): owners and admins order, hide and rename a sheet's tabs;
// editors and viewers see the result and cannot change it. Uses the seed (pnpm seed): maria@example.com owner,
// james@example.com editor, vic@example.com viewer of /meridian. Each test makes its own Tracker sheet (no starting
// tabs: today's order Table, Insights, Board, Calendar, Form).

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const views = (page: Page) => page.getByRole('navigation', { name: 'Views' });
const tabLinks = (page: Page) => views(page).getByRole('link');

async function trackerSheet(page: Page) {
  const name = `Tabs ${unique()}`;
  await page.goto('/meridian/s/new?start=tracker');
  await page.getByLabel('Sheet name').fill(name);
  await expect(page.getByLabel('ID prefix')).not.toHaveValue('');
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const prefix = Array.from(
    { length: 5 },
    () => letters[Math.floor(Math.random() * letters.length)],
  ).join('');
  await page.getByLabel('ID prefix').fill(`${prefix}-`);
  await page.getByRole('button', { name: 'Create sheet' }).click();
  await expect(page).toHaveURL(/\/meridian\/s\/[0-9a-f-]{36}$/);
  const url = page.url();
  return { url, sheetId: url.split('/s/')[1]!, name };
}

async function openCustomise(page: Page) {
  await views(page).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Customise tabs' }).click();
}

test('an admin orders, hides and renames tabs; others see them and cannot change them', async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name === 'phone',
    'desktop popover; the phone test covers the bottom sheet',
  );
  await signIn(page, 'maria@example.com');
  const sheet = await trackerSheet(page);
  const [org] = await rest<{ id: string }[]>(page, 'orgs?slug=eq.meridian&select=id');
  // a shared form view with a public link
  const [form] = await rest<{ id: string }[]>(page, 'views?select=id', {
    method: 'POST',
    body: {
      org_id: org!.id,
      sheet_id: sheet.sheetId,
      name: 'Report a problem',
      type: 'form',
      config: { form: { fields: [] } },
      position: 'b0',
    },
  });
  const [link] = await rest<{ token: string }[]>(page, 'form_links?select=token', {
    method: 'POST',
    body: { org_id: org!.id, sheet_id: sheet.sheetId, view_id: form!.id },
  });
  await page.reload();
  await expect(tabLinks(page)).toHaveText([
    /Table/,
    /Insights/,
    /Board/,
    /Calendar/,
    /Report a problem/,
  ]);

  await openCustomise(page);
  const editor = page.getByRole('dialog', { name: 'Customise tabs' });
  await expect(editor).toBeVisible();
  const rows = editor.getByRole('list', { name: 'Tabs' });
  // the Table is pinned: shown, cannot be hidden
  await expect(rows.getByRole('checkbox', { name: 'Show Table' })).toBeChecked();
  await expect(rows.getByRole('checkbox', { name: 'Show Table' })).toBeDisabled();
  await expect(rows.getByRole('img', { name: 'Table is always shown' })).toBeVisible();

  // Board first after the Table, with the keyboard (Alt+↑)
  await rows.getByRole('button', { name: /^Move Board/ }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(editor.getByText('Board moved to position 2 of 5.')).toBeAttached();
  // hide Calendar and the form
  await rows.getByRole('checkbox', { name: 'Show Calendar' }).uncheck();
  await rows.getByRole('checkbox', { name: 'Show Report a problem' }).uncheck();
  await expect(rows.getByText('Public form link stays active')).toBeVisible();
  // rename Insights inline: Esc cancels, Enter saves
  await rows.getByRole('button', { name: 'Rename Insights' }).click();
  await rows.getByLabel('Name of the Insights tab').fill('Nope');
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  await rows.getByRole('button', { name: 'Rename Insights' }).click();
  await rows.getByLabel('Name of the Insights tab').fill('Dashboard');
  await page.keyboard.press('Enter');
  // the preview follows
  await expect(editor.getByRole('list', { name: 'Preview' }).getByRole('listitem')).toHaveText([
    /Table/,
    /Board/,
    /Dashboard/,
  ]);
  await expect(editor.getByText(/Customised: these tabs differ/)).toBeVisible();
  await editor.getByRole('button', { name: 'Save tabs' }).click();
  await expect(page.getByText('Tabs saved.')).toBeVisible();
  await expect(
    page.getByText(
      'Tabs changed: renamed Insights to Dashboard, hid Calendar, hid Report a problem, changed the order',
    ),
  ).toBeVisible();
  await expect(editor).toBeHidden();
  await expect(tabLinks(page)).toHaveText([/Table/, /Board/, /Dashboard/]);

  // hidden tabs are in More and still open by URL
  await views(page).getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('group', { name: 'Hidden tabs' })).toContainText('Calendar');
  await page.keyboard.press('Escape');
  await page.goto(`${sheet.url}?view=calendar`);
  await expect(views(page).getByRole('link', { name: 'Calendar' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();

  // the sheet's activity log has the change (sheets.update on the sheet's chain)
  const [entry] = await rest<{ new_value: { settings: { tabs: unknown[] } } }[]>(
    page,
    `activity_log?sheet_id=eq.${sheet.sheetId}&action=eq.sheets.update&order=id.desc&limit=1&select=new_value`,
  );
  expect(entry!.new_value.settings.tabs).toEqual([
    { id: 'table' },
    { id: 'kanban' },
    { id: 'insights', label: 'Dashboard' },
    { id: 'calendar', hidden: true },
    { id: 'form', hidden: true },
  ]);

  // hiding Form keeps its public link working
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(`/f/${link!.token}`);
  await expect(visitor.getByRole('button', { name: 'Send' })).toBeVisible();
  await visitorContext.close();

  // an editor and a viewer see the same tabs and cannot open Customise tabs
  for (const email of ['james@example.com', 'vic@example.com']) {
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await signIn(other, email);
    await other.goto(sheet.url);
    await expect(tabLinks(other)).toHaveText([/Table/, /Board/, /Dashboard/]);
    await views(other).getByRole('button', { name: 'More' }).click();
    const item = other.getByRole('menuitem', { name: 'Customise tabs' });
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await item.hover();
    await expect(other.getByRole('tooltip')).toHaveText('Only owners and admins can change tabs');
    // choosing it does nothing (Playwright does not click aria-disabled items; Enter is what a person can do)
    await item.focus();
    await other.keyboard.press('Enter');
    await expect(other.getByRole('dialog', { name: 'Customise tabs' })).toHaveCount(0);
    await ctx.close();
  }
});

test('customise tabs in a bottom sheet on a phone, and reset to the built-in tabs', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout');
  await signIn(page, 'maria@example.com');
  await trackerSheet(page);
  await openCustomise(page);
  const sheetDialog = page.getByRole('dialog', { name: 'Customise tabs' });
  await expect(sheetDialog).toBeVisible();
  // anchored to the bottom of the screen, full width
  const box = (await sheetDialog.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(844);
  expect(Math.round(box.width)).toBe(390);
  await sheetDialog.getByRole('checkbox', { name: 'Show Calendar' }).uncheck();
  await sheetDialog.getByRole('button', { name: 'Save tabs' }).click();
  await expect(page.getByText('Tabs saved.')).toBeVisible();
  await expect(sheetDialog).toBeHidden();
  await expect(views(page).getByRole('link', { name: 'Calendar' })).toHaveCount(0);

  await openCustomise(page);
  await sheetDialog.getByRole('button', { name: 'Reset to built-in tabs' }).click();
  await sheetDialog.getByRole('button', { name: 'Reset tabs' }).click();
  await expect(sheetDialog.getByText(/Customised: these tabs differ/)).toHaveCount(0);
  await sheetDialog.getByRole('button', { name: 'Save tabs' }).click();
  await expect(sheetDialog).toBeHidden();
  await expect(views(page).getByRole('link', { name: 'Calendar' })).toBeVisible();
});
