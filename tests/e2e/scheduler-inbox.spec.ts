import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  addAutomation,
  type FieldSpec,
  makeSheet,
  me,
  pickStatus,
  runsOf,
  seedItems,
  STATUS,
  typeInto,
} from './automation-helpers';
import { completeProfile, freshEmail, rest, signIn } from './helpers';

// M9: the scheduler and webhook cron routes, "Run date checks now", the inbox, requests, My work, Home and global
// search (docs/04 §8–§9, docs/05 §2.3, §4, §5). Seeded people work in /meridian, where other tests run in parallel, so
// tests that count things (inbox, My work, Home, search) use a fresh person with a fresh workspace.

function cronSecret(): string {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
  const line = readFileSync('.env.local', 'utf8')
    .split('\n')
    .find((l) => l.startsWith('CRON_SECRET='));
  return (line ?? '').slice('CRON_SECRET='.length).trim().replace(/^"|"$/g, '');
}

const auth = () => ({ Authorization: `Bearer ${cronSecret()}` });

/** ISO date `days` from today (UTC). */
const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const FIELDS: FieldSpec[] = [
  { key: 'status', name: 'Status', type: 'status', config: STATUS },
  { key: 'owner', name: 'Owner', type: 'people', config: { multiple: true } },
  { key: 'due', name: 'Due date', type: 'date', config: { relative: false } },
  { key: 'note', name: 'Note', type: 'text' },
];

/** A new person with a new workspace they own: nothing else runs there. */
async function freshWorkspace(page: Page, person: string) {
  const slug = `m9-${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`;
  await signIn(page, freshEmail('m9'));
  await completeProfile(page, person);
  await expect(page.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();
  await page.getByLabel('Workspace name').fill(`Workspace ${slug}`);
  await page.getByLabel('Web address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/home$`));
  return slug;
}

/** The shell is hydrated: the inbox has loaded on the client (links now navigate client-side). */
async function hydrated(page: Page) {
  await expect(page.locator('[data-testid="inbox-button"][data-state-loaded]')).toBeVisible();
}

/** Wait until a popover has gone (it stays the top layer during its exit animation). */
async function closePopover(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-radix-popper-content-wrapper]')).toHaveCount(0);
}

test.describe('cron routes', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'no UI'));

  test('refuse a missing or wrong secret', async ({ request }) => {
    for (const path of ['/api/cron/scheduler', '/api/cron/webhooks']) {
      expect((await request.get(path)).status()).toBe(401);
      expect(
        (
          await request.get(path, { headers: { Authorization: 'Bearer not-the-secret-at-all' } })
        ).status(),
      ).toBe(401);
      expect((await request.get(path, { headers: { Authorization: cronSecret() } })).status()).toBe(
        401,
      );
      const ok = await request.get(path, { headers: auth() });
      expect(ok.status()).toBe(200);
      expect(await ok.json()).toMatchObject({ ok: true });
    }
  });
});

