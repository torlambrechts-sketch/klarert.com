import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace } from './first-sheet-helpers';
import { freshEmail, rest, signIn } from './helpers';

// A workspace's own framework (docs/12 Your own frameworks, P8): an owner pastes a list from Excel, sees its problems
// with row numbers, fixes them in the grid, publishes it with the licence confirmation and a source line, adopts it
// (the ordinary adoption), finds the library sheet with the requirement text and the statement of applicability with
// the ownership note, maps a requirement to ISO/IEC 27001 ("Your mapping" in "Also satisfies"), publishes a reworded
// revision that the adopted library takes as an update while keeping its applicability, and another workspace sees
// none of it. At 1440 and 390 px (P8_SHOTS saves the screenshots).

const SHOTS = process.env.P8_SHOTS;
const ISO27001 = 'ISO/IEC 27001:2022';
const NAME = 'Acme supplier security schedule';
const LONG_TITLE =
  'All privileged access to production systems is reviewed by the supplier every quarter';
const PASTE = [
  'ref\ttitle\ttext\tgroup',
  '1.1\tAccess reviews\tThe supplier reviews all user access to Acme data every quarter and removes what is not needed.\tAccess',
  `1.2\t${LONG_TITLE}\t\tAccess`,
  '1.2\tMulti-factor sign-in\tEvery account that reaches Acme data signs in with two factors.\tAccess',
  '2.1\tBackups\tBackups of Acme data are taken daily and tested every month.\tContinuity',
].join('\n');

async function shot(page: Page, name: string, project: string) {
  if (SHOTS)
    await page.screenshot({ path: `${SHOTS}/${name}-${project === 'phone' ? 390 : 1440}.png` });
}

