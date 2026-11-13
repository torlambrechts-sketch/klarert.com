import { expect, test, type Browser, type Page } from '@playwright/test';
import { rest, signIn } from './helpers';

// Files on items and linked controlled documents (docs/05 §3.4 Files tab, docs/02 §8 and §14). Uses the seed:
// maria@example.com owner, james@example.com editor. Each test makes its own sheets.

test.describe.configure({ mode: 'default' });

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const panel = (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('tablist') });

const PDF = (label: string) =>
  Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
      `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n% ${label}\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  );
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function sheetFrom(page: Page, start: string, name: string, grid = true) {
  await page.goto(`/meridian/s/new?start=${start}`);
  await page.getByLabel('Sheet name').fill(name);
  await expect(page.getByLabel('ID prefix')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Create sheet' }).click();
  await expect(page).toHaveURL(/\/meridian\/s\/[0-9a-f-]{36}$/);
  const url = `${page.url()}?view=table`;
  await page.goto(url);
  if (grid) await expect(page.getByRole('grid')).toBeVisible();
  return url;
}

async function addItem(page: Page, label: string, name: string) {
  const input = page.getByRole('textbox', { name: label });
  await input.click();
  await input.fill(name);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.getByRole('grid').getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByRole('grid').locator('[id^="cell-temp-"]')).toHaveCount(0);
}

async function itemByName(page: Page, sheetUrl: string, name: string) {
  const sheetId = sheetUrl.match(/\/s\/([0-9a-f-]{36})/)![1]!;
  const rows = await rest<{ id: string; display_id: string }[]>(
    page,
    `items?sheet_id=eq.${sheetId}&name=eq.${encodeURIComponent(name)}&select=id,display_id`,
  );
  return rows[0]!;
}

async function openFiles(page: Page, sheetUrl: string, displayId: string) {
  await page.goto(`${sheetUrl}&item=${displayId}`);
  const dialog = panel(page);
  await dialog.getByRole('tab', { name: /^Files · / }).click();
  await expect(dialog.getByRole('heading', { name: /^Files/ })).toBeVisible();
  return dialog;
}

const fileRow = (page: Page, name: string) =>
  panel(page).getByTestId('file-row').filter({ hasText: name });

async function menu(page: Page, file: string, action: string) {
  await panel(page)
    .getByRole('button', { name: `More actions for ${file}` })
    .click();
  await page.getByRole('menuitem', { name: action }).click();
}

async function asUser(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

test.describe('desktop', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop panel'));

  test('upload, versions, downloads, preview, details, expiry, blocked types and archive', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, 'james@example.com');
    const url = await sheetFrom(page, 'tracker', `Files ${unique()}`);
    await addItem(page, 'Add task to Open', 'Laptop');
    const item = await itemByName(page, url, 'Laptop');
    const dialog = await openFiles(page, url, item.display_id);
    await expect(
      dialog.getByText('No files yet. Drop evidence, contracts or scans here.'),
    ).toBeVisible();
    await expect(
      dialog.getByText('No linked documents. Link a policy or procedure from the register.'),
    ).toBeVisible();

    // choose one file, drop another
    await dialog.getByLabel('Choose files to upload').setInputFiles({
      name: 'inspection.pdf',
      mimeType: 'application/pdf',
      buffer: PDF('v1'),
    });
    await expect(fileRow(page, 'inspection.pdf')).toContainText('v1');
    const dt = await page.evaluateHandle((b64) => {
      const d = new DataTransfer();
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      d.items.add(new File([bytes], 'site.png', { type: 'image/png' }));
      return d;
    }, PNG.toString('base64'));
    await dialog.getByTestId('files-dropzone').dispatchEvent('drop', { dataTransfer: dt });
    await expect(fileRow(page, 'site.png')).toContainText('Photo');
    await expect(dialog.getByRole('tab', { name: 'Files · 2' })).toBeVisible();

    // a blocked type is refused with a reason
    await dialog.getByLabel('Choose files to upload').setInputFiles({
      name: 'page.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<html><script>alert(1)</script></html>'),
    });
    await expect(dialog.getByRole('alert')).toContainText(
      'Not uploaded: .html files are not allowed',
    );

    // a new version with a note
    await menu(page, 'inspection.pdf', 'Upload new version');
    const v = page.getByRole('dialog', { name: 'Upload a new version' });
    await v.getByLabel('Version note').fill('Signed copy');
    await v.getByLabel('Choose the new version').setInputFiles({
      name: 'inspection-signed.pdf',
      mimeType: 'application/pdf',
      buffer: PDF('v2'),
    });
    await v.getByRole('button', { name: 'Upload v2' }).click();
    await expect(fileRow(page, 'inspection-signed.pdf')).toContainText('v2');

    // download v1 from the history: logged and listed
    await menu(page, 'inspection-signed.pdf', 'Version history');
    const history = page.getByRole('dialog', { name: 'Version history' });
    await expect(history.getByRole('listitem').first()).toContainText('Current');
    await expect(history).toContainText('Note: Signed copy');
    const download = page.waitForEvent('download');
    await history.getByRole('button', { name: 'Download v1 of inspection.pdf' }).click();
    expect((await download).suggestedFilename()).toBe('inspection.pdf');
    await expect(history.getByRole('list', { name: 'Downloads' })).toContainText('downloaded v1');
    await page.keyboard.press('Escape');
    await expect(history).toHaveCount(0);

    // preview a PDF; next goes to the image
    await menu(page, 'inspection-signed.pdf', 'Preview');
    const preview = page.getByRole('dialog', { name: 'inspection-signed.pdf' });
    await expect(preview.locator('iframe[title="Preview of inspection-signed.pdf"]')).toBeVisible();
    const src = await preview.locator('iframe').getAttribute('src');
    const res = await page.request.get(src!);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/pdf');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    await preview.getByRole('button', { name: 'Next file' }).click();
    await expect(page.getByRole('img', { name: 'site.png' })).toBeVisible();
    await page.keyboard.press('Escape');

    // details: category, valid until (in the past), classification, personal data
    await menu(page, 'inspection-signed.pdf', 'Edit details');
    const details = page.getByRole('dialog', { name: 'Edit details' });
    await details.getByLabel('Category').selectOption({ label: 'Evidence' });
    await details.getByLabel('Valid until').fill('2026-11-03');
    await details.getByLabel('Classification').selectOption({ label: 'Confidential' });
    await details.getByLabel('Contains personal data').check();
    await details.getByRole('button', { name: 'Save details' }).click();
    const row = fileRow(page, 'inspection-signed.pdf');
    await expect(row).toContainText('Evidence');
    await expect(row).toContainText('✕ Expired 3 Nov 2026');
    await expect(row).toContainText('Confidential');
    await expect(row).toContainText('Personal data');
    await dialog.getByRole('radio', { name: 'Expiring' }).click();
    await expect(dialog.getByTestId('file-row')).toHaveCount(1);
    await dialog.getByRole('radio', { name: 'All' }).click();

    // an editor cannot archive
    await panel(page).getByRole('button', { name: 'More actions for site.png' }).click();
    await expect(page.getByRole('menuitem', { name: 'Edit details' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Archive' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // the row shows a paperclip with the count and the expired marker; it opens the Files tab
    await dialog.getByRole('button', { name: 'Close' }).click();
    const marker = page.getByRole('grid').locator('[data-files]');
    await expect(marker).toHaveAttribute('data-files', '2');
    await expect(marker).toHaveAttribute('data-expired', 'true');
    await expect(marker).toHaveAccessibleName(/expired/);
    await marker.click();
    await expect(panel(page).getByRole('tab', { name: /^Files/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // an admin archives: gone from the tab, in the activity log
    const maria = await asUser(browser, 'maria@example.com');
    await openFiles(maria, url, item.display_id);
    await menu(maria, 'site.png', 'Archive');
    const confirm = maria.getByRole('dialog', { name: 'Archive site.png?' });
    await confirm.getByLabel('Reason (optional)').fill('Duplicate photo');
    await confirm.getByRole('button', { name: 'Archive' }).click();
    await expect(fileRow(maria, 'site.png')).toHaveCount(0);
    await panel(maria)
      .getByRole('tab', { name: /^Activity log/ })
      .click();
    await expect(panel(maria).getByText(/Files: archived site\.png/)).toBeVisible();
    await maria.context().close();
  });

  test('documents: approval by a second person, linking, the approved version and a draft in review', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    // the author makes the register and a document with its file
    await signIn(page, 'maria@example.com');
    const regUrl = await sheetFrom(page, 'documents', `Policies ${unique()}`);
    const title = `Access control policy ${unique()}`;
    await addItem(page, 'Add document to Draft', title);
    const doc = await itemByName(page, regUrl, title);
    await openFiles(page, regUrl, doc.display_id);
    await panel(page)
      .getByLabel('Choose files to upload')
      .setInputFiles({
        name: 'policy-v1.pdf',
        mimeType: 'application/pdf',
        buffer: PDF('policy v1'),
      });
    await expect(fileRow(page, 'policy-v1.pdf')).toBeVisible();

    // the author cannot approve their own document
    const approve = async (p: Page, note: string) => {
      await panel(p).getByRole('tab', { name: 'Details' }).click();
      await panel(p)
        .getByRole('button', { name: /^Edit Status/ })
        .click();
      await p.getByRole('option', { name: 'Approved' }).click();
      const c = p.getByRole('dialog', { name: 'Add a comment' });
      await c.getByRole('textbox').fill(note);
      await c.getByRole('button', { name: 'Save with comment' }).click();
    };
    await approve(page, 'First issue');
    await expect(
      page.getByText(
        'the author cannot approve their own document. Ask another person to approve it.',
      ),
    ).toBeVisible();

    // another person approves
    const james = await asUser(browser, 'james@example.com');
    await james.goto(`${regUrl}&item=${doc.display_id}`);
    await approve(james, 'First issue');
    await panel(james)
      .getByRole('tab', { name: /^Files/ })
      .click();
    await expect(fileRow(james, 'policy-v1.pdf')).toBeVisible();
    // the approval records the approver (the person approving) and the date
    const regId = regUrl.match(/\/s\/([0-9a-f-]{36})/)![1]!;
    const keyed = await rest<{ id: string; key: string }[]>(
      james,
      `fields?sheet_id=eq.${regId}&key=in.(approver,approved_on,version)&select=id,key`,
    );
    const fid = (k: string) => keyed.find((f) => f.key === k)!.id;
    const values = async () =>
      (
        await rest<{ values: Record<string, unknown> }[]>(
          james,
          `items?id=eq.${doc.id}&select=values`,
        )
      )[0]!.values;
    await expect.poll(async () => (await values())[fid('version')]).toBe(1);
    const v1 = await values();
    expect(v1[fid('approver')]).toHaveLength(1);
    expect(v1[fid('approved_on')]).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // an asset links the document and gets its approved version
    const assetsUrl = await sheetFrom(page, 'tracker', `Assets ${unique()}`);
    await addItem(page, 'Add task to Open', 'Laptop');
    const asset = await itemByName(page, assetsUrl, 'Laptop');
    const files = await openFiles(page, assetsUrl, asset.display_id);
    await files.getByRole('button', { name: 'Link a document' }).click();
    const link = page.getByRole('dialog', { name: 'Link a document' });
    await link.getByLabel('Search documents').fill(title);
    await link.getByRole('option', { name: new RegExp(title) }).click();
    await link.getByRole('button', { name: 'Link document' }).click();
    await expect(page.getByText('Documents field added to this sheet.')).toBeVisible();
    const linked = panel(page)
      .getByRole('list', { name: 'Linked documents' })
      .getByRole('listitem');
    await expect(linked).toContainText(title);
    await expect(linked.getByTestId('document-status')).toContainText('v1 · Approved');
    let download = page.waitForEvent('download');
    await linked.getByRole('button', { name: `Download the approved version of ${title}` }).click();
    expect((await download).suggestedFilename()).toBe('policy-v1.pdf');

    // a new draft version: the asset shows "Draft in review" and still hands out v1
    await james.goto(`${regUrl}&item=${doc.display_id}`);
    await panel(james)
      .getByRole('tab', { name: /^Files/ })
      .click();
    await menu(james, 'policy-v1.pdf', 'Upload new version');
    const v = james.getByRole('dialog', { name: 'Upload a new version' });
    await v.getByLabel('Version note').fill('Annual review');
    await v.getByLabel('Choose the new version').setInputFiles({
      name: 'policy-v2.pdf',
      mimeType: 'application/pdf',
      buffer: PDF('policy v2'),
    });
    await v.getByRole('button', { name: 'Upload v2' }).click();
    await expect(fileRow(james, 'policy-v2.pdf')).toContainText('v2');
    await james.context().close();

    await page.reload();
    await panel(page)
      .getByRole('tab', { name: /^Files/ })
      .click();
    const again = panel(page).getByRole('list', { name: 'Linked documents' }).getByRole('listitem');
    await expect(again.getByTestId('document-status')).toContainText('v1 · Approved');
    await expect(again).toContainText('⚠ Draft in review');
    download = page.waitForEvent('download');
    await again.getByRole('button', { name: `Download the approved version of ${title}` }).click();
    expect((await download).suggestedFilename()).toBe('policy-v1.pdf');
  });
});

test.describe('phone', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'phone layout'));

  test('the Files tab works at 390 px', async ({ page }) => {
    await signIn(page, 'james@example.com');
    // phones show the Table as cards: make the item through the API
    const url = await sheetFrom(page, 'tracker', `Phone files ${unique()}`, false);
    const sheetId = url.match(/\/s\/([0-9a-f-]{36})/)![1]!;
    const [group] = await rest<{ id: string }[]>(
      page,
      `groups?sheet_id=eq.${sheetId}&select=id&order=position`,
    );
    const item = await rest<{ id: string; display_id: string }>(page, 'rpc/create_item', {
      method: 'POST',
      body: { p_sheet: sheetId, p_group: group!.id, p_name: 'Van', p_position: 'a0' },
    });
    const dialog = await openFiles(page, url, item.display_id);
    await dialog.getByLabel('Choose files to upload').setInputFiles({
      name: 'insurance-certificate.pdf',
      mimeType: 'application/pdf',
      buffer: PDF('phone'),
    });
    await expect(fileRow(page, 'insurance-certificate.pdf')).toBeVisible();
    const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const more = dialog.getByRole('button', { name: 'More actions for insurance-certificate.pdf' });
    const box = (await more.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    await more.click();
    await page.getByRole('menuitem', { name: 'Version history' }).click();
    const sheet = page.getByRole('dialog', { name: 'Version history' });
    const sb = (await sheet.boundingBox())!;
    // a bottom sheet on phones
    expect(sb.width).toBe(390);
    expect(sb.y).toBeGreaterThan(0);
  });
});
