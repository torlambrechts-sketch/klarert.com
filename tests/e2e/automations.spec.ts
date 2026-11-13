import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  addAutomation,
  type Json,
  makeSheet,
  me,
  nextAnswer,
  pickStatus,
  runsOf,
  seedItems,
  STATUS,
  typeInto,
} from './automation-helpers';
import { MIN_FILL_MS, OPEN_PUBLIC_FORM, rest, signIn } from './helpers';

// M7: the automation runner (docs/04 §12, the tests that need neither the scheduler nor webhooks). Uses the seed
// (pnpm seed): maria@example.com owner, james@example.com editor of /meridian. The builder arrives in M8, so sheets
// and automations are created over REST as the signed-in person (RLS lets editors insert automations); every change
// that runs automations goes through the app.

test.describe.configure({ mode: 'default' });
test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop grid'));

test('an edit holds the row: "Editing" shows, the automation waits, Done runs it', async ({
  page,
}) => {
  await signIn(page, 'james@example.com');
  const sheet = await makeSheet(page, `Hold ${randomUUID().slice(0, 6)}`, [
    { key: 'status', name: 'Status', type: 'status', config: STATUS },
    { key: 'note', name: 'Note', type: 'text' },
  ]);
  const post = await addAutomation(page, sheet, {
    name: 'Post on done',
    trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_done' },
    actions: [{ type: 'post_update', message: 'Finished: {name}' }],
  });
  await seedItems(page, sheet, [{ name: 'Held pump' }, { name: 'Other pump' }]);
  await page.goto(sheet.url);

  await pickStatus(page, sheet, 'Held pump', 'Done', { finish: false });
  const row = page
    .getByRole('grid')
    .getByRole('row')
    .filter({ has: page.getByRole('gridcell', { name: 'Held pump', exact: false }) });
  await expect(row.getByText('Editing', { exact: true })).toBeVisible();
  await expect(sheet.cell(page, 'Held pump', 'Status')).toContainText('Done');
  expect(await runsOf(page, post)).toEqual([]);

  const answered = nextAnswer(page);
  await row.getByRole('button', { name: 'Done', exact: true }).click();
  await answered;
  await expect(page.getByText(/^Post on done: Post an update$/)).toBeVisible();
  await expect(row.getByText('Editing', { exact: true })).toHaveCount(0);
  expect((await runsOf(page, post)).map((r) => [r.status, r.depth])).toEqual([['done', 0]]);
});

test('Done is blocked by a status rule, then closes out: the automation dates and locks the item', async ({
  page,
}) => {
  await signIn(page, 'james@example.com');
  const sheet = await makeSheet(page, `Close-out ${randomUUID().slice(0, 6)}`, [
    {
      key: 'status',
      name: 'Status',
      type: 'status',
      config: STATUS,
      rules: [
        {
          id: 'r1',
          whenFieldKey: 'status',
          whenValues: ['opt_done'],
          require: ['root_cause'],
          message: 'Add the root cause first.',
        },
      ],
    },
    { key: 'root_cause', name: 'Root cause', type: 'text' },
    { key: 'closed_on', name: 'Closed on', type: 'date', config: { relative: false } },
  ]);
  const closeOut = await addAutomation(page, sheet, {
    name: 'Close out',
    trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_done' },
    actions: [
      { type: 'lock_item', reason: 'Approved' },
      { type: 'set_field', fieldKey: 'closed_on', value: '$today' },
    ],
  });
  const items = await seedItems(page, sheet, [{ name: 'Leaking valve' }]);
  await page.goto(sheet.url);

  // the rule blocks; nothing runs
  await pickStatus(page, sheet, 'Leaking valve', 'Done');
  await expect(page.getByText('Add the root cause first.')).toBeVisible();
  await expect(sheet.cell(page, 'Leaking valve', 'Status')).not.toContainText('Done');
  expect(await runsOf(page, closeOut)).toEqual([]);

  // with the root cause, Done saves and field_becomes fires: locked first, then dated (automations may write locked items)
  await typeInto(page, sheet, 'Leaking valve', 'Root cause', 'Worn seal');
  await pickStatus(page, sheet, 'Leaking valve', 'Done');
  await expect(
    page.getByText(/^Close out: Lock the item: Approved · Set Closed on to \d{1,2} \w{3} \d{4}$/),
  ).toBeVisible();
  await expect(page.getByRole('grid').getByText('Locked: Approved')).toBeAttached();
  await expect(sheet.cell(page, 'Leaking valve', 'Closed on')).toContainText(/\d/);
  expect((await runsOf(page, closeOut)).map((r) => [r.status, r.depth])).toEqual([['done', 0]]);

  // the editor can no longer change it
  await sheet.cell(page, 'Leaking valve', 'Root cause').click();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('This item is locked: Approved. Only owners and admins can change it.'),
  ).toBeVisible();

  // the activity log names the right actor for each change
  const log = await rest<
    { action: string; actor_kind: string; actor_id: string; field_id: string }[]
  >(
    page,
    `activity_log?item_id=eq.${items['Leaking valve']}&select=action,actor_kind,actor_id,field_id&order=id`,
  );
  const james = await me(page);
  expect(log.map((l) => [l.action, l.field_id, l.actor_kind, l.actor_id])).toEqual([
    ['item.created', null, 'user', james],
    ['value.changed', sheet.field('root_cause'), 'user', james],
    ['value.changed', sheet.field('status'), 'user', james],
    ['item.locked', null, 'automation', closeOut],
    ['value.changed', sheet.field('closed_on'), 'automation', closeOut],
  ]);
});

