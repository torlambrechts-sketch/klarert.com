import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// Audit outputs (P5, docs/11): with ISO/IEC 27001:2022 adopted, the library's toolbar exports the statement of
// applicability (print page and CSV), Audit outputs makes an audit pack zip with the hash chains checked, and the
// management review inputs compile for a period. Every export is in the activity log. (The ISO 27001 pack's own
// sheets feed the review: compileManagementReview's unit tests cover that.)

const ISO27001 = 'ISO/IEC 27001:2022';

async function adopt(page: Page, slug: string) {
  await page.goto(`/${slug}/settings?tab=frameworks`);
  await page
    .getByRole('list', { name: 'Framework catalogue' })
    .getByRole('listitem')
    .filter({ has: page.getByText(ISO27001, { exact: true }) })
    .getByRole('button', { name: `Adopt ${ISO27001}` })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('list', { name: 'What adopting creates' })).toContainText(
    'a library of',
    { timeout: 45_000 },
  );
  await dialog.getByRole('button', { name: 'Adopt', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText(`Adopted ${ISO27001}`, {
    timeout: 30_000,
  });
  await dialog.getByRole('button', { name: 'Done' }).click();
}

test('export the SoA, make an audit pack and compile the review inputs', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop walkthrough');
  test.setTimeout(240_000);
  const slug = seedWorkspace('audit', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=frameworks`);
  await adopt(page, slug);
  const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
  const [lib] = await rest<{ id: string }[]>(
    page,
    `sheets?org_id=eq.${org!.id}&is_library=eq.true&select=id`,
  );

  // ── the library's toolbar: Export SoA opens the print page
  await page.goto(`/${slug}/s/${lib!.id}`);
  await page.getByTestId('export-soa').click();
  const soa = page.getByTestId('soa-page');
  await expect(soa.getByRole('heading', { name: 'Statement of applicability' })).toBeVisible();
  await expect(soa).toContainText('ISO/IEC 27001:2022');
  await expect(soa).toContainText('Generated');
  await expect(soa.getByRole('status')).toContainText(/\d+ requirements · \d+ applicable/);
  await expect(soa.getByRole('columnheader', { name: 'Linked controls and risks' })).toBeVisible();
  await expect(soa.getByRole('cell', { name: 'A.5.1', exact: true })).toBeVisible();
  // every requirement, clauses included
  await soa.getByRole('link', { name: 'Show every requirement' }).click();
  await expect(soa.getByRole('cell', { name: '4.1', exact: true })).toBeVisible();

  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    soa.getByRole('button', { name: 'Download CSV' }).click(),
  ]);
  const csv = readFileSync((await csvDownload.path())!, 'utf8').replace('﻿', '');
  const lines = csv.split('\r\n');
  expect(lines[0]).toBe('Statement of applicability');
  expect(lines[2]).toBe('Framework,ISO/IEC 27001:2022');
  expect(csv).toContain(
    'Ref,Title,Applicable,Justification,Implementation status,Owner,Evidence,Linked controls and risks,Last reviewed',
  );

  // ── Audit outputs: the audit pack for the pack install
  await page.goto(`/${slug}/audit`);
  await page.getByTestId('audit-pack-open').click();
  const dialog = page.getByRole('dialog', { name: 'Audit pack' });
  const [zipDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    dialog.getByTestId('audit-pack-download').click(),
  ]);
  await expect(dialog.getByRole('status')).toContainText('Saved');
  const zip = unzipSync(new Uint8Array(readFileSync((await zipDownload.path())!)));
  const names = Object.keys(zip);
  expect(names).toContain('README.txt');
  expect(names).toContain('soa/ISO-IEC 27001-2022.csv');
  expect(names).toContain('soa/ISO-IEC 27001-2022.html');
  expect(names).toContain('registers/ISO-IEC 27001-2022 requirements.csv');
  expect(names).toContain('evidence/index.csv');
  expect(names).toContain('activity/log.csv');
  const readme = strFromU8(zip['README.txt']!);
  expect(readme).toContain('Scope: Whole workspace');
  expect(readme).toMatch(/Hash chains: \d+ checked, \d+ ok, 0 broken/);
  expect(readme).toMatch(/entries in the period, [1-9]\d* of them on the workspace chain/);
  const chains = strFromU8(zip['activity/chains.csv']!);
  expect(chains).toContain(',ok,');
  expect(chains).not.toContain(',broken,');
  // the workspace chain is checked with the others (owner decision 15 Nov 2026)
  expect(chains).toMatch(new RegExp(`\\r\\nsheet:${org!.id},Workspace,Workspace,ok,[1-9]`));
  const log = strFromU8(zip['activity/log.csv']!);
  expect(log).toContain('item.created');
  // workspace entries are rows of the sheet "Workspace": the adoption and the SoA exports made above
  const workspaceRows = log.split('\r\n').filter((l) => l.split(',')[2] === 'Workspace');
  expect(workspaceRows.some((l) => l.includes(',framework.adopted,'))).toBe(true);
  expect(workspaceRows.some((l) => l.includes(',audit.exported,'))).toBe(true);
  expect(workspaceRows.every((l) => l.includes(`,sheet:${org!.id},`))).toBe(true);

  // ── management review inputs for the period
  await page.goto(`/${slug}/audit`);
  await page.getByTestId('audit-review').getByRole('button', { name: 'Compile' }).click();
  const review = page.getByTestId('review-page');
  await expect(review.getByRole('heading', { name: 'Management review inputs' })).toBeVisible();
  await expect(review.locator('[data-section]')).toHaveCount(8);
  await expect(review.locator('[data-section="nonconformities"]')).toContainText(
    'No sheet holds this yet.',
  );
  await expect(review.locator('[data-section="monitoring"]')).toContainText(
    'ISO/IEC 27001:2022 requirements: ',
  );

  // ── every export is on the workspace chain
  const logged = await rest<{ new_value: { kind: string } }[]>(
    page,
    `activity_log?org_id=eq.${org!.id}&action=eq.audit.exported&select=new_value&order=id`,
  );
  expect(logged.map((l) => l.new_value.kind)).toEqual(
    expect.arrayContaining(['soa.print', 'soa.csv', 'audit_pack', 'management_review']),
  );

  // ── and in the Exports list, newest first, with who and the filters used
  await page.goto(`/${slug}/audit`);
  const exports = page.getByTestId('audit-exports');
  await expect(exports.getByRole('heading', { name: 'Exports' })).toBeVisible();
  const rows = exports.getByRole('list', { name: 'Exports, newest first' }).getByRole('listitem');
  await expect(rows.first()).toContainText('Management review inputs');
  await expect(rows.first()).toContainText('Maria Pereira');
  await expect(rows.first()).toContainText(/Period \d+ \w{3} \d{4} to \d+ \w{3} \d{4}/);
  const pack = rows.filter({ hasText: 'Audit pack' });
  await expect(pack).toHaveCount(1);
  await expect(pack).toContainText('Whole workspace');
  await expect(pack).toContainText(/\d+ chains checked, \d+ ok/);
  await expect(rows.filter({ hasText: 'Statement of applicability (CSV)' })).toContainText(
    'ISO/IEC 27001:2022',
  );
  await expect(
    rows.filter({ hasText: 'Statement of applicability (print)' }).first(),
  ).toBeVisible();
});

test('the Exports list: owners, admins and auditors, paged, keyboard and 390 px', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150_000);
  const slug = seedWorkspace('exports', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/audit`);
  const exports = page.getByTestId('audit-exports');
  await expect(exports.getByTestId('audit-exports-empty')).toContainText('No exports yet.');
  const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);

  // 52 exports: a data-flow record first, then audit packs; the list shows 50 and offers more
  await rest(page, 'rpc/log_audit_export', {
    method: 'POST',
    body: {
      p_org: org!.id,
      p_kind: 'data_flow_record',
      p_scope: { domain: 'Quality', differs: true, sheets: 3, destinations: 1 },
    },
  });
  for (let i = 0; i < 51; i++)
    await rest(page, 'rpc/log_audit_export', {
      method: 'POST',
      body: {
        p_org: org!.id,
        p_kind: 'audit_pack',
        p_scope: { scope: 'workspace', from: '2026-01-01', to: '2026-11-15', sheets: i },
      },
    });
  await page.reload();
  const list = exports.getByRole('list', { name: 'Exports, newest first' });
  await expect(list.getByRole('listitem')).toHaveCount(50);
  await expect(list.getByRole('listitem').first()).toContainText('50 registers');
  await expect(list.getByRole('listitem').first()).toContainText(
    'Whole workspace · Period 1 Jan 2026 to 15 Nov 2026',
  );
  if (info.project.name === 'phone') {
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  }

  // keyboard: Show more exports, and focus lands on the first export that arrived
  const more = exports.getByRole('button', { name: 'Show more exports' });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(list.getByRole('listitem')).toHaveCount(52);
  await expect(more).toHaveCount(0);
  const focused = list.getByRole('listitem').nth(50);
  await expect(focused).toBeFocused();
  await expect(focused).toContainText('Audit pack');
  const last = list.getByRole('listitem').last();
  await expect(last).toContainText('Data-flow record');
  await expect(last).toContainText(
    'Registers domain: Quality · Only sheets that differ from their pack',
  );
  await expect(last).toContainText('3 sheets · 1 destination');
  await expect(last).toContainText('Maria Pereira');

  // an editor exports too, but does not see the list
  const editor = await (await browser.newContext({ viewport: page.viewportSize() })).newPage();
  await signIn(editor, 'james@example.com', `/${slug}/audit`);
  await expect(editor.getByTestId('audit-pack')).toBeVisible();
  await expect(editor.getByTestId('audit-exports')).toHaveCount(0);
  await editor.context().close();
});
