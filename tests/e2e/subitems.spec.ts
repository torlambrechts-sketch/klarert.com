import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace } from './first-sheet-helpers';
import { accessToken, rest, signIn } from './helpers';

// Sub-items (docs/02 §12, docs/05 §3.1): a CAPA sheet from the wizard comes with "Actions" as sub-items, the
// "can't close while open" gate and a five-step template. Each test works in a fresh seeded workspace (Maria owner).

const SHOTS = process.env.SUBITEM_SHOTS;

async function createCapa(page: Page, slug: string, name: string) {
  await page.goto(`/${slug}/s/new?start=capa`);
  await expect(page.getByText('Comes with sub-items called actions.')).toBeVisible();
  await page.getByLabel('Sheet name').fill(name);
  await expect(page.getByLabel('ID prefix')).not.toHaveValue('');
  const prefix = await page.getByLabel('ID prefix').inputValue();
  await page.getByRole('button', { name: 'Create sheet' }).click();
  // the first build of the sheet page can take a while in dev
  await expect(page).toHaveURL(new RegExp(`/${slug}/s/[0-9a-f-]{36}$`), { timeout: 60_000 });
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  return { url: page.url(), sheetId: page.url().split('/').pop()!, prefix };
}

const grid = (page: Page) => page.getByRole('grid');
const row = (page: Page, text: string | RegExp) =>
  grid(page).getByRole('row').filter({ hasText: text });
/** Sub-item rows: name, Owner, Status, Due date, Evidence, actions. */
const subCell = (page: Page, displayId: string, col: number) =>
  row(page, new RegExp(`${displayId.replace('.', '\\.')}(?!\\d)`))
    .getByRole('gridcell')
    .nth(col);

async function addCapa(page: Page, name: string) {
  const add = page.getByRole('textbox', { name: /^Add capa to Open/ });
  await add.fill(name);
  await add.press('Enter');
  const r = row(page, name);
  await expect(r).toContainText(/-\d{3}/);
  // edits hold a row's automations until the person finishes it
  const done = r.getByRole('button', { name: 'Done', exact: true });
  if (await done.isVisible()) await done.click();
  return r;
}

async function pickSubStatus(page: Page, displayId: string, label: string) {
  await subCell(page, displayId, 2).dblclick();
  await page
    .getByRole('listbox', { name: 'Status' })
    .getByRole('option', { name: new RegExp(`^${label}`) })
    .click();
  await expect(subCell(page, displayId, 2)).toContainText(label);
}

