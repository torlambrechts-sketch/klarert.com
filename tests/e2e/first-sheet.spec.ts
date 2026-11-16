import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { nextAnswer } from './automation-helpers';
import {
  actionsSettled,
  idsOf,
  isoIn,
  localSql,
  popoverGone,
  seedWorkspace,
  shortDate,
  trackActions,
  ukDate,
} from './first-sheet-helpers';
import { MIN_FILL_MS, OPEN_PUBLIC_FORM, rest, signIn } from './helpers';

// docs/07 · the first spreadsheet, end to end. Part A builds "Corrective actions" by hand in an empty workspace;
// Part B loads templates/first-sheet.json (the seed's importer) into a fresh workspace and walks rows B1–B12.
// Each part seeds its own workspace (scripts/seed.ts with SEED_WORKSPACE), so runs never share data.
// Dates are relative to today (the template's tokens are), so the walkthrough holds on any day.

test.describe.configure({ mode: 'default' });
test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop walkthrough'));

const grid = (page: Page) => page.getByRole('grid').first();
const panel = (page: Page) => page.getByRole('dialog').first();
const views = (page: Page) => page.getByRole('navigation', { name: 'Views' });

/** Grid cell: column 0 is the name, then the fields in order. */
const cell = (page: Page, item: string, index: number) =>
  grid(page)
    .getByRole('row')
    .filter({ has: page.getByRole('gridcell', { name: item, exact: false }) })
    .getByRole('gridcell')
    .nth(index);

/** Add a field from the header "+" with its name (the key comes from it), then configure it in its settings. */
async function addField(
  page: Page,
  type: RegExp,
  search: string,
  name: string,
  configure?: (settings: ReturnType<Page['getByRole']>) => Promise<void>,
) {
  await grid(page).evaluate((el) => (el.scrollLeft = el.scrollWidth));
  await grid(page).getByRole('button', { name: 'Add a field' }).first().click();
  await page.getByLabel('Search field types').fill(search);
  await page.getByRole('button', { name: type }).first().click();
  await page.getByLabel('Field name').fill(name);
  const answered = nextAnswer(page);
  await page.getByRole('button', { name: 'Add field' }).click();
  await answered;
  await popoverGone(page);
  if (!configure) return;
  await grid(page).evaluate((el) => (el.scrollLeft = el.scrollWidth));
  await grid(page)
    .getByRole('button', { name: `${name} column menu`, exact: true })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog');
  await configure(settings);
  const saved = nextAnswer(page);
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await saved;
  await expect(settings).toHaveCount(0);
}