test.describe('scheduler', () => {
  test.describe.configure({ mode: 'default' });
  test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop'));

  test('a date_arrives automation fires once per occurrence when the cron route runs twice', async ({
    page,
    request,
  }) => {
    await signIn(page, 'james@example.com');
    const sheet = await makeSheet(page, `Permits ${randomUUID().slice(0, 6)}`, FIELDS);
    // a month before the date (one day more, so the moment has passed in any workspace time zone)
    const auto = await addAutomation(page, sheet, {
      name: 'A month before',
      trigger: { type: 'date_arrives', fieldKey: 'due', offsetDays: -31 },
      actions: [{ type: 'post_update', message: 'Due on {due}: {name}' }],
    });
    const items = await seedItems(page, sheet, [
      { name: 'Renew permit', values: { [sheet.field('due')]: day(30) } },
      { name: 'Far away', values: { [sheet.field('due')]: day(90) } },
      { name: 'Long gone', values: { [sheet.field('due')]: day(10) } }, // moment 3 weeks ago: history
      { name: 'No date' },
    ]);

    for (let i = 0; i < 2; i += 1) {
      const r = await request.get('/api/cron/scheduler', { headers: auth() });
      expect(r.status()).toBe(200);
    }
    const runs = await rest<{ item_id: string; status: string }[]>(
      page,
      `automation_runs?automation_id=eq.${auto}&select=item_id,status,event`,
    );
    expect(runs.map((r) => [r.item_id, r.status])).toEqual([[items['Renew permit'], 'done']]);
    const posts = await rest<{ body: string; kind: string }[]>(
      page,
      `item_updates?item_id=eq.${items['Renew permit']}&select=body,kind`,
    );
    expect(posts).toEqual([{ kind: 'automation', body: expect.stringContaining('Renew permit') }]);

    // a changed date is a new occurrence: it fires again, once
    await rest(page, 'rpc/set_item_values', {
      method: 'POST',
      body: { p_item: items['Renew permit'], p_patch: { [sheet.field('due')]: day(29) } },
    });
    await request.get('/api/cron/scheduler', { headers: auth() });
    await request.get('/api/cron/scheduler', { headers: auth() });
    expect(await runsOf(page, auto)).toHaveLength(2);

    // editors do not get "Run date checks now"
    await page.goto(`/meridian/automations?sheet=${sheet.id}`);
    await expect(page.getByRole('heading', { name: 'Automations', level: 1 })).toBeVisible();
    // the automation in the list (its runs below name it too)
    await expect(
      page.getByRole('list', { name: 'Automations' }).getByText('A month before'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run date checks now' })).toHaveCount(0);
  });

  test('admins run date checks now from the Automations page; a webhook to a private address is refused and retried', async ({
    page,
    request,
  }) => {
    await signIn(page, 'maria@example.com');
    const sheet = await makeSheet(page, `Reviews ${randomUUID().slice(0, 6)}`, FIELDS);
    const auto = await addAutomation(page, sheet, {
      name: 'Review is near',
      trigger: { type: 'date_arrives', fieldKey: 'due', offsetDays: -31 },
      actions: [
        { type: 'set_field', fieldKey: 'note', value: 'Review is near' },
        { type: 'webhook', url: 'https://127.0.0.1/hook', preset: 'generic' },
      ],
    });
    const items = await seedItems(page, sheet, [
      { name: 'Annual review', values: { [sheet.field('due')]: day(30) } },
    ]);

    await page.goto(`/meridian/automations?sheet=${sheet.id}`);
    await hydrated(page);
    const button = page.getByRole('button', { name: 'Run date checks now' });
    await button.click();
    await expect(page.getByText(/^Date checks ran\./).first()).toBeVisible();
    await expect(button).toBeEnabled();
    const runs = await runsOf(page, auto);
    expect(runs.map((r) => [r.status, r.steps.map((s) => s.outcome)])).toEqual([
      ['done', ['done', 'done']],
    ]);
    const [row] = await rest<{ values: Record<string, unknown> }[]>(
      page,
      `items?id=eq.${items['Annual review']}&select=values`,
    );
    expect(row!.values[sheet.field('note')]).toBe('Review is near');

    // pressing it again fires nothing new
    await button.click();
    await expect(button).toBeEnabled();
    await expect.poll(async () => (await runsOf(page, auto)).length).toBe(1);

    // the queued webhook goes to a loopback address: the worker refuses it and schedules a retry
    const worker = await request.get('/api/cron/webhooks', { headers: auth() });
    expect(worker.status()).toBe(200);
    const summary = (await worker.json()) as { claimed: number; sent: number; retrying: number };
    expect(summary.claimed).toBeGreaterThanOrEqual(1);
    expect(summary.retrying).toBeGreaterThanOrEqual(1);
  });
});

test.describe('inbox, requests and My work', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop grid'));

  test('an assign automation lands in the inbox; requests are done once the person changes the item; My work buckets', async ({
    page,
  }) => {
    test.slow();
    const slug = await freshWorkspace(page, 'Robin Inbox');
    const sheet = await makeSheet(page, 'Audit actions', FIELDS, 'Action', slug);
    const myId = await me(page);
    await addAutomation(page, sheet, {
      name: 'Assign on start',
      trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_wip' },
      actions: [{ type: 'assign', fieldKey: 'owner', who: `user:${myId}` }],
    });
    await addAutomation(page, sheet, {
      name: 'Ask when stuck',
      trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_stuck' },
      actions: [{ type: 'request_update', fieldKey: 'owner', message: 'Please update {name}.' }],
    });
    const f = sheet.field;
    await seedItems(page, sheet, [
      { name: 'Overdue audit', values: { [f('owner')]: [myId], [f('due')]: day(-3) } },
      { name: 'Soon audit', values: { [f('owner')]: [myId], [f('due')]: day(5) } },
      { name: 'Later audit', values: { [f('owner')]: [myId], [f('due')]: day(60) } },
      { name: 'Nobody', values: { [f('due')]: day(-1) } },
      { name: 'Assign me' },
      { name: 'Ask me', values: { [f('owner')]: [myId] } },
    ]);
    await page.goto(sheet.url);
    const inbox = page.getByTestId('inbox-button');
    await expect(inbox).toHaveAccessibleName('Inbox');

    // assign → a notification arrives (realtime) and the count shows
    await pickStatus(page, sheet, 'Assign me', 'Working on it');
    // realtime, or the 30 s poll when the local realtime connection drops events
    await expect(inbox).toHaveAccessibleName('Inbox 1 unread', { timeout: 40_000 });
    await expect(page.getByTestId('inbox-count')).toHaveText('1');
    await inbox.click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByText(/Robin Inbox assigned you to [A-Z]+-\d+ Assign me \(Owner\)\./),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Mark read' }).click();
    await expect(inbox).toHaveAccessibleName('Inbox');
    await expect(page.getByTestId('inbox-count')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Mark read' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
    await closePopover(page);

    // stuck → a request to the owner (me)
    await pickStatus(page, sheet, 'Ask me', 'Stuck');
    await expect(inbox).toHaveAccessibleName('Inbox 1 unread', { timeout: 40_000 });

    // My work: tiles, rows and the rail badge (overdue 1 + open requests 1)
    await page.goto(`/${slug}/my-work`);
    await expect(page.getByTestId('kpi-overdue')).toContainText('1');
    await expect(page.getByTestId('kpi-due')).toContainText('1');
    await expect(page.getByTestId('kpi-requests')).toContainText('1');
    await expect(page.getByTestId('kpi-assigned')).toContainText('5');
    const railMyWork = page
      .getByRole('navigation', { name: 'Side menu' })
      .getByRole('link', { name: /My work/ });
    await expect(railMyWork).toHaveAccessibleName(/2 waiting/);
    const overdue = page.getByRole('list', { name: 'Overdue' });
    await expect(overdue.getByTestId('work-row')).toHaveCount(1);
    await expect(overdue).toContainText('Overdue audit');
    await expect(overdue).toContainText('3 days overdue');
    await expect(page.getByRole('list', { name: 'Due in 14 days' })).toContainText('Soon audit');
    await expect(page.getByRole('list', { name: 'Requests to me' })).toContainText('Ask me');
    await expect(page.getByText('Nobody')).toHaveCount(0);
    await hydrated(page);
    await page.getByTestId('kpi-requests').click();
    await expect(page).toHaveURL(/filter=requests/);
    await expect(page.getByTestId('work-row')).toHaveCount(1);
    await expect(page.getByTestId('work-row')).toContainText('Update requested');
    // the second panel filters with counts
    const panel = page.getByRole('navigation', { name: 'Filter my work' });
    await expect(panel.getByRole('link', { name: 'Everything 5' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Requests to me 1' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // the requested person changes the item → the request is done
    await page.goto(sheet.url);
    await typeInto(page, sheet, 'Ask me', 'Note', 'Waiting for the supplier');
    const requests = await rest<{ done_at: string | null }[]>(
      page,
      `notifications?kind=eq.request&select=done_at`,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]!.done_at).not.toBeNull();
    await page.goto(`/${slug}/my-work`);
    await expect(page.getByTestId('kpi-requests')).toContainText('0');
    await expect(railMyWork).toHaveAccessibleName(/1 waiting/);
  });
});

test.describe('Home and search', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop'));

  test('Home numbers come from the data; search finds a sheet, an item by id and by person', async ({
    page,
  }) => {
    test.slow();
    const person = `Sasha Q${randomUUID().slice(0, 5)}`;
    const slug = await freshWorkspace(page, person);

    // an empty workspace: the checklist, nothing needs you
    await expect(page.getByTestId('home-summary')).toHaveText('Nothing needs you right now');
    const checklist = page.getByTestId('checklist');
    await expect(page.getByText('0 of 6 done.')).toBeVisible();
    await expect(checklist.getByRole('link', { name: 'New sheet' })).toBeVisible();
    await expect(page.getByText('No activity yet. Changes to items show here.')).toBeVisible();

    const sheet = await makeSheet(
      page,
      `Suppliers ${randomUUID().slice(0, 5)}`,
      FIELDS,
      'Supplier',
      slug,
    );
    const myId = await me(page);
    const f = sheet.field;
    await seedItems(page, sheet, [
      { name: 'Acme audit', values: { [f('owner')]: [myId], [f('due')]: day(-2) } },
      { name: 'Bolt review', values: { [f('owner')]: [myId], [f('due')]: day(3) } },
      { name: 'Cobalt check', values: { [f('due')]: day(4) } },
      { name: 'Delta visit' },
      { name: 'Echo survey' },
    ]);
    await addAutomation(page, sheet, {
      name: 'Notify on done',
      trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_done' },
      actions: [{ type: 'post_update', message: 'Done' }],
    });
    await page.reload();
    const due = new Date(`${day(3)}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
    await expect(page.getByTestId('home-summary')).toHaveText(`2 items need you · next due ${due}`);
    await expect(page.getByText('4 of 6 done.')).toBeVisible();
    await expect(checklist.getByRole('link', { name: 'Invite' })).toBeVisible();
    await expect(checklist.getByRole('link', { name: 'Open an item' })).toBeVisible();
    const needs = page.getByRole('list', { name: 'Needs you' });
    await expect(needs.getByTestId('work-row')).toHaveCount(2);
    await expect(needs.getByTestId('work-row').first()).toContainText('Acme audit');
    await expect(
      page.getByRole('list', { name: 'Next 30 days' }).getByTestId('work-row'),
    ).toHaveCount(1);
    await expect(page.getByRole('list', { name: 'Recent activity' })).toContainText('Echo survey');

    // opening an item's activity log ticks its step
    await hydrated(page);
    await checklist.getByRole('link', { name: 'Open an item' }).click();
    await page.getByRole('tab', { name: /Activity log/ }).click();
    await expect(page.getByRole('list', { name: 'Activity log' })).toBeVisible();
    await expect
      .poll(async () => {
        await page.goto(`/${slug}/home`);
        return page.getByText('5 of 6 done.').count();
      })
      .toBe(1);

    // search: "/" focuses; a sheet by name
    const box = page.getByRole('combobox', { name: 'Search sheets, items and people' });
    await hydrated(page);
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('/');
    await expect(box).toBeFocused();
    await box.fill('suppliers');
    const results = page.getByRole('listbox', { name: 'Search results' });
    await expect(results.getByRole('option', { name: /Suppliers/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/${slug}/s/${sheet.id}$`));

    // an item by display id
    await page.locator('body').press('/');
    await box.fill(`${sheet.idPrefix}002`);
    await expect(results.getByRole('option').first()).toContainText('Bolt review');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/${slug}/s/${sheet.id}\\?item=${sheet.idPrefix}002`));
    await expect(page.getByRole('dialog')).toContainText('Bolt review');
    await page.keyboard.press('Escape');

    // items by person; arrows move; Esc closes
    await page.goto(`/${slug}/home`);
    await hydrated(page);
    await page.locator('body').press('/');
    await box.fill(person.split(' ')[1]!);
    await expect(results.getByRole('option')).toHaveCount(2);
    await expect(results.getByRole('option').first()).toContainText(person);
    await page.keyboard.press('ArrowDown');
    await expect(results.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(results).toHaveCount(0);
  });
});

test.describe('phone', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'phone layout'));

  test('search expands to the full width of the top bar', async ({ page }) => {
    await signIn(page, 'vic@example.com');
    await page.goto('/meridian/home');
    await hydrated(page);
    await page
      .getByRole('navigation', { name: 'Bottom bar' })
      .getByRole('button', { name: 'Search' })
      .click();
    const box = page.getByRole('combobox', { name: 'Search sheets, items and people' });
    await expect(box).toBeFocused();
    const form = page.getByRole('search');
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    const rect = await form.boundingBox();
    expect(rect?.x).toBe(0);
    expect(rect?.width).toBe(390);
    await box.fill('zzzz-no-such-thing');
    await expect(page.getByText('No sheets or items match “zzzz-no-such-thing”.')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    expect((await form.boundingBox())!.width).toBeLessThan(390);
  });
});
