import { expect, test, type Locator, type Page } from '@playwright/test';
import { seedWorkspace } from './first-sheet-helpers';
import { signIn } from './helpers';

// Organising the side menu (docs/05 §2.1, docs/02 §1 folders): "+" for a new folder, inline rename, drag and drop,
// Alt+arrow keys, "Move to…", archive and restore, permissions per role, and starts that bring their folder.
// Each test seeds its own workspace (folder "Your sheets" with Corrective actions and Actions).

const menu = (page: Page) => page.getByRole('navigation', { name: 'Side menu' });
const folder = (scope: Locator, name: string) => scope.getByRole('region', { name, exact: true });
const sheetsIn = (region: Locator) =>
  region.locator('[data-testid^="rail-sheet-"]').allInnerTexts();
const clean = (texts: string[]) => texts.map((t) => t.replace(/^\S+\s+/, '').trim());

/** Run a step and wait until the server action it starts has answered (moves are optimistic). */
async function saved(page: Page, step: () => Promise<unknown>) {
  const answered = page.waitForResponse(
    (r) => r.request().method() === 'POST' && !!r.request().headers()['next-action'],
  );
  await step();
  await answered;
}

async function dragOnto(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + 40, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + a.height / 2 - 8, { steps: 4 });
  await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.describe('desktop', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop menu'));

  test('admin creates a folder, renames it inline, drags sheets in, reorders with Alt+↓ and moves with "Move to…"', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const slug = seedWorkspace('fo-admin');
    await signIn(page, 'maria@example.com', `/${slug}/home`);
    const nav = menu(page);

    await nav.getByRole('heading', { name: 'Sheets', exact: true }).hover();
    await nav.getByRole('button', { name: 'Add a sheet or folder' }).click();
    await expect(
      // folders can be restricted (Access, docs/02 §16): the note says where (docs/05 §2.1)
      page.getByText(
        'Folders organise sheets. To choose who sees a folder’s sheets, use Access in its menu.',
      ),
    ).toBeVisible();
    await page.getByRole('menuitem', { name: 'New folder' }).click();
    const name = nav.getByRole('textbox', { name: 'Folder name' });
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute('placeholder', 'Folder name');
    await name.fill('Risk');
    await name.press('Enter');
    await expect(page.getByText('Folder created.')).toBeVisible();
    // new folders go to the top
    await expect(nav.getByRole('region').first()).toHaveAccessibleName('Risk');

    // inline rename: double-click, Escape cancels; F2, Enter saves
    await nav.getByRole('button', { name: 'Risk', exact: true }).dblclick();
    await nav.getByRole('textbox', { name: 'Folder name' }).fill('Nothing');
    await page.keyboard.press('Escape');
    await expect(nav.getByRole('button', { name: 'Risk', exact: true })).toBeVisible();
    await nav.getByRole('button', { name: 'Risk', exact: true }).focus();
    await page.keyboard.press('F2');
    await nav.getByRole('textbox', { name: 'Folder name' }).fill('Risk and controls');
    await saved(page, () => page.keyboard.press('Enter'));
    const risk = folder(nav, 'Risk and controls');
    await expect(risk).toBeVisible();

    // drag both sheets onto the folder header: each goes to the end
    const header = nav.getByRole('button', { name: 'Risk and controls', exact: true });
    await saved(page, () =>
      dragOnto(page, nav.getByRole('link', { name: 'Corrective actions' }), header),
    );
    await expect(risk.getByRole('link', { name: 'Corrective actions' })).toBeVisible();
    await saved(page, () =>
      dragOnto(page, nav.getByRole('link', { name: 'Actions', exact: true }), header),
    );
    await expect(risk.getByRole('link', { name: 'Actions', exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Actions moved to' })).toHaveText(
      'Actions moved to Risk and controls, position 2 of 2',
    );
    await page.reload();
    await expect
      .poll(async () => clean(await sheetsIn(risk)))
      .toEqual(['Corrective actions', 'Actions']);
    await expect(folder(nav, 'Your sheets').getByText('No sheets in this folder')).toBeVisible();

    // keyboard: Alt+↓ moves Corrective actions below Actions, focus stays on it, the order survives a reload
    await risk.getByRole('link', { name: 'Corrective actions' }).focus();
    await saved(page, () => page.keyboard.press('Alt+ArrowDown'));
    await expect
      .poll(async () => clean(await sheetsIn(risk)))
      .toEqual(['Actions', 'Corrective actions']);
    await expect(risk.getByRole('link', { name: 'Corrective actions' })).toBeFocused();
    await page.reload();
    await expect
      .poll(async () => clean(await sheetsIn(risk)))
      .toEqual(['Actions', 'Corrective actions']);

    // "Move to…" with a search
    await risk.getByRole('link', { name: 'Actions', exact: true }).hover();
    await nav.getByRole('button', { name: 'More for Actions' }).click();
    await page.getByRole('menuitem', { name: 'Move to…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Move Actions to…' });
    await dialog.getByLabel('Find a folder').fill('your');
    await saved(page, () => dialog.getByRole('button', { name: 'Your sheets' }).click());
    await expect(
      folder(nav, 'Your sheets').getByRole('link', { name: 'Actions', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      folder(nav, 'Your sheets').getByRole('link', { name: 'Actions', exact: true }),
    ).toBeVisible();

    // the moves are in the activity log with readable wording
    await page.goto(`/${slug}/settings?tab=archived`);
    const log = page.getByRole('list', { name: 'Folder and sheet changes' });
    await expect(
      log.getByText('Moved Actions from Risk and controls to Your sheets'),
    ).toBeVisible();
    await expect(log.getByText('Reordered sheets in Risk and controls')).toBeVisible();
    await expect(log.getByText('Renamed folder Risk to Risk and controls')).toBeVisible();
  });

  test('archive a folder with its sheets and restore them together from Workspace admin', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const slug = seedWorkspace('fo-archive');
    await signIn(page, 'maria@example.com', `/${slug}/home`);
    const nav = menu(page);
    await nav.getByRole('button', { name: 'Your sheets', exact: true }).hover();
    await nav.getByRole('button', { name: 'More for folder Your sheets' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    const dialog = page.getByRole('dialog', { name: 'Archive Your sheets and its 2 sheets?' });
    await expect(dialog.getByText('Corrective actions')).toBeVisible();
    await dialog.getByRole('button', { name: 'Archive folder and sheets' }).click();
    await expect(page.getByText('Archived Your sheets and 2 sheets.')).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Your sheets', exact: true })).toHaveCount(0);
    await expect(nav.getByText('No sheets yet.')).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Create your first sheet' })).toBeVisible();

    await page.goto(`/${slug}/settings?tab=archived`);
    const archived = page.getByRole('list', { name: 'Archived folders' });
    await expect(archived.getByText('2 sheets: Actions, Corrective actions')).toBeVisible();
    await page.getByRole('button', { name: 'Restore folder Your sheets' }).click();
    await expect(page.getByText('Restored Your sheets and 2 sheets.')).toBeVisible();
    await expect(
      folder(nav, 'Your sheets').getByRole('link', { name: 'Corrective actions' }),
    ).toBeVisible();
    await expect(page.getByText('No archived folders.')).toBeVisible();
  });

  test('a sheet from the CAPA start goes into "Audit and CAPA", created once and then reused', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const slug = seedWorkspace('fo-capa');
    await signIn(page, 'maria@example.com', `/${slug}/home`);
    const nav = menu(page);
    for (const [sheet, option] of [
      ['Nonconformities', 'Audit and CAPA (new folder)'],
      ['Customer complaints', 'Audit and CAPA'],
    ] as const) {
      await page.goto(`/${slug}/s/new`);
      await page
        .getByRole('main')
        .getByRole('link', { name: /^Corrective action \(CAPA\)/ })
        .click();
      await expect(page.getByLabel('Folder', { exact: true }).locator('option:checked')).toHaveText(
        option,
      );
      await page.waitForLoadState('networkidle');
      await page.getByLabel('Sheet name').fill(sheet);
      await page.getByRole('button', { name: 'Create sheet' }).click();
      await expect(page).toHaveURL(/\/s\/[0-9a-f-]{36}/);
      await expect(folder(nav, 'Audit and CAPA').getByRole('link', { name: sheet })).toBeVisible();
    }
    await expect(nav.getByRole('region', { name: 'Audit and CAPA' })).toHaveCount(1);

    // the person can choose another folder: "New sheet here" preselects that folder
    await nav.getByRole('button', { name: 'Your sheets', exact: true }).hover();
    await nav.getByRole('button', { name: 'More for folder Your sheets' }).click();
    await page.getByRole('menuitem', { name: 'New sheet here' }).click();
    await page
      .getByRole('main')
      .getByRole('link', { name: /^Internal audit/ })
      .click();
    await expect(page.getByLabel('Folder', { exact: true }).locator('option:checked')).toHaveText(
      'Your sheets',
    );
  });

  test('an editor moves sheets but cannot change folders; a viewer sees no controls', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const slug = seedWorkspace('fo-roles');
    await signIn(page, 'james@example.com', `/${slug}/home`);
    const nav = menu(page);
    await nav.getByRole('heading', { name: 'Sheets', exact: true }).hover();
    await nav.getByRole('button', { name: 'Add a sheet or folder' }).click();
    await expect(page.getByRole('menuitem', { name: 'New sheet' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'New folder' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await nav.getByRole('button', { name: 'Your sheets', exact: true }).hover();
    await nav.getByRole('button', { name: 'More for folder Your sheets' }).click();
    await expect(page.getByRole('menuitem', { name: 'New sheet here' })).toBeVisible();
    for (const item of ['Rename', 'Sort A–Z', 'Archive', 'Move up'])
      await expect(page.getByRole('menuitem', { name: item })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(nav.getByRole('button', { name: 'Drag Your sheets' })).toHaveCount(0);

    await nav.getByRole('link', { name: 'Actions', exact: true }).hover();
    await nav.getByRole('button', { name: 'More for Actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Archive' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Move to…' }).click();
    await saved(page, () =>
      page.getByRole('dialog').getByRole('button', { name: 'No folder' }).click(),
    );
    await expect(
      folder(nav, 'Other sheets').getByRole('link', { name: 'Actions', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      folder(nav, 'Other sheets').getByRole('link', { name: 'Actions', exact: true }),
    ).toBeVisible();
    // and back in with a drag
    await saved(page, () =>
      dragOnto(
        page,
        nav.getByRole('link', { name: 'Actions', exact: true }),
        nav.getByRole('button', { name: 'Your sheets', exact: true }),
      ),
    );
    await expect(
      folder(nav, 'Your sheets').getByRole('link', { name: 'Actions', exact: true }),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');

    await page.context().clearCookies();
    await signIn(page, 'vic@example.com', `/${slug}/home`);
    await expect(nav.getByRole('link', { name: 'Corrective actions' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Add a sheet or folder' })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: /^Drag / })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: /^More for / })).toHaveCount(0);
  });
});

test('390 px: no drag handles, the "…" menu moves a sheet', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout');
  test.setTimeout(120_000);
  const slug = seedWorkspace('fo-phone');
  await signIn(page, 'maria@example.com', `/${slug}/home`);
  await page
    .getByRole('navigation', { name: 'Bottom bar' })
    .getByRole('button', { name: 'Menu' })
    .click();
  const sheet = page.getByRole('dialog', { name: 'Menu' });
  await expect(sheet.getByRole('link', { name: 'Corrective actions' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /^Drag / })).toHaveCount(0);
  const more = sheet.getByRole('button', { name: 'More for Actions' });
  await expect(more).toBeVisible();
  await more.click();
  await page.getByRole('menuitem', { name: 'Move to…' }).click();
  await page
    .getByRole('dialog', { name: 'Move Actions to…' })
    .getByRole('button', { name: 'No folder' })
    .click();
  await expect(
    folder(sheet, 'Other sheets').getByRole('link', { name: 'Actions', exact: true }),
  ).toBeVisible();
});