test('number_above on a formula fires once per crossing; assign notifies the person', async ({
  page,
}) => {
  await signIn(page, 'james@example.com');
  const sheet = await makeSheet(page, `Risks ${randomUUID().slice(0, 6)}`, [
    { key: 'likelihood', name: 'Likelihood', type: 'number', config: { unit: '', decimals: 0 } },
    { key: 'impact', name: 'Impact', type: 'number', config: { unit: '', decimals: 0 } },
    {
      key: 'residual',
      name: 'Residual',
      type: 'formula',
      config: { expr: '{likelihood} * {impact}', result: 'number' },
    },
    { key: 'owner', name: 'Owner', type: 'people', config: { multiple: true } },
  ]);
  const high = await addAutomation(page, sheet, {
    name: 'High risk',
    trigger: { type: 'number_above', fieldKey: 'residual', threshold: 12 },
    actions: [
      { type: 'assign', fieldKey: 'owner', who: 'actor' },
      { type: 'post_update', message: 'Residual is {residual}, owned by {owner}' },
    ],
  });
  const items = await seedItems(page, sheet, [
    { name: 'Press 3', values: { [sheet.field('likelihood')]: 3, [sheet.field('impact')]: 3 } },
  ]);
  const item = items['Press 3']!;
  await page.goto(sheet.url);

  await typeInto(page, sheet, 'Press 3', 'Impact', '5'); // 9 → 15: fires
  await expect(page.getByText(/^High risk: Assign .+ to Owner · Post an update$/)).toBeVisible();
  await expect(sheet.cell(page, 'Press 3', 'Owner')).not.toBeEmpty();
  expect(await runsOf(page, high)).toHaveLength(1);

  await typeInto(page, sheet, 'Press 3', 'Likelihood', '4'); // 15 → 20: still above
  expect(await runsOf(page, high)).toHaveLength(1);
  await typeInto(page, sheet, 'Press 3', 'Likelihood', '2'); // 20 → 10: below again
  expect(await runsOf(page, high)).toHaveLength(1);
  await typeInto(page, sheet, 'Press 3', 'Impact', '8'); // 10 → 16: fires again
  const runs = await runsOf(page, high);
  expect(runs.map((r) => r.status)).toEqual(['done', 'done']);
  // the second time the person is already assigned
  expect(runs[1]!.steps.map((s) => s.outcome)).toEqual(['no_change', 'done']);

  // assign notified the person once; the posts are automation updates on the item
  const notes = await rest<{ kind: string; body: string }[]>(
    page,
    `notifications?item_id=eq.${item}&select=kind,body`,
  );
  expect(notes).toHaveLength(1);
  expect(notes[0]!.kind).toBe('notify');
  expect(notes[0]!.body).toMatch(/assigned you to .+-001 Press 3 \(Owner\)\.$/);
  const posts = await rest<{ kind: string; body: string; author_id: string | null }[]>(
    page,
    `item_updates?item_id=eq.${item}&select=kind,body,author_id&order=created_at`,
  );
  expect(posts.map((p) => [p.kind, p.author_id, p.body.replace(/, owned by .*/, '')])).toEqual([
    ['automation', null, 'Residual is 15'],
    ['automation', null, 'Residual is 16'],
  ]);
});

