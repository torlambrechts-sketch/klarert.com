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
  const chains = strFromU8(zip['activity/chains.csv']!);
  expect(chains).toContain(',ok,');
  expect(chains).not.toContain(',broken,');
  expect(strFromU8(zip['activity/log.csv']!)).toContain('item.created');

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
});
