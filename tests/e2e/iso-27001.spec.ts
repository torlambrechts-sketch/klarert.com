import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// The ISO/IEC 27001 add-on (docs/11, Phase 2): an owner installs it into an empty workspace; the Core registers
// (Full, as the add-on extends the controls, assets, audits, reviews, legal and training registers) and the 27001
// library are installed first. Its own sheets sit in Core's domains, the risk register is used by ISO 27001 with the
// "ISO 27001 view", the example risk links to Annex A, the notifying automations are in test mode, the treatment
// plan carries the Risk acceptance workflow and the ISMS CAPA app reads Core's nonconformities.

const TITLE = 'ISO/IEC 27001:2022 ISMS (add-on)';
const SHOTS = process.env.ISO27001_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

test('install the ISO 27001 add-on onto Core: domains, the 27001 view, test mode and risk acceptance', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'phone', 'desktop walkthrough');
  test.setTimeout(300_000);
  const slug = seedWorkspace('iso', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=packs`);
  await page.goto(`/${slug}/settings?tab=packs`);

  // ── preview: Core (Full) and the library first, the notifying automations quiet
  const row = page
    .getByRole('list', { name: 'Available packs' })
    .getByRole('listitem')
    .filter({ hasText: TITLE });
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    await row.getByRole('button', { name: `Preview ${TITLE}` }).click();
    await expect(dialog).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await expect(dialog.getByTestId('installs-first')).toContainText(
    'Installs Core registers 1.2.0 (Full) first.',
    { timeout: 30_000 },
  );
  await expect(dialog.getByTestId('adopts-framework')).toContainText(
    'Adopts the ISO/IEC 27001:2022 requirement library first',
  );
  await expect(dialog.getByRole('list', { name: 'Automations' })).toContainText(
    '(test mode: logs what it would do until you turn it on)',
  );
  await shot(page, '01-preview');
  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect(dialog.getByRole('status')).toContainText(`Installed ${TITLE}.`, {
    timeout: 120_000,
  });
  await expect(dialog.getByRole('status')).toContainText(
    'Installed Core registers 1.2.0 (Full) first.',
  );
  await dialog.getByRole('button', { name: 'Done' }).click();

  const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
  const installs = await rest<{ id: string; pack_key: string; level: string | null }[]>(
    page,
    `pack_installs?org_id=eq.${org!.id}&status=eq.installed&select=id,pack_key,level&order=installed_at`,
  );
  expect(installs.map((i) => i.pack_key)).toEqual(
    expect.arrayContaining(['core', 'framework-iso-27001', 'iso-27001']),
  );
  expect(installs.find((i) => i.pack_key === 'core')!.level).toBe('full');

  // ── its own sheets in Core's domains
  const folders = await rest<{ id: string; name: string }[]>(
    page,
    `folders?org_id=eq.${org!.id}&select=id,name`,
  );
  const sheets = await rest<{ id: string; name: string; folder_id: string | null }[]>(
    page,
    `sheets?org_id=eq.${org!.id}&parent_sheet_id=is.null&archived_at=is.null&select=id,name,folder_id`,
  );
  const folderOf = (name: string) =>
    folders.find((f) => f.id === sheets.find((s) => s.name === name)!.folder_id)?.name;
  expect(folderOf('ISMS scope and context')).toBe('Management system');
  expect(folderOf('Risk treatment plan')).toBe('Risk and controls');
  expect(sheets.some((s) => s.name === 'ISMS documents')).toBe(false);

  await page.goto(`/${slug}/home`);
  const menu = page.getByRole('navigation', { name: 'Side menu' });
  await expect(menu.getByTestId('menu-domain')).toHaveText([
    'Management system',
    'Risk and controls',
    'Operations',
    // Core 1.1.0 has its own Suppliers register
    'Suppliers',
  ]);
  await expect(menu.getByRole('link', { name: 'ISMS scope and context' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Risk treatment plan' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Apps' }).getByRole('link', { name: 'ISMS CAPA' }),
  ).toBeVisible();

  // ── the risk register: used by ISO 27001, with its view; the example risk links to Annex A
  await menu.getByRole('link', { name: 'Risk register' }).click();
  await expect(page.getByRole('heading', { name: 'Risk register', level: 1 })).toBeVisible();
  await expect(page.getByTestId('system-used-by')).toHaveText('Used by ISO 27001');
  const views = page.getByRole('tablist', { name: 'Saved views of this table' });
  await views.getByRole('tab', { name: 'ISO 27001 view' }).click();
  await expect(
    page.getByRole('gridcell', { name: /Example: account taken over by phishing/ }).first(),
  ).toBeVisible();
  // the Core example risk is not tagged ISO 27001: the view leaves it out
  await expect(page.getByRole('gridcell', { name: /A key supplier cannot deliver/ })).toHaveCount(
    0,
  );
  await shot(page, '02-risk-register-27001-view');
  const [phishing] = await rest<{ id: string }[]>(
    page,
    `items?org_id=eq.${org!.id}&name=eq.Example: account taken over by phishing&select=id`,
  );
  const links = await rest<{ to_item: string }[]>(
    page,
    `item_links?from_item=eq.${phishing!.id}&select=to_item`,
  );
  const annexA = await rest<{ requirement_ref: string }[]>(
    page,
    `items?id=in.(${links.map((l) => l.to_item).join(',')})&requirement_ref=not.is.null&select=requirement_ref`,
  );
  expect(annexA.map((r) => r.requirement_ref).sort()).toEqual([
    'iso-27001@2022#A.6.3',
    'iso-27001@2022#A.8.5',
    'iso-27001@2022#A.8.7',
  ]);

  // ── an advanced automation in test mode
  const [missed] = await rest<{ mode: string; enabled: boolean }[]>(
    page,
    `automations?org_id=eq.${org!.id}&pack_ref=eq.iso27001_containment_missed&select=mode,enabled`,
  );
  expect(missed).toEqual({ mode: 'test', enabled: true });
  await page.goto(`/${slug}/automations`);
  const escalation = page.getByRole('listitem').filter({
    hasText: 'Serious security incident about to miss its 24 hours → tell top management',
  });
  await expect(escalation.getByTestId('automation-test-mode')).toContainText('Test mode');

  // ── the treatment plan's Risk acceptance workflow
  const treatment = sheets.find((s) => s.name === 'Risk treatment plan')!;
  await page.goto(`/${slug}/s/${treatment.id}/settings#approvals`);
  const flows = page.getByRole('list', { name: 'Approval workflows' });
  await expect(flows).toContainText('Risk acceptance');
  await shot(page, '03-risk-acceptance-workflow');
  const [mfa] = await rest<{ display_id: string }[]>(
    page,
    `items?sheet_id=eq.${treatment.id}&name=like.*multi-factor*&select=display_id`,
  );
  await page.goto(`/${slug}/s/${treatment.id}?item=${mfa!.display_id}`);
  await expect(
    page.getByTestId('item-approvals').getByRole('button', { name: 'Submit for approval' }),
  ).toBeVisible();

  // ── the ISMS CAPA app over Core's nonconformities
  await page.goto(`/${slug}/apps/isms-capa`);
  await expect(
    page.getByRole('navigation', { name: 'ISMS CAPA screens' }).getByRole('link'),
  ).toHaveText([
    'Report a problem',
    'My actions',
    'Needs my check',
    'All nonconformities',
    'Overview',
    'Workflow',
  ]);
  await page.goto(`/${slug}/apps/isms-capa/overview`);
  await expect(page.getByRole('heading', { name: 'Open ISMS nonconformities' })).toBeVisible();
  await shot(page, '04-isms-overview');
});