test('create_item links back and copies the owner; a three-sheet ping-pong stops at depth 3', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, 'maria@example.com');
  const tag = randomUUID().slice(0, 6);
  const owner = { key: 'owner', name: 'Owner', type: 'people', config: { multiple: true } };
  const a = await makeSheet(page, `Ping A ${tag}`, [
    owner,
    { key: 'start', name: 'Start', type: 'button', config: { label: 'Start', confirm: null } },
  ]);
  const b = await makeSheet(page, `Ping B ${tag}`, [
    owner,
    {
      key: 'source',
      name: 'Source',
      type: 'link',
      config: { targetSheetId: a.id, multiple: true, inverseFieldId: null },
    },
  ]);
  const c = await makeSheet(page, `Ping C ${tag}`, [
    owner,
    {
      key: 'source',
      name: 'Source',
      type: 'link',
      config: { targetSheetId: b.id, multiple: true, inverseFieldId: null },
    },
  ]);
  const create = (sheetId: string) => ({
    type: 'create_item',
    sheetId,
    groupId: null,
    name: 'From {id}',
    values: {},
    link: true,
  });
  const start = await addAutomation(page, a, {
    name: 'Start ping',
    trigger: { type: 'button_clicked', fieldKey: 'start' },
    actions: [create(b.id)],
  });
  const aCreated = await addAutomation(page, a, {
    name: 'A to B',
    trigger: { type: 'item_created' },
    actions: [create(b.id)],
  });
  const bCreated = await addAutomation(page, b, {
    name: 'B to C',
    trigger: { type: 'item_created' },
    actions: [create(c.id)],
  });
  const cCreated = await addAutomation(page, c, {
    name: 'C to A',
    trigger: { type: 'item_created' },
    actions: [create(a.id)],
  });
  const maria = await me(page);
  const items = await seedItems(page, a, [
    { name: 'Origin', values: { [a.field('owner')]: [maria] } },
  ]);
  await page.goto(a.url);

  await a.cell(page, 'Origin', 'Start').click();
  await page.keyboard.press('Enter');
  const answered = nextAnswer(page);
  await page.getByRole('group', { name: 'Start' }).getByRole('button', { name: 'Start' }).click();
  await answered;
  await expect(page.getByText('B to C stopped. Loop guard: chain deeper than 3.')).toBeVisible();

  // depth 0 → 3 ran, the event at depth 4 was stopped
  const depths = async (id: string) =>
    (await runsOf(page, id)).map((r) => `${r.depth}:${r.status}`);
  expect(await depths(start)).toEqual(['0:done']);
  expect(await depths(bCreated)).toEqual(['1:done', '4:stopped']);
  expect(await depths(cCreated)).toEqual(['2:done']);
  expect(await depths(aCreated)).toEqual(['3:done']);
  expect((await runsOf(page, bCreated))[1]!.detail).toBe('Loop guard: chain deeper than 3');

  // the B item links back to the origin (B's link field points at A) and carries its owner
  const [first] = await rest<{ id: string; name: string; values: Record<string, Json> }[]>(
    page,
    `items?sheet_id=eq.${b.id}&select=id,name,values&order=seq&limit=1`,
  );
  expect(first!.name).toBe(`From ${a.idPrefix}001`);
  expect(first!.values[b.field('owner')]).toEqual([maria]);
  const links = await rest<{ to_item: string }[]>(
    page,
    `item_links?from_item=eq.${first!.id}&field_id=eq.${b.field('source')}&select=to_item`,
  );
  expect(links).toEqual([{ to_item: items['Origin'] }]);
  // created by the automation, as the activity log says
  const [created] = await rest<{ actor_kind: string; actor_id: string }[]>(
    page,
    `activity_log?item_id=eq.${first!.id}&action=eq.item.created&select=actor_kind,actor_id`,
  );
  expect(created).toEqual({ actor_kind: 'automation', actor_id: start });
});

test('a button runs its steps with a spinner; a paused automation skips that item only', async ({
  page,
}) => {
  await signIn(page, 'james@example.com');
  const sheet = await makeSheet(page, `Approvals ${randomUUID().slice(0, 6)}`, [
    { key: 'status', name: 'Status', type: 'status', config: STATUS },
    {
      key: 'approve',
      name: 'Approve',
      type: 'button',
      config: { label: 'Approve', confirm: null },
    },
  ]);
  const approve = await addAutomation(page, sheet, {
    name: 'Approve policy',
    trigger: { type: 'button_clicked', fieldKey: 'approve' },
    actions: [
      { type: 'set_field', fieldKey: 'status', value: 'opt_done' },
      { type: 'post_update', message: 'Approved by {actor}' },
    ],
  });
  const items = await seedItems(page, sheet, [{ name: 'Policy A' }, { name: 'Policy B' }]);
  await rest(page, 'automation_pauses', {
    method: 'POST',
    body: { automation_id: approve, item_id: items['Policy B'], org_id: sheet.orgId },
  });
  await page.goto(sheet.url);

  // hold the server's answer until the spinner has been seen
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.headers()['next-action']) await gate;
    await route.continue();
  });
  const cellA = sheet.cell(page, 'Policy A', 'Approve');
  await cellA.click();
  await page.keyboard.press('Enter');
  await page
    .getByRole('group', { name: 'Approve' })
    .getByRole('button', { name: 'Approve' })
    .click();
  await expect(cellA.locator('[aria-busy="true"]')).toBeVisible();
  await expect(cellA.getByText('Running')).toBeAttached();
  release();
  await expect(page.getByText('Approve policy: Set Status to Done · Post an update')).toBeVisible();
  await expect(cellA.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(sheet.cell(page, 'Policy A', 'Status')).toContainText('Done');
  await page.unroute('**/*');

  // paused for Policy B: nothing runs there
  const cellB = sheet.cell(page, 'Policy B', 'Approve');
  await cellB.click();
  await page.keyboard.press('Enter');
  const answered = nextAnswer(page);
  await page
    .getByRole('group', { name: 'Approve' })
    .getByRole('button', { name: 'Approve' })
    .click();
  await answered;
  await expect(
    page.getByText(
      'Nothing ran: the automations of this button are paused for this item or their conditions are not met.',
    ),
  ).toBeVisible();
  await expect(sheet.cell(page, 'Policy B', 'Status')).not.toContainText('Done');
  const runs = await rest<{ item_id: string }[]>(
    page,
    `automation_runs?automation_id=eq.${approve}&select=item_id`,
  );
  expect(runs).toEqual([{ item_id: items['Policy A'] }]);
  const [post] = await rest<{ body: string; kind: string }[]>(
    page,
    `item_updates?item_id=eq.${items['Policy A']}&select=body,kind`,
  );
  expect(post).toEqual({ body: 'Approved by James Okafor', kind: 'automation' });
});