test('Part A · build Corrective actions by hand', async ({ page }) => {
  test.setTimeout(300_000);
  const slug = seedWorkspace('fs-a', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/home`);
  await expect(page).toHaveURL(new RegExp(`/${slug}/home`));

  // ── 1. Rail → + New sheet → Tracker
  await page
    .getByRole('navigation', { name: 'Side menu' })
    .getByRole('link', { name: 'New sheet', exact: true })
    .click();
  // "New sheet" opens Create at the Sheet card (docs/05 §4 Create)
  await page
    .getByRole('dialog', { name: 'Create' })
    .getByRole('link', { name: /^Tracker/ })
    .click();
  await page.getByLabel('Sheet name').fill('Corrective actions');
  await page.getByLabel('Items are called').fill('Corrective action');
  await expect(page.getByLabel('ID prefix')).toHaveValue('CA-');
  await expect(page.getByLabel('Folder', { exact: true })).toHaveValue(/.+/);
  await expect(page.getByLabel('Folder', { exact: true }).locator('option:checked')).toHaveText(
    'Your sheets',
  );
  await page.getByLabel('Groups').fill('Open, Closed');
  const columns: [string, string][] = [
    ['Owner', 'people'],
    ['Status', 'status'],
    ['Priority', 'severity'],
    ['Due date', 'date'],
    ['Progress', 'percent'],
  ];
  for (const [i, [name, type]] of columns.entries()) {
    await expect(page.getByLabel(`Name of field ${i + 1}`)).toHaveValue(name);
    await expect(page.getByLabel(`Type of field ${i + 1}`)).toHaveValue(type);
  }
  await page.getByRole('button', { name: 'Remove Progress' }).click();
  await page.getByRole('button', { name: 'Create sheet' }).click();
  await expect(page.getByText('Sheet created. Add your first item.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Corrective actions' })).toBeVisible();
  await expect(views(page).getByRole('link', { name: 'Table' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const rail = page.getByRole('navigation', { name: 'Side menu' });
  await expect(rail.getByRole('link', { name: 'Corrective actions' })).toHaveAttribute(
    'data-testid',
    'rail-sheet-CA',
  );
  await expect(rail.getByText('Your sheets')).toBeVisible();
  const caUrl = page.url().replace(/\?.*$/, '');

  // ── 2. "+ Add item" in Open (the Table's add row), Enter to continue, Esc
  await views(page).getByRole('link', { name: 'Table' }).click();
  const add = page.getByRole('textbox', { name: 'Add corrective action to Open' });
  await add.click();
  await add.fill('Burrs on bracket 44-210');
  await add.press('Enter');
  await expect(add).toHaveValue('');
  await add.fill('Guard bypassed on press 3');
  await add.press('Enter');
  await expect(add).toHaveValue('');
  await add.press('Escape');
  await expect(grid(page).locator('[id^="cell-temp-"]')).toHaveCount(0);
  await expect(cell(page, 'Burrs on bracket 44-210', 0)).toContainText('CA-001');
  await expect(cell(page, 'Guard bypassed on press 3', 0)).toContainText('CA-002');
  const ids = await idsOf(page, slug);
  const ca1 = await ids.item('Corrective actions', 'Burrs on bracket 44-210');
  const ca2 = await ids.item('Corrective actions', 'Guard bypassed on press 3');
  expect([ca1.display_id, ca2.display_id]).toEqual(['CA-001', 'CA-002']);
  const created = await rest<{ action: string; actor_kind: string; actor_id: string }[]>(
    page,
    `activity_log?item_id=eq.${ca1.id}&select=action,actor_kind,actor_id`,
  );
  const [maria] = await rest<{ user_id: string }[]>(
    page,
    `memberships?org_id=eq.${ids.orgId}&role=eq.owner&select=user_id`,
  );
  expect(created).toEqual([
    { action: 'item.created', actor_kind: 'user', actor_id: maria!.user_id },
  ]);

  // ── 3. Header "+": Dropdown, Long text, Risk matrix, Formula, Checklist, Evidence, Button
  await addField(page, /^Dropdown/, 'dropdown', 'Source', async (s) => {
    const options = ['Internal audit', 'Customer complaint', 'Incident', 'Supplier'];
    for (const [i, label] of options.entries()) {
      if ((await s.getByLabel(`Option ${i + 1} label`).count()) === 0)
        await s.getByRole('button', { name: 'Add option' }).click();
      await s.getByLabel(`Option ${i + 1} label`).fill(label);
    }
    while ((await s.getByLabel(`Option ${options.length + 1} label`).count()) > 0)
      await s
        .getByRole('button', { name: /^Remove / })
        .last()
        .click();
  });
  await addField(page, /^Long text/, 'long text', 'Root cause');
  await addField(page, /^Risk matrix/, 'risk matrix', 'Risk', async (s) => {
    await expect(s.getByLabel('Matrix size')).toHaveValue('5');
  });
  await addField(page, /^Formula/, 'formula', 'Priority score', async (s) => {
    await s
      .getByLabel('Formula')
      .fill('ROUND({risk} + MAX(0, 30 - DAYS({due_date}, TODAY())) / 3, 0)');
    // the live preview evaluates on the first item
    await expect(s.getByText(/^On CA-001:/)).toBeVisible();
  });
  await addField(page, /^Checklist/, 'checklist', 'Effectiveness check', async (s) => {
    const lines = [
      'The fix is in place on every affected line or site',
      'No repeat in the 30 days after the fix',
      'Procedures and training updated where needed',
    ];
    for (const [i, text] of lines.entries()) {
      if ((await s.getByLabel(`Line ${i + 1}`, { exact: true }).count()) === 0)
        await s.getByRole('button', { name: 'Add line' }).click();
      await s.getByLabel(`Line ${i + 1}`, { exact: true }).fill(text);
    }
  });
  await addField(page, /^Evidence/, 'evidence', 'Evidence', async (s) => {
    await s.getByLabel('Valid for (days)').fill('365');
  });
  await addField(page, /^Button/, 'button', 'Raise action', async (s) => {
    await s.getByLabel('Button label').fill('Raise action');
  });
  await page.getByRole('link', { name: 'Sheet settings' }).click();
  const fieldList = page.getByRole('list', { name: 'Fields' });
  for (const key of [
    'source',
    'root_cause',
    'risk',
    'priority_score',
    'effectiveness_check',
    'evidence',
    'raise_action',
  ])
    await expect(fieldList.getByText(`{${key}}`)).toBeVisible();

  // ── 4. Blank sheet "Actions", then a two-way Link to items from Corrective actions
  await rail.getByRole('link', { name: 'New sheet', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Create' })
    .getByRole('link', { name: /^Blank/ })
    .click();
  // Sheet settings (still on screen while New sheet loads) has a "Sheet name" too: fill the wizard's form
  const details = page.getByRole('form', { name: 'Sheet details' });
  await details.getByLabel('Sheet name').fill('Actions');
  await details.getByLabel('ID prefix').fill('ACT-');
  await details.getByLabel('Groups').fill('To do, Done');
  await details.getByRole('button', { name: 'Create sheet' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Actions' })).toBeVisible();
  const actUrl = page.url().replace(/\?.*$/, '');
  await page.goto(`${caUrl}?view=table`);
  await addField(page, /^Link to items/, 'link to items', 'Actions', async (s) => {
    await s.getByLabel('Links to sheet').selectOption({ label: 'Actions' });
    await s.getByLabel('Show on Actions too').check();
  });
  await page.goto(`${actUrl}?view=table`);
  await expect(
    grid(page).getByRole('button', { name: 'Corrective action column menu' }).first(),
  ).toBeVisible();
  const addAct = page.getByRole('textbox', { name: /^Add .* to To do$/ });
  await addAct.fill('Deburr lot 2210');
  await addAct.press('Enter');
  await expect(grid(page).getByText('Deburr lot 2210', { exact: true })).toBeVisible();
  await expect(grid(page).locator('[id^="cell-temp-"]')).toHaveCount(0);
  // link from the Actions side: shows on both
  await grid(page).getByRole('button', { name: 'Deburr lot 2210', exact: true }).click();
  await panel(page)
    .getByRole('button', { name: /^Edit Corrective action/ })
    .click();
  await page.getByRole('textbox', { name: 'Search items for Corrective action' }).fill('Burrs');
  await page.getByRole('checkbox', { name: /Burrs on bracket 44-210/ }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel(page).getByRole('list', { name: 'Linked items' })).toContainText(
    'Burrs on bracket 44-210',
  );
  await expect(
    page.getByRole('textbox', { name: 'Search items for Corrective action' }),
  ).toHaveCount(0);
  await page.goto(`${caUrl}?view=table&item=CA-001`);
  await expect(panel(page).getByRole('list', { name: 'Linked items' })).toContainText(
    'Deburr lot 2210',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // ── 5. Status rules: Done requires Root cause, Evidence, Effectiveness check; Stuck requires a comment
  await grid(page).getByRole('button', { name: 'Status column menu' }).first().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog');
  await settings.getByRole('button', { name: 'Add rule' }).click();
  const rule1 = settings.getByRole('group', { name: 'Rule 1' });
  await rule1.getByRole('checkbox', { name: 'Done' }).check();
  for (const f of ['Root cause', 'Evidence', 'Effectiveness check'])
    await rule1.getByRole('checkbox', { name: f, exact: true }).check();
  await rule1
    .getByLabel('Message when blocked')
    .fill('Add the root cause, evidence and the effectiveness check before closing.');
  await settings.getByRole('button', { name: 'Add rule' }).click();
  const rule2 = settings.getByRole('group', { name: 'Rule 2' });
  await rule2.getByRole('checkbox', { name: 'Stuck' }).check();
  await rule2.getByRole('checkbox', { name: 'Ask for a comment' }).check();
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Field settings saved.').first()).toBeVisible();

  // ── 6. CA-001: Owner Tom, Source Customer complaint, Priority Medium, Due date in 5 days, Risk 3×3
  await page.goto(`${caUrl}?view=table&item=CA-001`);
  const p = panel(page);
  await p.getByRole('button', { name: /^Edit Owner/ }).click();
  await page
    .getByRole('listbox', { name: 'Owner' })
    .getByRole('option', { name: /Tom Kirby/ })
    .click();
  // each edit waits for the server's answer, so step 7 counts the activity entries of settled writes
  let saved = nextAnswer(page);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await saved;
  await expect(p.getByRole('button', { name: /^Edit Owner: .*Tom Kirby/ })).toBeVisible();
  await popoverGone(page);
  await p.getByRole('button', { name: /^Edit Source/ }).click();
  saved = nextAnswer(page);
  await page.getByRole('option', { name: 'Customer complaint' }).click();
  await saved;
  await expect(p.getByRole('button', { name: 'Edit Source: Customer complaint' })).toBeVisible();
  await popoverGone(page);
  await p.getByRole('button', { name: /^Edit Priority/ }).click();
  saved = nextAnswer(page);
  await page.getByRole('option', { name: 'Medium' }).click();
  await saved;
  await expect(p.getByRole('button', { name: /^Edit Priority: Medium/ })).toBeVisible();
  await popoverGone(page);
  const due = isoIn(5);
  await p.getByRole('button', { name: /^Edit Due date/ }).click();
  await page.getByRole('textbox', { name: 'Due date' }).fill(ukDate(due));
  saved = nextAnswer(page);
  await page.keyboard.press('Enter');
  await saved;
  await expect(p.getByRole('button', { name: /^Edit Due date: / })).toContainText('in 5 days');
  await popoverGone(page);
  await p.getByRole('button', { name: /^Edit Risk/ }).click();
  saved = nextAnswer(page);
  await page.getByRole('button', { name: /^Likelihood 3, impact 3: 9/ }).click();
  await saved;
  await expect(p.getByRole('button', { name: /^Edit Risk: 9/ })).toBeVisible();
  await popoverGone(page);
  // 9 + (30 − 5) / 3 = 17.33 → 17
  await expect(p.getByRole('button', { name: /^About Priority score/ })).toHaveAccessibleName(
    'About Priority score: 17',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // the Table's date track counts down in short form (docs/05 Cells: "in 65d"); the panel says "in 5 days" above
  await expect(cell(page, 'Burrs on bracket 44-210', 4)).toContainText('in 5d');
  await expect(cell(page, 'Burrs on bracket 44-210', 4)).toContainText(shortDate(due));

  // ── 7. CA-001 Status → Done: blocked by the rule, value unchanged, no activity entry
  const before = await rest<unknown[]>(page, `activity_log?item_id=eq.${ca1.id}&select=id`);
  await cell(page, 'Burrs on bracket 44-210', 2).dblclick();
  let answered = nextAnswer(page);
  await page.getByRole('listbox', { name: 'Status' }).getByRole('option', { name: 'Done' }).click();
  await answered;
  await expect(
    page.getByText('Add the root cause, evidence and the effectiveness check before closing.'),
  ).toBeVisible();
  await expect(cell(page, 'Burrs on bracket 44-210', 2)).not.toContainText('Done');
  expect(await rest<unknown[]>(page, `activity_log?item_id=eq.${ca1.id}&select=id`)).toHaveLength(
    before.length,
  );
  await popoverGone(page);

  // ── 8. CA-002 Status → Stuck → comment → Save
  await cell(page, 'Guard bypassed on press 3', 2).dblclick();
  await page
    .getByRole('listbox', { name: 'Status' })
    .getByRole('option', { name: 'Stuck' })
    .click();
  const comment = page.getByRole('dialog', { name: 'Add a comment' });
  await comment.getByLabel('Comment').fill('Waiting for the safety engineer');
  answered = nextAnswer(page);
  await comment.getByRole('button', { name: 'Save with comment' }).click();
  await answered;
  await expect(cell(page, 'Guard bypassed on press 3', 2)).toContainText('Stuck');
  const updates = await rest<{ body: string }[]>(
    page,
    `item_updates?item_id=eq.${ca2.id}&select=body`,
  );
  expect(updates).toEqual([{ body: 'Waiting for the safety engineer' }]);
  // the comment is free text about people: the log keeps a marker, the item's readers read it beside it (0065)
  const notes = await rest<{ id: number; note: string | null }[]>(
    page,
    `activity_log?item_id=eq.${ca2.id}&action=eq.value.changed&select=id,note`,
  );
  const commented = notes.filter((n) => n.note);
  expect(commented.length).toBeGreaterThan(0);
  expect(commented.every((n) => /^\{"\$personal": "[0-9a-f]{64}"\}$/.test(n.note!))).toBe(true);
  const kept = await rest<{ new_value: string }[]>(
    page,
    `personal_activity?slot=eq.note&activity_id=in.(${commented.map((n) => n.id).join(',')})&select=new_value`,
  );
  expect(kept.map((k) => k.new_value)).toContain('Waiting for the safety engineer');

  // ── 9. Grid: paste a date and "not a date" into the Due date cells of CA-001..002
  await cell(page, 'Burrs on bracket 44-210', 4).click();
  const pasted = isoIn(9);
  await grid(page).evaluate(
    (el, t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    },
    `${ukDate(pasted)}\nnot a date`,
  );
  await expect(page.getByText('1 cell pasted, 1 skipped: not a date')).toBeVisible();
  await expect(cell(page, 'Burrs on bracket 44-210', 4)).toContainText(shortDate(pasted));

  // ── 10. Item panel CA-001 → Activity log → Verify audit trail
  await grid(page).getByRole('button', { name: 'Burrs on bracket 44-210', exact: true }).click();
  await panel(page)
    .getByRole('tab', { name: /^Activity log/ })
    .click();
  await panel(page).getByRole('button', { name: 'Verify audit trail' }).click();
  await expect(
    panel(page).getByRole('status').filter({ hasText: 'Audit trail intact' }),
  ).toHaveText(/^Audit trail intact\. \d+ entries recomputed\.$/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // ── 11. 390 px: cards instead of the table, the bottom bar, the panel full screen
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(caUrl);
  await expect(
    page.getByTestId('item-card').filter({ hasText: 'Burrs on bracket 44-210' }),
  ).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Bottom bar' })).toBeVisible();
  await page.getByTestId('item-card').filter({ hasText: 'Burrs on bracket 44-210' }).click();
  const box = (await panel(page).boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.width).toBe(390);
});

// ───────────────────────── Part B · automations on the reference template ─────────────────────────

type Run = {
  status: string;
  depth: number;
  detail: string;
  item_id: string;
  steps: { outcome: string }[];
};

test.describe('Part B · automations on the reference template', () => {
  // the rows build on each other (B3 creates ACT-003, B4 closes it …): one workspace, in order
  test.describe.configure({ mode: 'serial' });
  let slug = '';
  let ca = '';
  let act = '';
  const autoId = new Map<string, string>();

  test.beforeAll(({}, info) => {
    if (info.project.name === 'phone') return;
    slug = seedWorkspace('fs-b');
  });

  /** Signed in as someone, with the workspace's ids at hand. */
  async function as(page: Page, email: string) {
    trackActions(page);
    await signIn(page, email, `/${slug}/home`);
    await expect(page).toHaveURL(new RegExp(`/${slug}/home`));
    const ids = await idsOf(page, slug);
    ca = ids.sheets['Corrective actions']!;
    act = ids.sheets['Actions']!;
    const autos = await rest<{ id: string; name: string }[]>(
      page,
      `automations?org_id=eq.${ids.orgId}&select=id,name`,
    );
    for (const a of autos) autoId.set(a.name, a.id);
    return ids;
  }
  const auto = (start: string) => {
    const hit = [...autoId].find(([name]) => name.startsWith(start));
    if (!hit) throw new Error(`no automation "${start}"`);
    return hit[1];
  };
  const runs = (page: Page, automation: string, itemId?: string) =>
    rest<Run[]>(
      page,
      `automation_runs?automation_id=eq.${automation}${itemId ? `&item_id=eq.${itemId}` : ''}&select=status,depth,detail,item_id,steps&order=id`,
    );

  /** Open an item's panel by its display id. */
  async function openItem(page: Page, sheetId: string, displayId: string) {
    await page.goto(`/${slug}/s/${sheetId}?view=table&item=${displayId}`);
    await expect(panel(page).getByText(displayId).first()).toBeVisible();
    return panel(page);
  }

  /**
   * Edits in the panel hold the row's automations until the person finishes it. Close the panel (that finishes the
   * row, once its last edit has landed), wait until the server has answered every action, then open the same item
   * again. The finished row's automations report in a toast: pass `toast` to see it before the item is opened again
   * (a page load clears toasts).
   */
  async function finishPanel(page: Page, toast?: string | RegExp) {
    const url = new URL(page.url());
    const item = url.searchParams.get('item');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await actionsSettled(page);
    if (toast) await expect(page.getByText(toast).first()).toBeVisible();
    if (item) {
      url.searchParams.set('item', item);
      await page.goto(url.toString());
      await expect(panel(page).getByText(item).first()).toBeVisible();
    }
  }

  /** Pick an option of a label field in the panel and wait for the command (and its automations, and their toast). */
  async function pick(page: Page, field: string, option: string, toast?: string | RegExp) {
    await panel(page)
      .getByRole('button', { name: new RegExp(`^Edit ${field}`) })
      .click();
    const answered = nextAnswer(page);
    await page.getByRole('listbox', { name: field }).getByRole('option', { name: option }).click();
    await answered;
    await popoverGone(page);
    await finishPanel(page, toast);
  }

  async function risk(page: Page, l: number, i: number) {
    await panel(page)
      .getByRole('button', { name: /^Edit Risk/ })
      .click();
    const answered = nextAnswer(page);
    await page.getByRole('button', { name: new RegExp(`^Likelihood ${l}, impact ${i}:`) }).click();
    await answered;
    await popoverGone(page);
    await finishPanel(page);
  }

  test('the import loaded both sheets with items, links and the 9 automations', async ({
    page,
  }) => {
    const ids = await as(page, 'maria@example.com');
    const sheets = await rest<{ id: string; name: string; parent_sheet_id: string | null }[]>(
      page,
      `sheets?org_id=eq.${ids.orgId}&select=id,name,parent_sheet_id`,
    );
    expect(
      sheets
        .filter((s) => !s.parent_sheet_id)
        .map((s) => s.name)
        .sort(),
    ).toEqual(['Actions', 'Corrective actions']);
    // the template's sub-items (Steps) live on a hidden child sheet of Corrective actions (docs/02 §12)
    expect(sheets.filter((s) => s.parent_sheet_id).map((s) => [s.name, s.parent_sheet_id])).toEqual(
      [['Corrective actions · Steps', ids.sheets['Corrective actions']]],
    );
    const items = await rest<{ display_id: string; sheet_id: string }[]>(
      page,
      `items?org_id=eq.${ids.orgId}&select=display_id,sheet_id&order=display_id`,
    );
    expect(items.map((i) => i.display_id)).toEqual([
      'ACT-001',
      'ACT-002',
      'CA-001',
      'CA-002',
      'CA-003',
      'CA-004',
      'CA-005',
    ]);
    expect(
      await rest<unknown[]>(page, `item_links?org_id=eq.${ids.orgId}&select=from_item`),
    ).toHaveLength(4);
    expect(autoId.size).toBe(9);
    // written as the system: the importer installs the template through install_pack (docs/11), whose note it is
    const log = await rest<{ actor_kind: string; note: string }[]>(
      page,
      `activity_log?org_id=eq.${ids.orgId}&action=eq.item.created&select=actor_kind,note`,
    );
    expect(new Set(log.map((l) => `${l.actor_kind}:${l.note}`))).toEqual(
      new Set(['system:Pack install']),
    );
    // the Table view hides what the template says; the template's Kanban is under More
    await page.goto(`/${slug}/s/${ca}`);
    await expect(page.getByText('Guard bypassed on press 3').first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'What happened' })).toHaveCount(0);
  });

  test('B1 · Critical severity alerts the HSE manager once', async ({ page, browser }) => {
    await as(page, 'maria@example.com');
    const guard = await idsOf(page, slug).then((i) =>
      i.item('Corrective actions', 'Guard bypassed on press 3'),
    );
    await openItem(page, ca, guard.display_id);
    await pick(page, 'Severity', 'High');
    await pick(page, 'Severity', 'Critical', /^Critical severity → alert the HSE manager: Notify/);
    const r = await runs(page, auto('Critical severity'));
    expect(r.map((x) => [x.status, x.steps.length])).toEqual([['done', 1]]);

    // the run log shows it
    await page.goto(`/${slug}/automations?tab=runs`);
    const run = page.getByRole('table', { name: 'Runs' }).getByRole('row').filter({
      hasText: 'Critical severity → alert the HSE manager',
    });
    await expect(run).toHaveCount(1);
    await expect(run).toContainText(guard.display_id);
    await expect(run.getByRole('button', { name: '1 step' })).toBeVisible();

    // Tom (HSE manager) has the notification
    const tom = await browser.newPage();
    await signIn(tom, 'tom@example.com', `/${slug}/home`);
    const notes = await rest<{ kind: string; body: string }[]>(
      tom,
      `notifications?item_id=eq.${guard.id}&select=kind,body`,
    );
    expect(notes).toEqual([
      expect.objectContaining({
        kind: 'notify',
        body: expect.stringContaining(
          `Critical corrective action: ${guard.display_id} Guard bypassed on press 3`,
        ),
      }),
    ]);
    await tom.close();
  });

  test('B2 · priority score above 15 raises the severity only when it is at most Medium', async ({
    page,
  }) => {
    const ids = await as(page, 'maria@example.com');
    const fw = await ids.item('Corrective actions', 'Shared admin account on firewall');
    const raise = auto('Priority score above 15');
    const p = await openItem(page, ca, fw.display_id);
    await expect(p.getByRole('button', { name: 'About Priority score: 15' })).toBeVisible();
    await risk(page, 4, 5);
    await expect(p.getByRole('button', { name: 'About Priority score: 23' })).toBeVisible();
    expect(await runs(page, raise)).toEqual([]);

    await risk(page, 3, 4);
    await expect(p.getByRole('button', { name: 'About Priority score: 15' })).toBeVisible();
    await pick(page, 'Severity', 'Low');
    await risk(page, 4, 5);
    await expect(p.getByRole('button', { name: /^Edit Severity: High/ })).toBeVisible();
    const r = await runs(page, raise);
    expect(r.map((x) => x.status)).toEqual(['done']);
    const posts = await rest<{ kind: string; body: string }[]>(
      page,
      `item_updates?item_id=eq.${fw.id}&select=kind,body`,
    );
    expect(posts).toEqual([
      { kind: 'automation', body: 'Severity raised to High: priority score is 23.' },
    ]);
  });

  test('B3 + B4 · Raise action creates a linked action; done on the action reaches the corrective action live', async ({
    page,
    browser,
  }) => {
    const ids = await as(page, 'maria@example.com');
    const burrs = await ids.item('Corrective actions', 'Burrs on bracket 44-210');
    const p = await openItem(page, ca, burrs.display_id);
    await p.getByRole('button', { name: /^About Raise action/ }).click();
    const answered = nextAnswer(page);
    await page
      .getByRole('group', { name: 'Raise action' })
      .getByRole('button', { name: 'Raise action' })
      .click();
    await answered;
    await popoverGone(page);
    await expect(p.getByRole('button', { name: /^Edit Status: Action set/ })).toBeVisible();

    const [created] = await rest<
      {
        id: string;
        display_id: string;
        name: string;
        values: Record<string, unknown>;
        group_id: string;
      }[]
    >(
      page,
      `items?sheet_id=eq.${act}&display_id=eq.ACT-003&select=id,display_id,name,values,group_id`,
    );
    expect(created!.name).toBe(`Action for ${burrs.display_id}: Burrs on bracket 44-210`);
    const [todo] = await rest<{ id: string }[]>(
      page,
      `groups?sheet_id=eq.${act}&name=eq.To do&select=id`,
    );
    expect(created!.group_id).toBe(todo!.id);
    expect(created!.values[await ids.field('Actions', 'due_date')]).toBe(isoIn(14));
    const [tom] = await rest<{ id: string }[]>(
      page,
      `profiles?display_name=eq.Tom Kirby&select=id`,
    );
    expect(created!.values[await ids.field('Actions', 'owner')]).toEqual([tom!.id]);
    // linked both ways
    const back = await rest<{ to_item: string }[]>(
      page,
      `item_links?from_item=eq.${created!.id}&select=to_item`,
    );
    expect(back).toEqual([{ to_item: burrs.id }]);
    const out = await rest<{ to_item: string }[]>(
      page,
      `item_links?from_item=eq.${burrs.id}&field_id=eq.${await ids.field('Corrective actions', 'actions')}&select=to_item`,
    );
    expect(out.map((l) => l.to_item)).toContain(created!.id);
    // 0 of 2 linked actions done (ACT-001 is still in progress)
    await expect(p.getByRole('button', { name: /^About Actions done/ })).toContainText('0%');

    // B4: a second tab keeps the corrective action open; ACT-003 → Done in this one
    const second = await page.context().newPage();
    await second.goto(`/${slug}/s/${ca}?view=table&item=${burrs.display_id}`);
    const watching = panel(second);
    await expect(watching.getByRole('button', { name: /^About Actions done/ })).toContainText('0%');
    await second.waitForTimeout(1500); // let the realtime channel join

    await openItem(page, act, 'ACT-003');
    await pick(page, 'Status', 'Done');
    const [done] = await rest<{ values: Record<string, unknown>; group_id: string }[]>(
      page,
      `items?id=eq.${created!.id}&select=values,group_id`,
    );
    expect(done!.values[await ids.field('Actions', 'done_on')]).toBe(isoIn(0));
    const [doneGroup] = await rest<{ id: string }[]>(
      page,
      `groups?sheet_id=eq.${act}&name=eq.Done&select=id`,
    );
    expect(done!.group_id).toBe(doneGroup!.id);
    const r = await runs(page, auto('Action done'), created!.id);
    expect(r.map((x) => [x.status, x.steps.map((s) => s.outcome)])).toEqual([
      ['done', ['done', 'done', 'done']],
    ]);
    await expect(watching.getByRole('button', { name: /^About Actions done/ })).toContainText(
      '50%',
      {
        timeout: 40_000,
      },
    );
    await second.close();

    // Tom, the owner of the corrective action (a lookup), is told
    const tomPage = await browser.newPage();
    await signIn(tomPage, 'tom@example.com', `/${slug}/home`);
    const notes = await rest<{ body: string }[]>(
      tomPage,
      `notifications?item_id=eq.${created!.id}&select=body`,
    );
    expect(notes.map((n) => n.body)).toEqual([
      expect.stringContaining(`Action for ${burrs.display_id}: Burrs on bracket 44-210 is done.`),
    ]);
    await tomPage.close();
  });

  test('B5 + B6 · a failed effectiveness check reopens; evidence and three Yes close and lock', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const ids = await as(page, 'maria@example.com');
    const sup = await ids.item('Corrective actions', 'Supplier evaluations overdue');
    const p = await openItem(page, ca, sup.display_id);
    const line2 = 'No repeat in the 30 days after the fix';
    await p.getByRole('button', { name: /^Edit Effectiveness check/ }).click();
    await page
      .getByRole('group', { name: `Answer to ${line2}` })
      .getByRole('button', { name: 'No' })
      .click();
    await page.getByLabel(`Note for ${line2}`).fill('Two late evaluations in October');
    let answered = nextAnswer(page);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await answered;
    await popoverGone(page);
    await finishPanel(page);
    await expect(p.getByRole('button', { name: /^Edit Status: Investigating/ })).toBeVisible();
    const r5 = await runs(page, auto('Effectiveness answer is No'));
    expect(r5.map((x) => [x.status, x.steps.length])).toEqual([['done', 2]]);
    const notes = await rest<{ body: string }[]>(
      page,
      `notifications?item_id=eq.${sup.id}&select=body`,
    );
    expect(notes.map((n) => n.body)).toContainEqual(
      `An effectiveness check failed on ${sup.display_id}. The fix needs another look.`,
    );

    // B6: evidence with its hash, all three Yes, then Done
    const chooser = page.waitForEvent('filechooser');
    await p.getByRole('button', { name: 'Add file' }).click();
    await (
      await chooser
    ).setFiles({
      name: 'supplier-review.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nSupplier reviews done\n%%EOF\n'),
    });
    await expect(page.getByText('supplier-review.pdf added.')).toBeVisible();
    const [file] = await rest<{ sha256: string }[]>(
      page,
      `files?item_id=eq.${sup.id}&select=sha256`,
    );
    await expect(p.getByText(file!.sha256.slice(0, 8)).first()).toBeVisible();
    await p.getByRole('button', { name: /^Edit Effectiveness check/ }).click();
    for (const line of [
      'The fix is in place on every affected line or site',
      line2,
      'Procedures and training updated where needed',
    ]) {
      const yes = page
        .getByRole('group', { name: `Answer to ${line}` })
        .getByRole('button', { name: 'Yes' });
      if ((await yes.getAttribute('aria-pressed')) !== 'true') await yes.click();
    }
    answered = nextAnswer(page);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await answered;
    await popoverGone(page);
    await pick(
      page,
      'Status',
      'Done',
      /^Done → move to Closed and lock: Move to Closed · Lock the item: Closed/,
    );
    const [closed] = await rest<{ locked: boolean; lock_reason: string; group_id: string }[]>(
      page,
      `items?id=eq.${sup.id}&select=locked,lock_reason,group_id`,
    );
    const [closedGroup] = await rest<{ id: string }[]>(
      page,
      `groups?sheet_id=eq.${ca}&name=eq.Closed&select=id`,
    );
    expect(closed).toEqual({ locked: true, lock_reason: 'Closed', group_id: closedGroup!.id });
    const log = await rest<{ action: string; actor_kind: string; actor_id: string }[]>(
      page,
      `activity_log?item_id=eq.${sup.id}&action=in.(item.moved,item.locked)&select=action,actor_kind,actor_id&order=id`,
    );
    const closer = auto('Done → move to Closed');
    expect(log).toEqual([
      { action: 'item.moved', actor_kind: 'automation', actor_id: closer },
      { action: 'item.locked', actor_kind: 'automation', actor_id: closer },
    ]);

    // James (editor) cannot edit it
    const james = await browser.newPage();
    await signIn(james, 'james@example.com', `/${slug}/home`);
    await james.goto(`/${slug}/s/${ca}?view=table&item=${sup.display_id}`);
    await expect(panel(james).getByText('Locked: Closed').first()).toBeVisible();
    // the panel shows the values read-only; in the grid, editing is refused with the reason
    await expect(panel(james).getByRole('button', { name: /^Edit Root cause/ })).toHaveCount(0);
    await james.keyboard.press('Escape');
    await expect(james.getByRole('dialog')).toHaveCount(0);
    await expect(grid(james).getByText('Locked: Closed').first()).toBeAttached();
    await cell(james, 'Supplier evaluations overdue', 2).click();
    await james.keyboard.press('Enter');
    await expect(
      james.getByText('This item is locked: Closed. Only owners and admins can change it.').first(),
    ).toBeVisible();
    await expect(james.getByRole('listbox', { name: 'Status' })).toHaveCount(0);
    await james.close();
  });

  /** The cron secret of the local app (the scheduler and webhook routes). */
  function cronAuth() {
    const fromEnv = process.env.CRON_SECRET;
    if (fromEnv) return { Authorization: `Bearer ${fromEnv}` };
    const line = readFileSync('.env.local', 'utf8')
      .split('\n')
      .find((l) => l.startsWith('CRON_SECRET='));
    return {
      Authorization: `Bearer ${(line ?? '').slice('CRON_SECRET='.length).trim().replace(/^"|"$/g, '')}`,
    };
  }

  async function setDue(page: Page, iso: string) {
    await panel(page)
      .getByRole('button', { name: /^Edit Due date/ })
      .click();
    await page.getByRole('textbox', { name: 'Due date' }).fill(ukDate(iso));
    const answered = nextAnswer(page);
    await page.keyboard.press('Enter');
    await answered;
    await popoverGone(page);
    await finishPanel(page);
  }

  async function runDateChecks(page: Page) {
    await page.goto(`/${slug}/automations`);
    await expect(page.locator('[data-testid="inbox-button"][data-state-loaded]')).toBeVisible();
    const button = page.getByRole('button', { name: 'Run date checks now' });
    const answered = nextAnswer(page);
    await button.click();
    await answered;
    await expect(page.getByText(/^Date checks ran\./).first()).toBeVisible();
    await expect(button).toBeEnabled();
  }

  test('B7 · Due in 3 days asks the owner once per occurrence', async ({ page }) => {
    const ids = await as(page, 'maria@example.com');
    const cal = await ids.item('Corrective actions', 'Calibration label missing on CMM-2');
    const due = auto('Due in 3 days');
    await openItem(page, ca, cal.display_id);
    await setDue(page, isoIn(2));
    await runDateChecks(page);
    expect((await runs(page, due, cal.id)).map((r) => r.status)).toEqual(['done']);
    const requests = await rest<{ kind: string; body: string }[]>(
      page,
      `notifications?item_id=eq.${cal.id}&kind=eq.request&select=kind,body`,
    );
    expect(requests).toEqual([
      {
        kind: 'request',
        body: `${cal.display_id} Calibration label missing on CMM-2 is due on ${new Date(`${isoIn(2)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}. Please update the status.`,
      },
    ]);
    await page.goto(`/${slug}/my-work?filter=requests`);
    await expect(
      page.getByTestId('work-row').filter({ hasText: 'Calibration label missing on CMM-2' }),
    ).toContainText('Update requested');

    // again: nothing new
    await runDateChecks(page);
    expect(await runs(page, due, cal.id)).toHaveLength(1);

    // a new due date is a new occurrence
    await openItem(page, ca, cal.display_id);
    await setDue(page, isoIn(3));
    await runDateChecks(page);
    expect((await runs(page, due, cal.id)).map((r) => r.status)).toEqual(['done', 'done']);
  });

  test('B8 · a ping-pong between the sheets stops at depth 3', async ({ page }) => {
    const ids = await as(page, 'maria@example.com');
    const me = (
      await rest<{ user_id: string }[]>(
        page,
        `memberships?org_id=eq.${ids.orgId}&role=eq.owner&select=user_id`,
      )
    )[0]!.user_id;
    const linked = (link: string, value: string) => ({
      type: 'update_linked',
      path: { direction: 'out', linkFieldKey: link },
      fieldKey: 'status',
      value,
    });
    const made = await rest<{ id: string; name: string }[]>(page, 'automations?select=id,name', {
      method: 'POST',
      body: [
        {
          org_id: ids.orgId,
          sheet_id: ca,
          name: 'Ping: investigating starts the actions',
          trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_investigating' },
          actions: [linked('actions', 'opt_doing')],
          created_by: me,
        },
        {
          org_id: ids.orgId,
          sheet_id: act,
          name: 'Pong: an action that changes sets the corrective action',
          trigger: { type: 'field_changed', fieldKey: 'status' },
          actions: [linked('corrective_action', 'opt_action')],
          created_by: me,
        },
        {
          org_id: ids.orgId,
          sheet_id: ca,
          name: 'Ping again: action set resets the actions and investigates',
          trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_action' },
          actions: [
            linked('actions', 'opt_todo'),
            { type: 'set_field', fieldKey: 'status', value: 'opt_investigating' },
          ],
          created_by: me,
        },
      ],
    });
    const byName = Object.fromEntries(made.map((a) => [a.name.split(':')[0], a.id]));
    // CA-001 links ACT-001 (Working on it) and ACT-003 (Done, B4): "once per chain" lets each automation run once per
    // item, so the chain grows through both actions: Ping CA-001 (0) → Pong ACT-003 (1) → Ping again CA-001 (2) →
    // Pong ACT-001 (3) → Ping again CA-001 at depth 4 is stopped
    const burrs = await ids.item('Corrective actions', 'Burrs on bracket 44-210');
    await openItem(page, ca, burrs.display_id);
    await pick(
      page,
      'Status',
      'Investigating',
      'Ping again: action set resets the actions and investigates stopped. Loop guard: chain deeper than 3.',
    );
    const depths = async (id: string) =>
      (await runs(page, id)).map((r) => `${r.depth}:${r.status}`);
    expect(await depths(byName['Ping']!)).toEqual(['0:done']);
    expect(await depths(byName['Pong']!)).toEqual(['1:done', '3:done']);
    expect(await depths(byName['Ping again']!)).toEqual(['2:done', '4:stopped']);
    expect((await runs(page, byName['Ping again']!)).at(-1)!.detail).toBe(
      'Loop guard: chain deeper than 3',
    );
    // out of the way of the next rows
    await rest(page, `automations?id=in.(${made.map((a) => a.id).join(',')})`, {
      method: 'PATCH',
      body: { enabled: false },
    });
  });

  test('B9 · a failing webhook retries on the backoff and ends as a dead letter', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const ids = await as(page, 'maria@example.com');
    const me = (
      await rest<{ user_id: string }[]>(
        page,
        `memberships?org_id=eq.${ids.orgId}&role=eq.owner&select=user_id`,
      )
    )[0]!.user_id;
    const [hook] = await rest<{ id: string }[]>(page, 'automations?select=id', {
      method: 'POST',
      body: {
        org_id: ids.orgId,
        sheet_id: ca,
        name: 'Verifying → tell the supplier portal',
        trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_verify' },
        actions: [{ type: 'webhook', url: 'https://httpstat.us/500', preset: 'generic' }],
        created_by: me,
      },
    });
    const burrs = await ids.item('Corrective actions', 'Burrs on bracket 44-210');
    await openItem(page, ca, burrs.display_id);
    await pick(page, 'Status', 'Verifying');
    expect((await runs(page, hook!.id)).map((r) => r.status)).toEqual(['done']);
    const row = () =>
      localSql(
        `select status || '|' || attempts || '|' || (next_attempt_at > now()) from outbound_webhooks where automation_id = '${hook!.id}'`,
      ).trim();
    expect(row()).toBe('queued|0|false');
    // each failure waits longer (1, 5, 30, 120 min); time-travel to the next attempt and run the worker again
    let previousWait = 0;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      localSql(
        `update outbound_webhooks set next_attempt_at = now() where automation_id = '${hook!.id}' and status in ('queued', 'retrying')`,
      );
      const r = await request.get('/api/cron/webhooks', { headers: cronAuth() });
      expect(r.status()).toBe(200);
      if (attempt < 5) {
        expect(row()).toBe(`retrying|${attempt}|true`);
        const wait = Number(
          localSql(
            `select extract(epoch from next_attempt_at - now())::int from outbound_webhooks where automation_id = '${hook!.id}'`,
          ).trim(),
        );
        expect(wait).toBeGreaterThan(previousWait);
        previousWait = wait;
      }
    }
    expect(row()).toMatch(/^dead_letter\|5\|/);
    const notes = await rest<{ kind: string; body: string }[]>(
      page,
      `notifications?item_id=eq.${burrs.id}&kind=eq.system&select=kind,body`,
    );
    expect(notes).toEqual([
      {
        kind: 'system',
        body: expect.stringMatching(
          new RegExp(
            `^Automation "Verifying → tell the supplier portal" could not send its webhook for ${burrs.display_id} after 5 attempts: `,
          ),
        ),
      },
    ]);
  });

  test('B10 · an automation paused on one item skips that item only', async ({ page }) => {
    const ids = await as(page, 'maria@example.com');
    const stuck = auto('Stuck → notify');
    const burrs = await ids.item('Corrective actions', 'Burrs on bracket 44-210');
    const fw = await ids.item('Corrective actions', 'Shared admin account on firewall');
    const p = await openItem(page, ca, burrs.display_id);
    const toggle = p.getByRole('switch', {
      name: 'Run “Stuck → notify the owner and the compliance manager” on this item',
    });
    await expect(toggle).toBeChecked();
    const paused = nextAnswer(page);
    await toggle.click();
    await paused;
    await expect(toggle).not.toBeChecked();

    const stuckWithComment = async (text: string) => {
      await panel(page)
        .getByRole('button', { name: /^Edit Status/ })
        .click();
      await page
        .getByRole('listbox', { name: 'Status' })
        .getByRole('option', { name: 'Stuck' })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Add a comment' });
      await dialog.getByLabel('Comment').fill(text);
      const answered = nextAnswer(page);
      await dialog.getByRole('button', { name: 'Save with comment' }).click();
      await answered;
      await expect(panel(page).getByRole('button', { name: /^Edit Status: Stuck/ })).toBeVisible();
      // the panel holds the row's automations until it is finished
      await finishPanel(page);
    };
    await stuckWithComment('Waiting for the new brackets');
    expect(await runs(page, stuck, burrs.id)).toEqual([]);

    await openItem(page, ca, fw.display_id);
    await stuckWithComment('Waiting for the firewall vendor');
    expect((await runs(page, stuck, fw.id)).map((r) => r.status)).toEqual(['done']);
  });

  test('B11 · a public form submission creates an item as the form and runs form automations', async ({
    page,
    browser,
  }) => {
    const ids = await as(page, 'maria@example.com');
    const me = (
      await rest<{ user_id: string }[]>(
        page,
        `memberships?org_id=eq.${ids.orgId}&role=eq.owner&select=user_id`,
      )
    )[0]!.user_id;
    const [view] = await rest<{ id: string }[]>(page, 'views?select=id', {
      method: 'POST',
      body: {
        org_id: ids.orgId,
        sheet_id: ca,
        name: 'Report a problem',
        type: 'form',
        config: { form: { fields: [{ key: 'description' }], ...OPEN_PUBLIC_FORM } },
        position: 'b0',
      },
    });
    const [link] = await rest<{ token: string }[]>(page, 'form_links?select=token', {
      method: 'POST',
      body: { org_id: ids.orgId, sheet_id: ca, view_id: view!.id },
    });
    const [triage] = await rest<{ id: string }[]>(page, 'automations?select=id', {
      method: 'POST',
      body: {
        org_id: ids.orgId,
        sheet_id: ca,
        name: 'Form → source Incident',
        trigger: { type: 'form_submitted', formId: null },
        actions: [{ type: 'set_field', fieldKey: 'source', value: 'opt_incident' }],
        created_by: me,
      },
    });

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await visitor.goto(`/f/${link!.token}`);
    await visitor.getByLabel('Corrective action').fill('Oil on the floor near press 2');
    await visitor.getByLabel('What happened').fill('Seen by the night shift.');
    await visitor.waitForTimeout(MIN_FILL_MS);
    await visitor.getByRole('button', { name: 'Send' }).click();
    await expect(visitor.getByText('Thank you. Your answers were sent.')).toBeVisible();
    await visitorContext.close();

    const oil = await ids.item('Corrective actions', 'Oil on the floor near press 2');
    const [row] = await rest<{ group_id: string; values: Record<string, unknown> }[]>(
      page,
      `items?id=eq.${oil.id}&select=group_id,values`,
    );
    const [open] = await rest<{ id: string }[]>(
      page,
      `groups?sheet_id=eq.${ca}&name=eq.Open&select=id`,
    );
    expect(row!.group_id).toBe(open!.id);
    expect(row!.values[await ids.field('Corrective actions', 'source')]).toBe('opt_incident');
    const [created] = await rest<{ actor_kind: string }[]>(
      page,
      `activity_log?item_id=eq.${oil.id}&action=eq.item.created&select=actor_kind`,
    );
    expect(created).toEqual({ actor_kind: 'form' });
    expect((await runs(page, triage!.id)).map((r) => r.status)).toEqual(['done']);
  });

  test('B12 · an archived item leaves views and search; restoring brings it back', async ({
    page,
  }) => {
    const ids = await as(page, 'maria@example.com');
    const fw = await ids.item('Corrective actions', 'Shared admin account on firewall');
    await page.goto(`/${slug}/s/${ca}?view=table`);
    await page.getByRole('checkbox', { name: 'Select Shared admin account on firewall' }).check();
    let answered = nextAnswer(page);
    await page
      .getByRole('region', { name: 'Selected items' })
      .getByRole('button', { name: 'Actions' })
      .click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await answered;
    await expect(page.getByText('1 item archived.')).toBeVisible();
    await expect(grid(page).getByText('Shared admin account on firewall')).toHaveCount(0);
    await page.goto(`/${slug}/s/${ca}`);
    await expect(page.getByText('Guard bypassed on press 3').first()).toBeVisible();
    await expect(page.getByText('Shared admin account on firewall')).toHaveCount(0);

    const search = async (q: string) => {
      const box = page.getByRole('combobox', { name: 'Search sheets, items and people' });
      await box.fill('');
      await box.fill(q);
      await expect(page.getByLabel('Searching')).toHaveCount(0);
      await expect(
        page.getByText(/^\d+ results?$|^No sheets or items match/).first(),
      ).toBeVisible();
    };
    await search('firewall');
    await expect(page.getByText('No sheets or items match “firewall”.')).toBeVisible();

    // restore from the sheet settings
    await page.goto(`/${slug}/s/${ca}/settings`);
    answered = nextAnswer(page);
    await page.getByRole('button', { name: 'Restore Shared admin account on firewall' }).click();
    await answered;
    await expect(page.getByText(`${fw.display_id} restored.`)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Archived items' })).toHaveCount(0);
    await page.goto(`/${slug}/s/${ca}`);
    await expect(page.getByText('Shared admin account on firewall').first()).toBeVisible();
    await search('firewall');
    await expect(
      page.getByRole('listbox', { name: 'Search results' }).getByRole('option', {
        name: /Shared admin account on firewall/,
      }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    const p = await openItem(page, ca, fw.display_id);
    await p.getByRole('tab', { name: /^Activity log/ }).click();
    const log = p.getByRole('list', { name: 'Activity log' });
    await expect(log.getByRole('listitem').nth(0)).toContainText('Restored');
    await expect(log.getByRole('listitem').nth(1)).toContainText('Archived');
  });
});
