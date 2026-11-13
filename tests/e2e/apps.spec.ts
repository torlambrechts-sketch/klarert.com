import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// Apps (P7, docs/13): an owner installs the CAPA pack, finds the CAPA app under Apps in the side menu, opens its
// "Report a problem" form, reports a problem and finds the containment step in "My actions" (the pack adds the CAPA
// steps to a reported problem, the reporter owns containment). Runs on desktop and at 390 px.

const TITLE = 'Corrective action (CAPA)';
const packRow = (page: Page) =>
  page
    .getByRole('list', { name: 'Available packs' })
    .getByRole('listitem')
    .filter({ hasText: TITLE });

test('install the CAPA pack, report a problem in its app and find it in My actions', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const phone = info.project.name === 'phone';
  const slug = seedWorkspace(phone ? 'app' : 'apd', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
  await packRow(page)
    .getByRole('button', { name: `Preview ${TITLE}` })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect(dialog.getByRole('status')).toContainText(`Installed ${TITLE}.`, {
    timeout: 30_000,
  });
  await page.keyboard.press('Escape');

  // ── the app is in the side menu under Apps (on a phone, in the menu sheet)
  await page.goto(`/${slug}/home`);
  if (phone) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const apps = page.getByRole('list', { name: 'Apps' });
  await expect(apps.getByRole('link', { name: 'CAPA' })).toBeVisible();
  await apps.getByRole('link', { name: 'CAPA' }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/apps/capa/report$`));
  const screens = page.getByRole('navigation', { name: 'CAPA screens' });
  await expect(screens.getByRole('link')).toHaveText([
    'Report a problem',
    'My actions',
    'Needs my approval',
    'All nonconformities',
    'Overview',
    'Workflow',
  ]);
  await expect(page.getByRole('heading', { name: 'Report a problem', level: 1 })).toBeVisible();

  // ── the pack installed its form as a draft: the owner opens it here
  await page.getByRole('button', { name: 'Open the form' }).click();
  const form = page.getByRole('form', { name: 'Raise a nonconformity' });
  await expect(form).toBeVisible();
  const problem = `Guard missing on press ${Date.now().toString(36)}`;
  await form.getByRole('textbox', { name: /^Nonconformity/ }).fill(problem);
  await form.getByRole('button', { name: /^Found on/ }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await form.getByLabel(/What is wrong\?/).fill('The guard on press 4 was removed for cleaning.');
  await form.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Sent\./ })).toBeVisible();

  // ── the reporter's containment step is in My actions, and opens the item panel on the sheet
  await page.getByRole('link', { name: 'Go to My actions' }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/apps/capa/my-actions$`));
  const list = page.getByRole('list', { name: 'My actions' });
  const row = list.getByRole('link').filter({ hasText: 'Containment' });
  await expect(row).toBeVisible();
  await expect(row).toContainText(problem);
  await expect(list.getByRole('link')).toHaveCount(1);

  const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
  const [install] = await rest<{ ref_map: Record<string, string>; version: string }[]>(
    page,
    `pack_installs?org_id=eq.${org!.id}&pack_key=eq.start-capa&select=ref_map,version`,
  );
  expect(install!.version).toBe('1.1.0');
  const subs = await rest<{ name: string }[]>(
    page,
    `items?sheet_id=eq.${install!.ref_map['sheet:capa.subitems']}&select=name&order=sub_seq`,
  );
  expect(subs.map((s) => s.name)).toEqual([
    'Containment',
    'Root cause',
    'Correction',
    'Corrective action',
    'Effectiveness check',
  ]);

  await row.click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/s/${install!.ref_map['sheet:capa']}\\?item=`));
  await expect(page.getByRole('dialog').getByText('Containment').first()).toBeVisible();

  // ── nothing waits for verification yet; the overview counts the open problem
  await page.goto(`/${slug}/apps/capa/approvals`);
  await expect(page.getByText('Nothing waits for your verification.')).toBeVisible();
  await page.goto(`/${slug}/apps/capa/overview`);
  await expect(page.getByRole('heading', { name: 'Open nonconformities' })).toBeVisible();
});
