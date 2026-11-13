import { expect, test, type Page } from '@playwright/test';
import { makeSheet, STATUS } from './automation-helpers';
import { seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

// The requirement library (docs/12): in an empty workspace an owner adopts ISO/IEC 27001:2022 and ISO 9001:2015 from
// Workspace admin › Frameworks (one transaction each, with a Controls column linked both ways with the controls
// sheet), marks a control not applicable with a justification, links a control to 27001 7.5.3, sees coverage, "Also
// satisfies" 9001 7.5.3 on the requirement, links the suggested equivalent with one click from the control, and finds
// the statement of applicability view. Library items keep their requirement key and Ref for ever.

const ISO27001 = 'ISO/IEC 27001:2022';
const ISO9001 = 'ISO 9001:2015';

const catalogueRow = (page: Page, title: string) =>
  page
    .getByRole('list', { name: 'Framework catalogue' })
    .getByRole('listitem')
    .filter({ has: page.getByText(title, { exact: true }) });

async function adopt(page: Page, title: string, requirements: number) {
  await catalogueRow(page, title)
    .getByRole('button', { name: `Adopt ${title}` })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: `Adopt ${title}` })).toBeVisible();
  await expect(dialog.getByLabel('Controls sheet')).toHaveValue(/.+/);
  const created = dialog.getByRole('list', { name: 'What adopting creates' });
  await expect(created).toContainText(`a library of ${requirements} requirements`);
  await expect(created).toContainText('→ Controls through Controls, both ways');
  await expect(dialog).toContainText('Reference numbers only');
  await dialog.getByRole('button', { name: 'Adopt', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText(
    `Adopted ${title}: ${requirements} requirements in the library.`,
    { timeout: 30_000 },
  );
  await dialog.getByRole('button', { name: 'Done' }).click();
}

type Lib = { id: string; name: string };
type Row = {
  id: string;
  display_id: string;
  name: string;
  requirement_ref: string;
  values: Record<string, unknown>;
};

test.describe('desktop', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop walkthrough'));

  test('adopt 27001 and 9001, link a control, coverage, also satisfies and the SoA', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const slug = seedWorkspace('fw', { empty: true });
    await signIn(page, 'maria@example.com', `/${slug}/settings?tab=frameworks`);
    await expect(page.getByRole('heading', { name: 'Framework catalogue' })).toBeVisible();

    // the workspace's controls: a requirement field that links to any library sheet
    const controls = await makeSheet(
      page,
      'Controls',
      [
        { key: 'status', name: 'Status', type: 'status', config: STATUS },
        {
          key: 'requirements',
          name: 'Requirements',
          type: 'requirement',
          config: { targetSheetId: null, multiple: true, inverseFieldId: null },
        },
      ],
      'Control',
      slug,
    );
    const control = await rest<{ id: string; display_id: string }>(page, 'rpc/create_item', {
      method: 'POST',
      body: {
        p_sheet: controls.id,
        p_group: controls.groups.Open,
        p_name: 'Document control procedure',
        p_position: 'a0',
        p_values: { [controls.field('status')]: 'opt_done' },
      },
    });
    await page.reload();

    // ── the catalogue: own-words titles, a licence note on every framework
    const row = catalogueRow(page, ISO27001);
    await expect(row).toContainText('127 requirements');
    await expect(row).toContainText('Reference numbers only');
    await expect(catalogueRow(page, 'NIS2 (Directive (EU) 2022/2555)')).toContainText('EUR-Lex');

    await adopt(page, ISO27001, 127);
    await adopt(page, ISO9001, 45);
    const adopted = page.getByRole('list', { name: 'Adopted frameworks' });
    await expect(adopted.getByRole('listitem')).toHaveCount(2);

    // ── what adopting wrote: library sheets, one item per requirement with its key and Ref
    const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
    const libs = await rest<Lib[]>(
      page,
      `sheets?org_id=eq.${org!.id}&is_library=is.true&select=id,name&order=position`,
    );
    const lib27 = libs.find((l) => l.name === 'ISO/IEC 27001:2022 requirements')!;
    const lib9 = libs.find((l) => l.name === 'ISO 9001:2015 requirements')!;
    const items27 = await rest<Row[]>(
      page,
      `items?sheet_id=eq.${lib27.id}&select=id,display_id,name,requirement_ref,values&order=seq`,
    );
    expect(items27).toHaveLength(127);
    expect(items27.filter((i) => i.requirement_ref.includes('#A.'))).toHaveLength(93);
    const fields27 = await rest<{ id: string; key: string }[]>(
      page,
      `fields?sheet_id=eq.${lib27.id}&select=id,key`,
    );
    const f27 = (key: string) => fields27.find((f) => f.key === key)!.id;
    const req = (ref: string) =>
      items27.find((i) => i.requirement_ref === `iso-27001@2022#${ref}`)!;
    expect(req('A.5.1').values[f27('ref')]).toBe('A.5.1');
    const [log] = await rest<{ action: string }[]>(
      page,
      `activity_log?org_id=eq.${org!.id}&action=eq.framework.adopted&select=action&limit=1`,
    );
    expect(log?.action).toBe('framework.adopted');

    // the Ref never changes
    const refChange = await rest(page, 'rpc/set_item_values', {
      method: 'POST',
      body: { p_item: req('A.5.1').id, p_patch: { [f27('ref')]: 'A.5.99' } },
    }).catch((e: Error) => e.message);
    expect(String(refChange)).toContain('never changes');

    // ── applicability and justification (the statement of applicability)
    await rest(page, 'rpc/set_item_values', {
      method: 'POST',
      body: {
        p_item: req('A.7.4').id,
        p_patch: {
          [f27('applicable')]: { applicable: false, reason: '' },
          [f27('justification')]: 'No premises of our own: we work from a shared office.',
        },
      },
    });

    // ── a control covers 27001 7.5.3
    await rest(page, 'rpc/set_item_links', {
      method: 'POST',
      body: {
        p_field: controls.field('requirements'),
        p_from: control.id,
        p_to: [req('7.5.3').id],
        p_mode: 'replace',
      },
    });
    await page.reload();
    await expect(adopted.getByRole('listitem').filter({ hasText: ISO27001 })).toContainText(
      '0% covered (1 of 126) · 0 applicable · 1 not applicable · 126 to decide',
    );

    // ── the library: refs on the name's subline, the requirement's controls and "Also satisfies"
    await page.goto(`/${slug}/s/${lib27.id}?item=${req('7.5.3').display_id}`);
    const panel = page.getByRole('dialog');
    const section = panel.getByRole('region', { name: 'Requirement · 27001 7.5.3' });
    await expect(section).toBeVisible();
    await expect(section.getByRole('list', { name: 'Controls' })).toContainText(
      'Document control procedure',
    );
    await expect(section).toContainText('Covered: an implemented control or current evidence.');
    await expect(section.getByRole('list', { name: 'Also satisfies' })).toContainText('9001 7.5.3');
    await expect(section.getByRole('list', { name: 'Also satisfies' })).toContainText('Equivalent');
    await expect(section).toContainText('Klarert mapping v1');

    // ── the statement of applicability is a saved view of the library
    await page.goto(`/${slug}/s/${lib27.id}`);
    await page.getByRole('tab', { name: 'Statement of applicability' }).click();
    const grid = page.getByRole('grid');
    await expect(grid).toContainText('Clause 4');
    await expect(grid).not.toContainText('Internal and external issues');
    // Annex A comes after the clauses' (empty) groups: scroll the virtual rows into view
    const a74 = grid.getByRole('row').filter({ hasText: 'Watching the premises' });
    await grid.hover();
    await expect(async () => {
      if (!(await a74.count())) await page.mouse.wheel(0, 1200);
      await expect(a74).toHaveCount(1, { timeout: 500 });
    }).toPass({ timeout: 20_000 });
    await expect(a74).toContainText('A.7.4');
    await expect(a74).toContainText('Not applicable');

    // ── the control: "Covers" and a one-click link to the suggested equivalent
    await page.goto(`${controls.url}&item=${control.display_id}`);
    const covers = page.getByRole('dialog').getByRole('region', { name: 'Requirements' });
    await expect(covers.getByRole('list', { name: 'Covers' })).toContainText('27001 7.5.3');
    const suggested = covers.getByRole('list', { name: 'Suggested equivalents' });
    await expect(suggested).toContainText('9001 7.5.3');
    await suggested.getByRole('button', { name: 'Link 9001 7.5.3' }).click();
    await expect(covers.getByRole('list', { name: 'Covers' })).toContainText('9001 7.5.3');

    // linked both ways: the 9001 library's Controls column holds the control
    const fields9 = await rest<{ id: string; key: string }[]>(
      page,
      `fields?sheet_id=eq.${lib9.id}&select=id,key`,
    );
    const controls9 = fields9.find((f) => f.key === 'controls')!.id;
    const mirrored = await rest<{ to_item: string }[]>(
      page,
      `item_links?field_id=eq.${controls9}&select=to_item`,
    );
    expect(mirrored.map((m) => m.to_item)).toEqual([control.id]);
  });
});

test('an editor sees no Adopt and cannot adopt', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop');
  const slug = seedWorkspace('fwe', { empty: true });
  await signIn(page, 'james@example.com', `/${slug}/settings?tab=frameworks`);
  await expect(
    page.getByText('Only owners and admins can change workspace settings.'),
  ).toBeVisible();
  const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
  const denied = await rest(page, 'rpc/adopt_framework', {
    method: 'POST',
    body: { p_org: org!.id, p_framework: 'iso-27001', p_version: '2022', p_plan: {} },
  }).catch((e: Error) => e.message);
  expect(String(denied)).toContain('only owners and admins');
});

test('phone: the frameworks page fits 390 px', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only');
  const slug = seedWorkspace('fwp', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/settings?tab=frameworks`);
  await expect(page.getByRole('heading', { name: 'Framework catalogue' })).toBeVisible();
  await expect(catalogueRow(page, ISO27001).getByRole('button', { name: /^Adopt/ })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