async function adoptFromRow(
  page: Page,
  row: ReturnType<Page['locator']>,
  title: string,
  n: number,
) {
  await row.getByRole('button', { name: `Adopt ${title}` }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: `Adopt ${title}` });
  const created = dialog.getByRole('list', { name: 'What adopting creates' });
  await expect(created).toContainText(`a library of ${n} requirement`, { timeout: 45_000 });
  await dialog.getByRole('button', { name: 'Adopt', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText(`Adopted ${title}`, { timeout: 30_000 });
  return dialog;
}

test('paste, fix, publish, adopt, map, revise; another workspace sees none of it', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const project = info.project.name;
  if (project !== 'phone') await page.setViewportSize({ width: 1440, height: 900 });
  const slug = seedWorkspace('own', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=frameworks`);
  await page.goto(`/${slug}/settings?tab=frameworks`);
  const [org] = await rest<{ id: string; name: string }[]>(
    page,
    `orgs?slug=eq.${slug}&select=id,name`,
  );

  // ── ISO/IEC 27001 from the catalogue, to map to later
  const yours = page.getByRole('heading', { name: 'Your frameworks · 0' });
  await expect(yours).toBeVisible();
  await expect(page.getByText('No frameworks of your own yet.')).toBeVisible();
  const catalogueRow = page
    .getByRole('list', { name: 'Framework catalogue' })
    .getByRole('listitem')
    .filter({ has: page.getByText(ISO27001, { exact: true }) });
  const d27 = await adoptFromRow(page, catalogueRow, ISO27001, 127);
  await d27.getByRole('button', { name: 'Done' }).click();

  // ── Add your own: paste from Excel, the problems with their row numbers
  await page.getByRole('link', { name: 'Add your own' }).click();
  await expect(page.getByRole('heading', { name: 'Add your own framework' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill(NAME);
  await expect(page.getByLabel('Short name')).toHaveValue('Acme');
  await expect(page.getByLabel('Paste from Excel or upload a CSV file')).toBeChecked();
  await page.getByLabel('Paste the list').fill(PASTE);
  await page.getByRole('button', { name: 'Check the list' }).click();
  const result = page.getByTestId('paste-result');
  await expect(result.getByRole('status')).toContainText('Read 4 requirements in 2 groups.');
  const problems = result.getByRole('list', { name: 'Problems in the list' });
  await expect(problems).toContainText(
    'Row 3 · Title 1.2: Shorten the title; put the full wording in Text.',
  );
  await expect(problems).toContainText('Row 4 · Ref 1.2: The ref "1.2" is used on row 3 too.');
  await shot(page, 'paste-validation', project);
  await page.getByRole('button', { name: 'Continue to the grid' }).click();

  // ── the grid: fix both rows, problems go away
  await expect(page.getByRole('heading', { name: NAME })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled();
  await expect(page.getByLabel('Title, row 3')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Title, row 3').scrollIntoViewIfNeeded();
  await shot(page, 'draft-grid', project);
  await page.getByLabel('Title, row 3').fill('Privileged access reviews');
  await page.getByLabel('Text, row 3').fill(LONG_TITLE + '.');
  await page.getByLabel('Ref, row 4').fill('1.3');
  await expect(page.getByRole('status').filter({ hasText: 'Ready to publish' })).toContainText(
    'Ready to publish: 4 requirements in 2 groups.',
  );
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved.').first()).toBeVisible();

  // ── publish: the licence confirmation and the source line
  await page.getByRole('button', { name: 'Publish' }).click();
  const publish = page.getByRole('dialog').filter({ hasText: `Publish ${NAME}` });
  await expect(publish.getByTestId('publish-decision')).toContainText(
    'Publishes edition 1 with 4 requirements.',
  );
  await publish.getByLabel('Source').fill('Acme master services agreement, schedule 3');
  await expect(publish).toContainText(
    `Provided by Acme master services agreement, schedule 3. Owned by ${org!.name}.`,
  );
  await expect(publish.getByRole('button', { name: 'Publish' })).toBeDisabled();
  await publish.getByLabel('We have the right to use this text in our workspace.').check();
  await shot(page, 'publish-dialog', project);
  await publish.getByRole('button', { name: 'Publish' }).click();
  await expect(publish.getByRole('status')).toContainText(
    `Published ${NAME}, edition 1, revision 1: 4 requirements.`,
    { timeout: 30_000 },
  );

  // ── adopt with the existing preview and adopt
  const adoptDialog = await adoptFromRow(page, publish, NAME, 4);
  await adoptDialog.getByRole('link', { name: 'Open the library' }).click();
  await expect(page.getByRole('heading', { name: `${NAME} requirements` })).toBeVisible({
    timeout: 30_000,
  });
  const [lib] = await rest<{ id: string; settings: { framework: { key: string } } }[]>(
    page,
    `sheets?org_id=eq.${org!.id}&is_library=is.true&name=eq.${encodeURIComponent(`${NAME} requirements`)}&select=id,settings`,
  );
  const key = lib!.settings.framework.key;
  expect(key).toMatch(new RegExp(`^w${org!.id.slice(0, 8)}-acme-supplier-security-schedu`));
  const fields = await rest<{ id: string; key: string }[]>(
    page,
    `fields?sheet_id=eq.${lib!.id}&select=id,key`,
  );
  const f = (k: string) => fields.find((x) => x.key === k)!.id;
  const items = await rest<
    {
      id: string;
      display_id: string;
      name: string;
      requirement_ref: string;
      values: Record<string, unknown>;
    }[]
  >(
    page,
    `items?sheet_id=eq.${lib!.id}&select=id,display_id,name,requirement_ref,values&order=seq`,
  );
  expect(items.map((i) => i.requirement_ref)).toEqual(
    ['1.1', '1.2', '1.3', '2.1'].map((r) => `${key}@1#${r}`),
  );
  expect(items[0]!.values[f('requirement_text')]).toBe(
    'The supplier reviews all user access to Acme data every quarter and removes what is not needed.',
  );
  await expect(page.getByRole('main')).toContainText('Access reviews');
  await shot(page, 'library-sheet', project);

  // ── the statement of applicability, with the ownership note
  await page.goto(`/${slug}/audit/soa/${lib!.id}`);
  await expect(page.getByTestId('soa-page')).toContainText(
    `Provided by Acme master services agreement, schedule 3. Owned by ${org!.name}.`,
  );
  await expect(page.getByRole('table')).toContainText('Multi-factor sign-in');
  await expect(page.getByTestId('soa-page').getByRole('status')).toContainText('4 requirements');
  await shot(page, 'soa', project);

  // ── map 1.1 to ISO/IEC 27001 A.5.18: "Also satisfies" shows it as your mapping
  await page.goto(`/${slug}/s/${lib!.id}?item=${items[0]!.display_id}`);
  const section = page.getByRole('dialog').getByRole('region', { name: 'Requirement · Acme 1.1' });
  await expect(section).toBeVisible({ timeout: 30_000 });
  await section.getByRole('button', { name: 'Map to …' }).click();
  const form = section.getByRole('group', { name: 'Map to a catalogue requirement' });
  await form.getByRole('combobox', { name: 'Catalogue requirement' }).fill('27001 A.5.18');
  await form.getByRole('option', { name: /27001 A\.5\.18/ }).click();
  await expect(form.getByLabel('Relation')).toHaveValue('related');
  await form.getByLabel('Relation').selectOption('equivalent');
  await form.getByLabel('Note (optional)').fill('Quarterly review covers both');
  await shot(page, 'map-to-panel', project);
  await form.getByRole('button', { name: 'Map' }).click();
  const yourMappings = section.getByRole('list', { name: 'Your mappings', exact: true });
  await expect(yourMappings).toContainText('27001 A.5.18');
  await expect(yourMappings).toContainText('Your mapping · Maria');
  const also = section.getByRole('list', { name: 'Also satisfies, your mappings' });
  await expect(also).toContainText('27001 A.5.18');
  await expect(also).toContainText('Your mapping · Maria');
  await expect(section.getByRole('list', { name: 'Also satisfies', exact: true })).toHaveCount(0);
  await expect(section).not.toContainText('automatic');
  const [mapped] = await rest<{ action: string }[]>(
    page,
    `activity_log?org_id=eq.${org!.id}&action=eq.crosswalk.added&select=action`,
  );
  expect(mapped?.action).toBe('crosswalk.added');

  // the ISO/IEC 27001 requirement shows the mapping apart from Klarert's
  const [a518] = await rest<{ display_id: string; sheet_id: string }[]>(
    page,
    `items?org_id=eq.${org!.id}&requirement_ref=eq.${encodeURIComponent('iso-27001@2022#A.5.18')}&select=display_id,sheet_id`,
  );
  await page.goto(`/${slug}/s/${a518!.sheet_id}?item=${a518!.display_id}`);
  const s27 = page.getByRole('dialog').getByRole('region', { name: 'Requirement · 27001 A.5.18' });
  await expect(s27.getByRole('list', { name: 'Also satisfies, your mappings' })).toContainText(
    'Acme 1.1',
  );

  // ── applicability set on the library, then a reworded revision
  await rest(page, 'rpc/set_item_values', {
    method: 'POST',
    body: {
      p_item: items[3]!.id,
      p_patch: {
        [f('applicable')]: { applicable: false, reason: '' },
        [f('justification')]: 'Acme data is not backed up by us: Acme keeps it.',
      },
    },
  });
  await page.goto(`/${slug}/settings?tab=frameworks`);
  const ownRow = page
    .getByRole('list', { name: 'Your frameworks' })
    .getByRole('listitem')
    .filter({ hasText: NAME });
  await expect(ownRow).toContainText('Yours');
  await expect(ownRow).toContainText(`Written by ${org!.name}. Not reviewed by Klarert.`);
  await expect(page.getByRole('list', { name: 'Framework catalogue' })).not.toContainText(NAME);
  await shot(page, 'frameworks-yours', project);
  await ownRow.getByRole('link', { name: `Change ${NAME}` }).click();
  await expect(page.getByLabel('Title, row 2')).toHaveValue('Access reviews', { timeout: 30_000 });
  await page.getByLabel('Title, row 2').fill('Access reviews every quarter');
  await page.getByRole('button', { name: 'Publish' }).click();
  const revise = page.getByRole('dialog').filter({ hasText: `Publish ${NAME}` });
  await expect(revise.getByTestId('publish-decision')).toContainText(
    'Publishes revision 2 of edition 1: 1 requirement changed, 0 requirements added.',
  );
  await expect(revise.getByLabel('Source')).toHaveValue(
    'Acme master services agreement, schedule 3',
  );
  await revise.getByLabel('We have the right to use this text in our workspace.').check();
  await revise.getByRole('button', { name: 'Publish' }).click();
  await expect(revise.getByRole('status')).toContainText('edition 1, revision 2', {
    timeout: 30_000,
  });
  await revise.getByRole('link', { name: 'Back to Frameworks' }).click();

  // the adopted library offers the update and keeps its applicability
  const adoptedRow = page
    .getByRole('list', { name: 'Adopted frameworks' })
    .getByRole('listitem')
    .filter({ hasText: NAME });
  await expect(adoptedRow.getByTestId('update-available')).toContainText('1.1.0 → 1.2.0');
  await adoptedRow.getByRole('button', { name: /^Update .* from 1\.1\.0 to 1\.2\.0$/ }).click();
  const upgrade = page.getByRole('dialog');
  await upgrade.getByRole('button', { name: 'Apply update' }).click({ timeout: 45_000 });
  await expect(upgrade.getByRole('status')).toContainText('to 1.2.0', { timeout: 30_000 });
  await upgrade.getByRole('button', { name: 'Done' }).click();
  const after = await rest<{ name: string; values: Record<string, unknown> }[]>(
    page,
    `items?sheet_id=eq.${lib!.id}&select=name,values&order=seq`,
  );
  expect(after[0]!.name).toBe('Access reviews every quarter');
  expect(after[3]!.values[f('justification')]).toBe(
    'Acme data is not backed up by us: Acme keeps it.',
  );
  expect(after[3]!.values[f('applicable')]).toMatchObject({ applicable: false });

  // ── another workspace: not listed, and someone outside this workspace reads none of it
  const other = seedWorkspace('ownb', { empty: true });
  await page.goto(`/${other}/settings?tab=frameworks`);
  await expect(page.getByRole('heading', { name: 'Your frameworks · 0' })).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText(NAME);
  const stranger = await browser.newPage();
  await signIn(stranger, freshEmail('own-stranger'));
  for (const path of [
    `frameworks?key=eq.${key}&select=key`,
    `requirements?framework_key=eq.${key}&select=ref`,
    `crosswalks?from_framework=eq.${key}&select=id`,
    `packs?key=like.framework-${key}*&select=key`,
    `framework_drafts?select=key`,
  ])
    expect(await rest<unknown[]>(stranger, path)).toEqual([]);
  await stranger.close();

  // the page fits the width (390 px on the phone project)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
