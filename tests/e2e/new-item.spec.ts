import { execFileSync } from 'node:child_process';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { localSql, seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// The New item dialog (docs/05 §3.7, owner decision 14 Nov 2026) on the Core registers 1.3.0 (Starter):
// Phase A on Nonconformities and CAPA with the standard dialog: keyboard only, a required field, "Ask when adding",
// More fields, Create and add another, "Discard this item?", the source in the activity log, the "Missing: …" marker
// and the "Missing required" filter for a row added inline. Phase B: the pack's stepped intake form ("Step 2 of 3"),
// created through createItem, and Sheet settings › New item form. Also: approving a document by hand fills in
// Approver and Approved on (the status rule no longer asks for an approver). Desktop and 390 px.

const SHOTS = process.env.NEW_ITEM_SHOTS;
test.use({ deviceScaleFactor: SHOTS ? 2 : 1 });

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Install a catalogue version of a pack with the service role (tests/e2e/install-pack-version.ts). */
function install(slug: string, key: string, version: string, level?: string) {
  execFileSync(
    'pnpm',
    [
      'exec',
      'tsx',
      '--env-file-if-exists=.env.local',
      'tests/e2e/install-pack-version.ts',
      slug,
      key,
      version,
      ...(level ? [level] : []),
    ],
    { encoding: 'utf8', stdio: 'pipe', timeout: 90_000 },
  );
}

const one = (sql: string) => localSql(sql).trim();

/** A workspace with Core 1.3.0 at Starter; the ids of its org and a Core sheet by ref. */
function coreWorkspace(prefix: string) {
  const slug = seedWorkspace(prefix, { empty: true });
  install(slug, 'core', '1.3.0', 'starter');
  const org = one(`select id from orgs where slug = '${slug}'`);
  const sheet = (ref: string) =>
    one(
      `select s.id from sheets s join pack_installs i on i.id = s.pack_install_id
        where s.org_id = '${org}' and i.pack_key = 'core' and s.pack_ref = '${ref}'`,
    );
  return { slug, org, sheet };
}

async function tabTo(page: Page, target: Locator, { max = 120 } = {}) {
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

const createdEntry = async (page: Page, itemId: string) =>
  (
    await rest<{ new_value: { source?: Record<string, string> } }[]>(
      page,
      `activity_log?item_id=eq.${itemId}&action=eq.item.created&select=new_value`,
    )
  )[0]?.new_value.source ?? null;

test('the New item dialog: keyboard only, required answers, add another, discard, Missing required', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'phone';
  const w = coreWorkspace(phone ? 'nip' : 'ni');
  const nc = w.sheet('nc');
  // the standard dialog on this sheet (its pack's intake form has its own test below), and one required field
  localSql(`update sheets set settings = settings || '{"newItemForm": false}' where id = '${nc}'`);
  localSql(`update fields set required = true where sheet_id = '${nc}' and key = 'details'`);
  await signIn(page, 'maria@example.com', `/${w.slug}/s/${nc}`);
  await page.goto(`/${w.slug}/s/${nc}`);
  await expect(
    page.getByRole('heading', { name: 'Nonconformities and CAPA', level: 1 }),
  ).toBeVisible();

  // ── Tab to "+ New nonconformity", Enter: the dialog with the name focused
  const newButton = page.getByRole('button', { name: 'New nonconformity' });
  await expect(newButton).toBeEnabled();
  await tabTo(page, newButton);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'New nonconformity' });
  await expect(dialog).toBeVisible();
  const name = dialog.getByRole('textbox', { name: /^Name/ });
  await expect(name).toBeFocused();
  // the required field and the fields Core marks "Ask when adding", with the item panel's labels; the rest folded
  await expect(dialog.getByText('What was found Required')).toBeVisible();
  for (const q of ['Found on', 'Grade', 'Owner', 'Due'])
    await expect(dialog.locator('label', { hasText: new RegExp(`^${q}$`) })).toBeVisible();
  const more = dialog.getByRole('button', { name: /^More fields/ });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  if (phone) {
    // a full-screen sheet at 390 px
    const box = await dialog.boundingBox();
    expect(Math.round(box!.width)).toBe(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  }
  await shot(page, phone ? 'dialog-390' : 'dialog-desktop');

  // ── Enter with nothing: the errors, the focus on the first
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText('2 answers need attention.');
  await expect(dialog.getByText('Name is required.')).toBeVisible();
  await expect(name).toBeFocused();
  await page.keyboard.type('Guard missing on press 3');
  await page.keyboard.press('Enter');
  await expect(dialog.getByText('What was found is required.')).toBeVisible();
  const details = dialog.getByRole('textbox', { name: /^What was found/ });
  await expect(details).toBeFocused();
  await expect(details).toHaveAttribute('aria-invalid', 'true');
  await shot(page, phone ? 'required-error-390' : 'required-error');
  await page.keyboard.type('The guard was off on the night shift.');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(newButton).toBeFocused();
  await expect(page.getByText('Nonconformity created: ')).toBeVisible();

  // one write: the item with its answer, and the activity entry says where it came from
  const [first] = await rest<{ id: string; display_id: string; values: Record<string, unknown> }[]>(
    page,
    `items?sheet_id=eq.${nc}&name=eq.Guard missing on press 3&select=id,display_id,values`,
  );
  expect(Object.values(first!.values)).toContain('The guard was off on the night shift.');
  expect(await createdEntry(page, first!.id)).toEqual({ via: 'dialog' });
  await page.goto(`/${w.slug}/s/${nc}?item=${first!.display_id}`);
  const itemPanel = page.getByRole('dialog').filter({ has: page.getByRole('tablist') });
  await itemPanel.getByRole('tab', { name: /^Activity log/ }).click();
  await expect(itemPanel.getByText('Created in Open with the New item dialog')).toBeVisible();
  await shot(page, phone ? 'activity-source-390' : 'activity-source');
  await page.keyboard.press('Escape');
  await expect(itemPanel).toBeHidden();

  // ── N opens it; Create and add another keeps the answers and says so politely
  await page.locator('h1').click();
  await page.keyboard.press('n');
  await expect(dialog).toBeVisible();
  await expect(name).toBeFocused();
  await page.keyboard.type('Loose cable at line 4');
  // Tab: the group (Open), then What was found
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('combobox', { name: 'Group' })).toHaveValue(/.+/);
  await page.keyboard.press('Tab');
  await expect(details).toBeFocused();
  await page.keyboard.type('Cable tray cover missing.');
  await tabTo(page, dialog.getByRole('button', { name: 'Create and add another' }));
  await page.keyboard.press('Enter');
  await expect(dialog.getByTestId('new-item-created')).toHaveText(
    /^Nonconformity created: NCR-\d+\. Add another\.$/,
  );
  await expect(dialog.getByTestId('new-item-created')).toHaveAttribute('aria-live', 'polite');
  await expect(name).toHaveValue('');
  await expect(name).toBeFocused();
  await expect(details).toHaveValue('Cable tray cover missing.');

  // ── closing with answers asks first; Discard stores nothing
  await page.keyboard.type('Not wanted');
  await page.keyboard.press('Escape');
  const discard = page.getByRole('alertdialog', { name: 'Discard this item?' });
  await expect(discard).toBeVisible();
  await expect(discard.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(discard.getByRole('button', { name: 'Discard' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(discard).toBeHidden();
  await expect(dialog).toBeHidden();
  expect(
    await rest<unknown[]>(page, `items?sheet_id=eq.${nc}&name=eq.Not wanted&select=id`),
  ).toHaveLength(0);
  expect(
    await rest<unknown[]>(page, `items?sheet_id=eq.${nc}&name=eq.Loose cable at line 4&select=id`),
  ).toHaveLength(1);

  // ── a row added inline may leave a required field empty: "Missing: …", and the filter
  const add = page.getByRole('textbox', { name: 'Add nonconformity to Open' }).first();
  await add.click();
  await add.fill('Added inline');
  await add.press('Enter');
  await expect(page.getByText('Added inline', { exact: true }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  const inlineRows = () =>
    rest<{ id: string }[]>(page, `items?sheet_id=eq.${nc}&name=eq.Added inline&select=id`);
  await expect.poll(async () => (await inlineRows()).length).toBe(1);
  const [inline] = await inlineRows();
  await expect.poll(() => createdEntry(page, inline!.id)).toEqual({ via: 'inline' });
  const marker = page
    .getByTestId('missing-required')
    .filter({ hasText: 'Missing: what was found' });
  await expect(marker).toHaveCount(1);
  const filter = page.getByTestId('missing-filter');
  await expect(filter).toHaveAttribute('aria-pressed', 'false');
  // the example nonconformities have What was found filled in; only the inline row misses it
  await expect(filter).toContainText('1');
  await filter.click();
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Guard missing on press 3')).toHaveCount(0);
  await expect(page.getByText('Added inline', { exact: true }).first()).toBeVisible();
  await shot(page, phone ? 'missing-390' : 'missing-marker-filter');
  await filter.click();
  await expect(page.getByText('Guard missing on press 3').first()).toBeVisible();
});

test('a stepped intake form: the pack’s New nonconformity, Step 2 of 3, and Sheet settings › New item form', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'phone';
  const w = coreWorkspace(phone ? 'nisp' : 'nis');
  const nc = w.sheet('nc');
  await signIn(page, 'maria@example.com', `/${w.slug}/s/${nc}`);
  await page.goto(`/${w.slug}/s/${nc}`);
  await page.getByRole('button', { name: 'New nonconformity' }).click();
  const dialog = page.getByRole('dialog', { name: 'New nonconformity' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Record a nonconformity');
  const step = dialog.getByTestId('new-item-step');
  await expect(step).toHaveText('Step 1 of 3');
  const name = dialog.getByRole('textbox', { name: /^The problem, in one line/ });
  await expect(name).toBeFocused();
  await name.fill('Wrong torque on line 2');
  await dialog
    .getByRole('textbox', { name: /^What did you find\?/ })
    .fill('Bolts at 40 Nm, not 55.');
  // a required question of this step is checked before the next
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText('When did you find it? is required.')).toBeVisible();
  await expect(step).toHaveText('Step 1 of 3');
  await dialog.getByRole('button', { name: /^When did you find it\?/ }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(step).toHaveText('Step 2 of 3 · Where it came from');
  await expect(dialog.getByRole('button', { name: /^Where did it come from\?/ })).toBeVisible();
  await shot(page, phone ? 'stepped-390' : 'stepped-intake');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(step).toHaveText('Step 3 of 3 · Who takes it on');
  // Back keeps the answers
  await dialog.getByRole('button', { name: 'Back' }).click();
  await expect(step).toHaveText('Step 2 of 3 · Where it came from');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog.getByText('Who takes it on? is required.')).toBeVisible();
  await dialog.getByRole('button', { name: /^Who takes it on\?/ }).click();
  await page
    .getByRole('listbox', { name: 'Owner' })
    .getByRole('option', { name: /Maria Pereira/ })
    .click();
  const done = page.getByRole('button', { name: 'Done', exact: true });
  if (await done.isVisible()) await done.click();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toBeHidden();

  // created through createItem with the form's hidden value (Stage: Containment), the form named in the entry
  const [item] = await rest<
    { id: string; values: Record<string, unknown>; source_form_id: string | null }[]
  >(page, `items?sheet_id=eq.${nc}&name=eq.Wrong torque on line 2&select=id,values,source_form_id`);
  const fid = (k: string) =>
    one(`select id from fields where sheet_id = '${nc}' and key = '${k}' and archived_at is null`);
  expect(item!.values[fid('stage')]).toBe('opt_containment');
  expect(item!.source_form_id).toBeNull();
  const form = one(
    `select id from views where sheet_id = '${nc}' and type = 'form' and pack_ref = 'nc.form.intake'`,
  );
  expect(await createdEntry(page, item!.id)).toEqual({
    via: 'dialog',
    intake_form: 'New nonconformity',
    intake_form_id: form,
  });

  // ── Sheet settings › New item form: the pack's choice, then the standard dialog
  await page.goto(`/${w.slug}/s/${nc}/settings#new-item`);
  const card = page.locator('#new-item');
  await expect(card.getByRole('radio', { name: /New nonconformity/ })).toBeChecked();
  await expect(card).toContainText('Internal · 3 steps · Draft · Chosen by the pack');
  if (!phone) await shot(page, 'settings-new-item-form');
  await card.getByRole('radio', { name: /Standard dialog/ }).check();
  await expect(page.getByText('New item form saved.')).toBeVisible();
  expect(one(`select settings->>'newItemForm' from sheets where id = '${nc}'`)).toBe('false');
  await expect(card.getByRole('button', { name: /Use the pack’s choice/ })).toBeVisible();
  await page.goto(`/${w.slug}/s/${nc}`);
  await page.getByRole('button', { name: 'New nonconformity' }).click();
  await expect(dialog.getByRole('textbox', { name: /^Name/ })).toBeFocused();
  await expect(dialog.getByTestId('new-item-step')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /^More fields/ })).toBeVisible();

  // a deleted form falls back to the standard dialog too
  await page.keyboard.press('Escape');
  localSql(`update sheets set settings = settings - 'newItemForm' where id = '${nc}'`);
  localSql(`delete from views where id = '${form}'`);
  await page.goto(`/${w.slug}/s/${nc}?new=1`);
  await expect(dialog.getByRole('textbox', { name: /^Name/ })).toBeFocused();
  await expect(dialog.getByTestId('new-item-step')).toHaveCount(0);
});

test('approving a document by hand fills in Approver and Approved on', async ({ page }, info) => {
  test.skip(
    info.project.name === 'phone',
    'desktop: the item panel at 390 px is covered elsewhere',
  );
  test.setTimeout(240_000);
  const w = coreWorkspace('nid');
  const documents = w.sheet('documents');
  await signIn(page, 'maria@example.com', `/${w.slug}/s/${documents}`);
  const [first] = await rest<{ id: string; display_id: string }[]>(
    page,
    `items?sheet_id=eq.${documents}&archived_at=is.null&select=id,display_id&order=seq&limit=1`,
  );
  const fid = (k: string) =>
    one(
      `select id from fields where sheet_id = '${documents}' and key = '${k}' and archived_at is null`,
    );
  const values = () =>
    JSON.parse(one(`select "values" from items where id = '${first!.id}'`)) as Record<
      string,
      unknown
    >;
  // the document's file, uploaded from the Files tab
  await page.goto(`/${w.slug}/s/${documents}?item=${first!.display_id}`);
  const itemPanel = page.getByRole('dialog').filter({ has: page.getByRole('tablist') });
  await itemPanel.getByRole('tab', { name: /^Files · / }).click();
  await itemPanel.getByLabel('Choose files to upload').setInputFiles({
    name: 'policy-v1.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    ),
  });
  await expect(
    itemPanel.getByTestId('file-row').filter({ hasText: 'policy-v1.pdf' }),
  ).toBeVisible();
  await itemPanel.getByRole('tab', { name: 'Details' }).click();

  // Status → Approved by hand: the rule asks only for the version note, not for an approver
  await itemPanel.getByRole('button', { name: /^Edit Status/ }).click();
  await page
    .getByRole('listbox', { name: 'Status' })
    .getByRole('option', { name: /Approved/ })
    .click();
  const comment = page.getByRole('dialog', { name: 'Add a comment' });
  await expect(comment).toBeVisible();
  // only the version note is asked: the approver is the person approving (before, the rule refused the change)
  await expect(comment).toContainText('Add a comment to change Status.');
  await comment.getByLabel('Comment').fill('First issue, approved at the quality meeting.');
  await comment.getByRole('button', { name: 'Save with comment' }).click();
  await expect(comment).toBeHidden();
  await expect.poll(() => values()[fid('status')]).toBe('opt_approved');
  const maria = one(`select id from auth.users where email = 'maria@example.com'`);
  expect(values()[fid('approver')]).toEqual([maria]);
  expect(values()[fid('approved_on')]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(
    itemPanel.getByRole('button', { name: /^Edit Approver: .*Maria Pereira/ }),
  ).toBeVisible();
});