test('a public form submission runs form_submitted automations', async ({ page, browser }) => {
  await signIn(page, 'maria@example.com');
  const sheet = await makeSheet(
    page,
    `Hazards ${randomUUID().slice(0, 6)}`,
    [
      { key: 'where_seen', name: 'Where seen', type: 'text' },
      { key: 'status', name: 'Status', type: 'status', config: STATUS },
    ],
    'Report',
  );
  const [view] = await rest<{ id: string }[]>(page, 'views?select=id', {
    method: 'POST',
    body: {
      org_id: sheet.orgId,
      sheet_id: sheet.id,
      name: 'Report a hazard',
      type: 'form',
      config: { form: { fields: [{ key: 'where_seen' }], ...OPEN_PUBLIC_FORM } },
      position: 'a5',
    },
  });
  const [link] = await rest<{ token: string }[]>(page, 'form_links?select=token', {
    method: 'POST',
    body: { org_id: sheet.orgId, sheet_id: sheet.id, view_id: view!.id },
  });
  const maria = await me(page);
  const triage = await addAutomation(page, sheet, {
    name: 'Triage',
    trigger: { type: 'form_submitted', formId: null },
    actions: [
      { type: 'set_field', fieldKey: 'status', value: 'opt_wip' },
      { type: 'post_update', message: 'Reported at {where_seen} by {actor}' },
      { type: 'notify', to: [`user:${maria}`], message: 'New hazard {id}: {name}' },
    ],
  });

  const ctx = await browser.newContext();
  const visitor = await ctx.newPage();
  await visitor.goto(`/f/${link!.token}`);
  await visitor.getByLabel('Report').fill('Oil on the stairs');
  await visitor.getByLabel('Where seen').fill('Line 2');
  await visitor.waitForTimeout(MIN_FILL_MS);
  await visitor.getByRole('button', { name: 'Send' }).click();
  await expect(visitor.getByText('Thank you. Your answers were sent.')).toBeVisible();
  await ctx.close();

  // the runner finished before the visitor saw the answer
  const [item] = await rest<{ id: string; display_id: string; values: Record<string, Json> }[]>(
    page,
    `items?sheet_id=eq.${sheet.id}&select=id,display_id,values`,
  );
  expect(item!.values[sheet.field('status')]).toBe('opt_wip');
  const runs = await rest<{ status: string; event: { type: string } }[]>(
    page,
    `automation_runs?automation_id=eq.${triage}&select=status,event`,
  );
  expect(runs.map((r) => [r.status, r.event.type])).toEqual([['done', 'form.submitted']]);
  const updates = await rest<{ kind: string; body: string }[]>(
    page,
    `item_updates?item_id=eq.${item!.id}&select=kind,body&order=created_at`,
  );
  expect(updates.map((u) => [u.kind, u.body])).toEqual([
    ['automation', 'Reported at Line 2 by A form'],
    ['automation', `Notified Maria Pereira: New hazard ${item!.display_id}: Oil on the stairs`],
  ]);
  const notes = await rest<{ kind: string; body: string }[]>(
    page,
    `notifications?item_id=eq.${item!.id}&select=kind,body`,
  );
  expect(notes).toEqual([
    { kind: 'notify', body: `New hazard ${item!.display_id}: Oil on the stairs` },
  ]);
  const [log] = await rest<{ actor_kind: string }[]>(
    page,
    `activity_log?item_id=eq.${item!.id}&action=eq.value.changed&select=actor_kind`,
  );
  expect(log).toEqual({ actor_kind: 'automation' });
});
