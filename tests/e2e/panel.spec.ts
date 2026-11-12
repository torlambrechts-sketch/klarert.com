import { expect, test, type Page } from '@playwright/test';
import { rest, signIn } from './helpers';

// M5: the item panel, updates with mentions, the activity log, files and two-way links. Uses the seed (pnpm seed):
// maria@example.com owner (Compliance manager), james@example.com editor, tom@example.com editor (HSE manager).
// Each test creates its own sheets from the Tracker start (Owner, Status, Priority, Due date, Progress).

test.describe.configure({ mode: 'default' });
const desktopOnly = () =>
  test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop panel'));

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const grid = (page: Page) => page.getByRole('grid');
const panel = (page: Page) => page.getByRole('dialog');

async function trackerSheet(page: Page, name = `Panel ${unique()}`) {
  await page.goto('/meridian/s/new?start=tracker');
  await page.getByLabel('Sheet name').fill(name);
  await expect(page.getByLabel('ID prefix')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Create sheet' }).click();
  await expect(page).toHaveURL(/\/meridian\/s\/[0-9a-f-]{36}$/);
  // M6: sheets open in the List view; these tests work in the Grid
  const url = `${page.url()}?view=grid`;
  await page.goto(url);
  await expect(page.getByRole('grid')).toBeVisible();
  return url;
}

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

const openByName = (page: Page, name: string) =>
  grid(page).getByRole('button', { name, exact: true }).click();

async function itemByName(page: Page, sheetUrl: string, name: string) {
  const sheetId = sheetUrl.match(/\/s\/([0-9a-f-]{36})/)![1]!;
  const rows = await rest<{ id: string; display_id: string }[]>(
    page,
    `items?sheet_id=eq.${sheetId}&name=eq.${encodeURIComponent(name)}&select=id,display_id`,
  );
  return rows[0]!;
}

async function addField(page: Page, search: string, label: RegExp) {
  await grid(page).getByRole('button', { name: 'Add a field' }).first().click();
  await page.getByLabel('Search field types').fill(search);
  await page.getByRole('button', { name: label }).first().click();
  await expect(page.getByText('Field added.')).toBeVisible();
}

test.describe('phone', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'phone layout'));
  test('on a phone the panel fills the screen above the bottom bar', async ({ page }) => {
    await signIn(page, 'james@example.com');
    const url = await trackerSheet(page);
    await addItems(page, 'Open', ['Phone item']);
    const item = await itemByName(page, url, 'Phone item');
    await page.goto(`${url}&item=${item.display_id}`);
    const dialog = panel(page);
    await expect(dialog.getByRole('heading', { name: 'Phone item' })).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(390);
    expect(box.y + box.height).toBe(844 - 64);
    await expect(dialog.getByRole('button', { name: 'Expand' })).toBeHidden();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('desktop', () => {
  desktopOnly();
  test('the panel opens from a name and a deep link, moves with J and K, edits and closes with Esc', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page, 'james@example.com');
    const url = await trackerSheet(page);
    await addItems(page, 'Open', ['First thing', 'Second thing', 'Third thing']);
    const second = await itemByName(page, url, 'Second thing');

    await openByName(page, 'Second thing');
    const dialog = panel(page);
    await expect(dialog.getByRole('heading', { name: 'Second thing' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]item=${second.display_id}$`));
    await expect(dialog).toContainText(second.display_id);
    await expect(dialog).toContainText('› Open');
    await expect(dialog.getByRole('tab', { name: 'Details' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(
      dialog.getByText('Automations that run on this item will be listed here.'),
    ).toBeVisible();

    // J next, K previous
    await page.keyboard.press('j');
    await expect(dialog.getByRole('heading', { name: 'Third thing' })).toBeVisible();
    await page.keyboard.press('k');
    await page.keyboard.press('k');
    await expect(dialog.getByRole('heading', { name: 'First thing' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Next item (J)' }).click();
    await expect(dialog.getByRole('heading', { name: 'Second thing' })).toBeVisible();

    // Copy link gives the absolute deep link
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByText('Link copied.')).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(`${new URL(url).origin}${new URL(url).pathname}?item=${second.display_id}`);

    // Expand widens the drawer
    const narrow = (await dialog.boundingBox())!.width;
    await dialog.getByRole('button', { name: 'Expand' }).click();
    await expect.poll(async () => (await dialog.boundingBox())!.width).toBeGreaterThan(narrow);
    await dialog.getByRole('button', { name: 'Narrow view' }).click();

    // edit a field with the registry editor, and rename inline
    await dialog.getByRole('button', { name: /^Edit Status/ }).click();
    await page.getByRole('option', { name: 'Working on it' }).click();
    await expect(dialog.getByRole('button', { name: 'Edit Status: Working on it' })).toBeVisible();
    // the status popover stays the top layer until its exit animation ends, taking clicks and Esc meanwhile
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Rename' }).click();
    await dialog.getByRole('textbox', { name: 'Task name' }).fill('Second thing, renamed');
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('heading', { name: 'Second thing, renamed' })).toBeVisible();

    // Esc closes and the grid shows the changes
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page).not.toHaveURL(/item=/);
    const row = grid(page).getByRole('row').filter({ hasText: 'Second thing, renamed' });
    await expect(row).toContainText('Working on it');
    // focus went back to where the panel was opened from
    await expect(
      grid(page).getByRole('button', { name: 'Second thing, renamed', exact: true }),
    ).toBeFocused();

    // a deep link opens the panel on load
    await page.goto(`${url}&item=${second.display_id}`);
    await expect(panel(page).getByRole('heading', { name: 'Second thing, renamed' })).toBeVisible();
  });

  test('updates mention people and job roles, notify them, and can be edited for 15 minutes', async ({
    page,
    browser,
  }) => {
    await signIn(page, 'james@example.com');
    const url = await trackerSheet(page);
    await addItems(page, 'Open', ['Check the fire doors']);
    const item = await itemByName(page, url, 'Check the fire doors');
    await openByName(page, 'Check the fire doors');
    const dialog = panel(page);
    await dialog.getByRole('tab', { name: /^Updates/ }).click();
    await expect(dialog.getByText('No updates yet. Post the first one.')).toBeVisible();

    const box = dialog.getByRole('combobox', { name: 'Write an update' });
    await box.click();
    await page.keyboard.type('Please review @Mar');
    await expect(page.getByRole('option', { name: /Maria Pereira/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await page.keyboard.type('and @HSE');
    await page.getByRole('option', { name: /HSE manager/ }).click();
    await page.keyboard.type('today.');
    await expect(box).toHaveValue('Please review @Maria Pereira and @HSE manager today.');
    await dialog.getByRole('button', { name: 'Post update' }).click();
    await expect(page.getByText('Update posted. 2 people notified.')).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Updates · 1' })).toBeVisible();
    const feed = dialog.getByRole('list', { name: 'Updates' });
    await expect(feed).toContainText('Please review @Maria Pereira and @HSE manager today.');

    // the mentioned people have a notification (RLS: each reads only their own)
    for (const who of ['maria@example.com', 'tom@example.com']) {
      const other = await browser.newPage();
      await signIn(other, who);
      const rows = await rest<{ kind: string; body: string }[]>(
        other,
        `notifications?item_id=eq.${item.id}&select=kind,body`,
      );
      expect(rows).toEqual([
        expect.objectContaining({
          kind: 'mention',
          body: expect.stringContaining(`James Okafor mentioned you on ${item.display_id}`),
        }),
      ]);
      await other.close();
    }
    const mine = await rest<unknown[]>(page, `notifications?item_id=eq.${item.id}&select=id`);
    expect(mine).toHaveLength(0);

    // edit within the 15 minutes; the activity log records it
    await feed.getByRole('button', { name: 'Edit' }).click();
    await dialog.getByRole('combobox', { name: 'Edit your update' }).fill('Reviewed, all fine.');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Update changed.')).toBeVisible();
    await expect(feed).toContainText('Reviewed, all fine.');
    await dialog.getByRole('tab', { name: /^Activity log/ }).click();
    await expect(dialog.getByRole('list', { name: 'Activity log' })).toContainText(
      'James Okafor · Edited an update',
    );

    // delete it again
    await dialog.getByRole('tab', { name: /^Updates/ }).click();
    await feed.getByRole('button', { name: 'Delete' }).click();
    await feed.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Update deleted.')).toBeVisible();
    await expect(dialog.getByText('No updates yet. Post the first one.')).toBeVisible();
  });

  test('the activity log reads as sentences and the audit trail verifies', async ({ page }) => {
    await signIn(page, 'james@example.com');
    await trackerSheet(page);
    await addItems(page, 'Open', ['Replace extinguisher']);
    await openByName(page, 'Replace extinguisher');
    const dialog = panel(page);
    await dialog.getByRole('button', { name: /^Edit Status/ }).click();
    await page.getByRole('option', { name: 'Working on it' }).click();
    await expect(dialog.getByRole('button', { name: 'Edit Status: Working on it' })).toBeVisible();
    await dialog.getByRole('button', { name: /^Edit Status/ }).click();
    await page.getByRole('option', { name: 'Done' }).click();
    await expect(dialog.getByRole('button', { name: 'Edit Status: Done' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Rename' }).click();
    await dialog.getByRole('textbox', { name: 'Task name' }).fill('Replace both extinguishers');
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('heading', { name: 'Replace both extinguishers' })).toBeVisible();

    await dialog.getByRole('tab', { name: /^Activity log/ }).click();
    const log = dialog.getByRole('list', { name: 'Activity log' });
    await expect(log.getByRole('listitem')).toHaveCount(4);
    const lines = await log.getByRole('listitem').allInnerTexts();
    expect(lines[0]).toContain(
      'James Okafor · Renamed: “Replace extinguisher” → “Replace both extinguishers”',
    );
    expect(lines[1]).toContain('Status: Working on it → Done');
    expect(lines[2]).toContain('Status set to Working on it');
    expect(lines[3]).toContain('Created in Open');
    expect(lines[0]).toMatch(/hash [0-9a-f]{8}/);
    await expect(dialog.getByRole('tab', { name: 'Activity log · 4' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Verify audit trail' }).click();
    await expect(dialog.getByRole('status').filter({ hasText: 'Audit trail intact' })).toHaveText(
      'Audit trail intact. 4 entries recomputed.',
    );
  });

  test('evidence uploads with a checksum, shows freshness, keeps old versions and downloads', async ({
    page,
  }) => {
    await signIn(page, 'james@example.com');
    await trackerSheet(page);
    await addItems(page, 'Open', ['Fire drill']);
    await addField(page, 'evidence', /^Evidence/);

    // the grid's file popover points to the panel
    const evidenceCell = grid(page)
      .getByRole('row')
      .filter({ hasText: 'Fire drill' })
      .getByRole('gridcell')
      .nth(6);
    await evidenceCell.click();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Open item to upload' }).click();
    const dialog = panel(page);
    await expect(dialog.getByRole('heading', { name: 'Fire drill' })).toBeVisible();

    const pdf = (text: string) => Buffer.from(`%PDF-1.4\n${text}\n%%EOF\n`);
    let chooser = page.waitForEvent('filechooser');
    await dialog.getByRole('button', { name: 'Add file' }).click();
    await (
      await chooser
    ).setFiles({ name: 'drill.pdf', mimeType: 'application/pdf', buffer: pdf('May') });
    await expect(page.getByText('drill.pdf added.')).toBeVisible();
    const files = dialog.getByRole('list', { name: 'Evidence files' });
    await expect(files).toContainText('drill.pdf');
    await expect(dialog.getByText('Current', { exact: false }).first()).toBeVisible();
    await expect(dialog.getByText(/Valid until .* · in 365 days/)).toBeVisible();

    chooser = page.waitForEvent('filechooser');
    await files.getByRole('button', { name: 'Replace drill.pdf' }).click();
    await (
      await chooser
    ).setFiles({
      name: 'drill-v2.pdf',
      mimeType: 'application/pdf',
      buffer: pdf('June, signed'),
    });
    await expect(
      page.getByText('drill-v2.pdf replaced the old version. The old version is kept.'),
    ).toBeVisible();
    await expect(files).toContainText('drill-v2.pdf');
    await expect(files).not.toContainText('drill.pdf ');
    await dialog.getByRole('button', { name: 'Older versions · 1' }).click();
    await expect(dialog.getByRole('list', { name: 'Older versions of Evidence' })).toContainText(
      'drill.pdf',
    );

    // download through a short-lived signed URL
    const download = page.waitForEvent('download');
    await files.getByRole('button', { name: 'Download drill-v2.pdf' }).click();
    const d = await download;
    expect(d.suggestedFilename()).toBe('drill-v2.pdf');
    const res = await fetch(d.url());
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toContain('June, signed');

    await dialog.getByRole('tab', { name: /^Activity log/ }).click();
    const log = dialog.getByRole('list', { name: 'Activity log' });
    await expect(log).toContainText('Evidence: replaced drill.pdf with drill-v2.pdf');
    await expect(log).toContainText('Evidence: added drill.pdf');

    await page.keyboard.press('Escape');
    await expect(evidenceCell).toContainText('1 file');
    await expect(evidenceCell).toContainText('Current');
  });

  test('a two-way link field from the wizard shows on both sheets, and lookups and rollups read it', async ({
    page,
  }) => {
    await signIn(page, 'james@example.com');
    const risksName = `Risks ${unique()}`;
    const risksUrl = await trackerSheet(page, risksName);
    await addItems(page, 'Open', ['Loose handrail', 'Wet floor']);
    const handrailRow = grid(page).getByRole('row').filter({ hasText: 'Loose handrail' });
    await handrailRow.getByRole('gridcell').nth(2).click();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: 'Done' }).click();
    await expect(handrailRow).toContainText('Done');

    // a new sheet with a link column to the risks, shown on the risks sheet too
    const actionsName = `Actions ${unique()}`;
    await page.goto('/meridian/s/new?start=tracker');
    await page.getByLabel('Sheet name').fill(actionsName);
    await expect(page.getByLabel('ID prefix')).not.toHaveValue('');
    await page.getByRole('button', { name: 'Add field' }).click();
    const n = await page.getByRole('list', { name: 'Fields' }).getByRole('listitem').count();
    await page.getByLabel(`Name of field ${n}`).fill('Risks');
    await page.getByLabel(`Type of field ${n}`).selectOption({ label: 'Link to items' });
    await page.getByLabel(`Sheet that field ${n} links to`).selectOption({ label: risksName });
    await page.getByLabel(`Show on ${risksName} too`).check();
    await page.getByRole('button', { name: 'Create sheet' }).click();
    await expect(page).toHaveURL(/\/meridian\/s\/[0-9a-f-]{36}$/);
    const actionsUrl = `${page.url()}?view=grid`;
    await page.goto(actionsUrl);
    await addItems(page, 'Open', ['Fix the handrail']);

    // link from the action's panel with the picker
    await openByName(page, 'Fix the handrail');
    const dialog = panel(page);
    await dialog.getByRole('button', { name: /^Edit Risks/ }).click();
    await page.getByRole('textbox', { name: 'Search items for Risks' }).fill('handrail');
    await page.getByRole('checkbox', { name: /Loose handrail/ }).check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const linked = dialog.getByRole('list', { name: 'Linked items' });
    await expect(linked).toContainText('Loose handrail');
    await expect(dialog.getByRole('heading', { name: 'Linked items · 1' })).toBeVisible();
    await page.keyboard.press('Escape');

    // lookup and rollup through the link
    await addField(page, 'lookup', /^Lookup/);
    let settings = page.getByRole('dialog');
    await grid(page).getByRole('button', { name: 'Lookup column menu' }).first().click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    settings = page.getByRole('dialog');
    await settings.getByLabel('Through link field').selectOption({ label: 'Risks' });
    await settings.getByLabel('Field key on the linked sheet').fill('status');
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Field settings saved.')).toBeVisible();
    await addField(page, 'rollup', /^Rollup/);
    await grid(page).getByRole('button', { name: 'Rollup column menu' }).first().click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    settings = page.getByRole('dialog');
    await settings.getByLabel('Through link field').selectOption({ label: 'Risks' });
    await settings.getByLabel('Calculation').selectOption('pctDone');
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Field settings saved.')).toBeVisible();
    const actionRow = grid(page).getByRole('row').filter({ hasText: 'Fix the handrail' });
    await expect(actionRow).toContainText('Done');
    await expect(actionRow).toContainText('100%');
    await page.reload();
    await expect(grid(page).getByRole('row').filter({ hasText: 'Fix the handrail' })).toContainText(
      '100%',
    );

    // the risks sheet got the inverse field, filled in both directions
    await page.goto(risksUrl);
    await expect(
      grid(page)
        .getByRole('button', { name: `${actionsName} column menu` })
        .first(),
    ).toBeVisible();
    const action = await itemByName(page, actionsUrl, 'Fix the handrail');
    await expect(grid(page).getByRole('row').filter({ hasText: 'Loose handrail' })).toContainText(
      action.display_id,
    );
    await openByName(page, 'Loose handrail');
    await expect(panel(page).getByRole('list', { name: 'Linked items' })).toContainText(
      'Fix the handrail',
    );

    // editing the other side updates both: unlink from the risk
    await panel(page)
      .getByRole('button', { name: new RegExp(`^Edit ${actionsName}`) })
      .click();
    await page.getByRole('button', { name: `Remove ${action.display_id}` }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(panel(page).getByRole('heading', { name: 'Linked items · 0' })).toBeVisible();
    await page.goto(`${actionsUrl}&item=${action.display_id}`);
    await expect(panel(page).getByRole('heading', { name: 'Linked items · 0' })).toBeVisible();
  });
});