test.describe('desktop', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop table'));

  test('sub-items inline and from the template, roll-up, keyboard, the close gate and both activity logs', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const slug = seedWorkspace('sub-a', { empty: true });
    await signIn(page, 'maria@example.com', `/${slug}/home`);
    const { prefix } = await createCapa(page, slug, 'CAPA register');
    const parent = await addCapa(page, 'Guard missing on press 7');
    const pid = `${prefix}001`;

    // keyboard: → on the name opens the sub-items, ← closes them
    await parent.getByText(pid, { exact: true }).click();
    await page.keyboard.press('ArrowRight');
    await expect(grid(page).getByText('No actions yet.')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(grid(page).getByText('No actions yet.')).toBeHidden();

    // the chevron, then From template: the five CAPA steps with their own ids
    await parent.getByRole('button', { name: `Show actions of ${pid}` }).click();
    await grid(page).getByRole('button', { name: 'From template' }).first().click();
    await expect(page.getByText('5 sub-items added from the template.')).toBeVisible();
    for (const [n, name] of [
      [1, 'Containment'],
      [2, 'Root cause'],
      [3, 'Correction'],
      [4, 'Corrective action'],
      [5, 'Effectiveness check'],
    ] as const)
      await expect(row(page, `${pid}.${n}`)).toContainText(name);
    await expect(parent.getByText('Actions: 0 of 5 done').first()).toBeAttached();

    // inline: "+ Add action" under the parent
    const add = page.getByRole('textbox', { name: new RegExp(`^Add action to ${pid}`) });
    await add.fill('Brief the night shift');
    await add.press('Enter');
    await expect(row(page, `${pid}.6`)).toContainText('Brief the night shift');
    await row(page, `${pid}.6`).getByRole('button', { name: /^Done/ }).click();

    // edit sub-items in their cells: the roll-up on the parent follows
    await pickSubStatus(page, `${pid}.1`, 'Done');
    await pickSubStatus(page, `${pid}.2`, 'Done');
    await pickSubStatus(page, `${pid}.3`, 'Done');
    await expect(parent.getByText('Actions: 3 of 6 done').first()).toBeAttached();
    await expect(parent).toContainText('3/6');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/subitems-table-1440.png` });

    // the gate: the CAPA cannot close while actions are open, and the message names them
    await parent.getByRole('gridcell').nth(2).dblclick();
    await page
      .getByRole('listbox', { name: 'Status' })
      .getByRole('option', { name: /^Done/ })
      .click();
    const refusal = page.getByText(
      `Actions still open: ${pid}.4 Corrective action, ${pid}.5 Effectiveness check, ${pid}.6 Brief the night shift. Close them before closing ${pid}.`,
    );
    await expect(refusal).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/subitems-gate-1440.png` });
    await expect(parent.getByRole('gridcell').nth(2)).not.toContainText('Done');

    await pickSubStatus(page, `${pid}.4`, 'Done');
    await pickSubStatus(page, `${pid}.5`, 'Done');
    await pickSubStatus(page, `${pid}.6`, 'Done');
    await expect(parent).toContainText('6/6');
    await parent.getByRole('gridcell').nth(2).dblclick();
    await page
      .getByRole('listbox', { name: 'Status' })
      .getByRole('option', { name: /^Done/ })
      .click();
    await expect(parent.getByRole('gridcell').nth(2)).toContainText('Done');

    // Ctrl+Shift+E closes every parent, again opens them
    await parent.getByText(pid, { exact: true }).click();
    await page.keyboard.press('Control+Shift+E');
    await expect(row(page, `${pid}.1`)).toHaveCount(0);
    await page.keyboard.press('Control+Shift+E');
    await expect(row(page, `${pid}.1`)).toHaveCount(1);

    // both activity logs: pointer entries on the parent, the sub-item's own chain
    await parent.getByRole('button', { name: 'Guard missing on press 7', exact: true }).click();
    const panel = page.getByRole('dialog');
    await panel.getByRole('tab', { name: 'Actions · 6' }).click();
    await expect(panel.getByText('6 of 6 done')).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/subitems-panel-1440.png` });
    await panel.getByRole('tab', { name: /^Activity log/ }).click();
    await expect(panel.getByText(`Sub-item added: ${pid}.1 “Containment”`)).toBeVisible();
    await panel.getByRole('tab', { name: 'Actions · 6' }).click();
    await panel.getByRole('button', { name: /Containment/ }).click();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).last()).toContainText(
      `${pid}/${pid}.1`,
    );
    await page
      .getByRole('dialog')
      .getByRole('tab', { name: /^Activity log/ })
      .click();
    await expect(page.getByRole('dialog').getByText(`Created under ${pid}`)).toBeVisible();
    await expect(page.getByRole('dialog').getByText(/Status (set to Done|: .* → Done)/)).toBeVisible();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: `Back to ${pid}` })
      .click();
    await expect(
      page.getByRole('dialog').getByRole('tab', { name: 'Actions · 6' }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  test('an automation adds the five steps when a CAPA is created, once the row is finished', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const slug = seedWorkspace('sub-b', { empty: true });
    await signIn(page, 'maria@example.com', `/${slug}/home`);
    const { sheetId, prefix } = await createCapa(page, slug, 'CAPA log');
    const [sheet] = await rest<{ org_id: string }[]>(page, `sheets?id=eq.${sheetId}&select=org_id`);
    const token = await accessToken(page);
    const me = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).sub as string;
    await rest(page, 'automations', {
      method: 'POST',
      body: {
        org_id: sheet!.org_id,
        sheet_id: sheetId,
        name: 'New CAPA → add the five steps',
        trigger: { type: 'item_created' },
        actions: [{ type: 'create_subitems', fromTemplate: true }],
        created_by: me,
      },
    });
    await page.reload();
    const add = page.getByRole('textbox', { name: /^Add capa to Open/ });
    await add.fill('Spill at goods-in');
    await add.press('Enter');
    const r = row(page, 'Spill at goods-in');
    await expect(r).toContainText(`${prefix}001`);
    // held until the person finishes the row: Done runs the automation once
    await r.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByText(/New CAPA → add the five steps/).first()).toBeVisible();
    await expect(r).toContainText('0/5');
    await r.getByRole('button', { name: `Show actions of ${prefix}001` }).click();
    await expect(row(page, `${prefix}001.5`)).toContainText('Effectiveness check');
  });
});

test.describe('phone', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'phone layout'));

  test('at 390 px the card shows the chip and opens a nested list with Add', async ({ page }) => {
    test.setTimeout(180_000);
    const slug = seedWorkspace('sub-c', { empty: true });
    await signIn(page, 'maria@example.com', `/${slug}/home`);
    const { prefix } = await createCapa(page, slug, 'CAPA phone');
    const add = page.getByRole('textbox', { name: /^Add capa to Open/ });
    await add.fill('Forklift near miss');
    await add.press('Enter');
    const card = page.getByTestId('item-card').filter({ hasText: 'Forklift near miss' });
    await expect(card).toContainText(`${prefix}001`);
    await card.getByRole('button', { name: /Show actions/ }).click();
    await card.getByRole('button', { name: 'From template' }).click();
    await expect(card).toContainText(`${prefix}001.5`);
    await expect(card.getByText('Actions: 0 of 5 done')).toBeAttached();
    const sub = card.getByRole('textbox', { name: `Add action to ${prefix}001` });
    await sub.fill('Mark the walkway');
    await sub.press('Enter');
    await expect(card).toContainText(`${prefix}001.6`);
    const box = await card.getByRole('button', { name: /Mark the walkway/ }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/subitems-390.png` });
    await card.getByRole('button', { name: /Containment/ }).click();
    await expect(page.getByRole('dialog').getByText(`${prefix}001.1`).first()).toBeVisible();
  });
});
