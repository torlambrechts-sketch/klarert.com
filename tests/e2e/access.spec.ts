import { expect, test, type Browser, type Page } from '@playwright/test';
import { idsOf, isoIn, localSql, seedWorkspace } from './first-sheet-helpers';
import { rest, signIn, openTab } from './helpers';

// P2 · Access control (docs/02 §16): restrict a sheet and list people with a level, the admin who is not listed sees
// only the name, a commenter comments but does not edit, an auditor reads until the end date, and a restricted field
// stays hidden from a viewer in the Table, the panel, lookups, search and Insights, while the owner always sees.
// Each test seeds its own workspace: Maria Pereira (owner), James Okafor and Tom Kirby (editors), Vic Viewer.

const CA_ITEM = 'Burrs on bracket 44-210';

async function as(browser: Browser, email: string, next: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email, next);
  return page;
}

async function restError(page: Page, path: string, body: unknown): Promise<string> {
  try {
    await rest(page, path, { method: 'POST', body });
    return 'ok';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

test.describe('access control', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop walkthrough'));

  test('restrict a sheet: the commenter comments, the editor not listed sees nothing, the admin sees the name', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const slug = seedWorkspace('acc');
    await signIn(page, 'maria@example.com', `/${slug}/home`);
    const ids = await idsOf(page, slug);
    const ca = ids.sheets['Corrective actions']!;
    const burrs = await ids.item('Corrective actions', CA_ITEM);

    // ── the owner restricts the sheet from its Access panel and lists people
    await page.goto(`/${slug}/s/${ca}`);
    await page.getByRole('button', { name: 'Access', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Access to Corrective actions' });
    await expect(dialog.getByText('Open.', { exact: false }).first()).toBeVisible();
    await dialog.getByRole('radio', { name: /Only people I choose/ }).check();
    await expect(page.getByText('Sheet restricted. Choose who can see it.')).toBeVisible();
    await expect(dialog.getByRole('status')).toContainText('Restricted.');
    await dialog.getByLabel('Access for Tom Kirby').selectOption('commenter');
    await expect(page.getByText('Tom Kirby: can comment.')).toBeVisible();
    await dialog.getByLabel('Access for Vic Viewer').selectOption('viewer');
    await expect(page.getByText('Vic Viewer: can view.')).toBeVisible();
    // a viewer can only ever view: the list offers nothing more
    await expect(dialog.getByLabel('Access for Vic Viewer').locator('option')).toHaveText([
      'No access',
      'Can view',
    ]);
    await dialog.getByLabel('Access for Vic Viewer').selectOption('');
    await expect(page.getByText('Vic Viewer no longer has access.')).toBeVisible();
    // grants and revokes are in the log
    const log = dialog.getByTestId('access-log');
    await expect(log).toContainText('Restricted the sheet to the people listed');
    await expect(log).toContainText('Tom Kirby can comment');
    await expect(log).toContainText('Vic Viewer no longer has access');
    await page.keyboard.press('Escape');
    await expect(page.getByText('Restricted').first()).toBeVisible();

    // James becomes an admin, but is not on the list
    await rest(
      page,
      `memberships?org_id=eq.${ids.orgId}&user_id=eq.${await userId(page, ids.orgId, 'James Okafor')}`,
      {
        method: 'PATCH',
        body: { role: 'admin' },
      },
    );

    // ── the admin not listed: the name in the menu, marked Restricted; nothing of the content
    const james = await as(browser, 'james@example.com', `/${slug}/home`);
    await expect(
      james.getByLabel('Corrective actions, restricted: you do not have access').first(),
    ).toBeVisible();
    await james.goto(`/${slug}/s/${ca}`);
    await expect(james.getByRole('heading', { name: 'Corrective actions' })).toBeVisible();
    await expect(james.getByText('This sheet is restricted.')).toBeVisible();
    await expect(james.getByText(CA_ITEM)).toHaveCount(0);
    expect(await rest(james, `items?sheet_id=eq.${ca}&select=id`)).toEqual([]);
    expect(await rest(james, `item_updates?item_id=eq.${burrs.id}&select=id`)).toEqual([]);
    expect(await rest(james, `activity_log?item_id=eq.${burrs.id}&select=id`)).toEqual([]);
    expect(
      await restError(james, 'rpc/set_access_grant', {
        p_kind: 'sheet',
        p_target: ca,
        p_user: await userId(page, ids.orgId, 'James Okafor'),
        p_level: 'editor',
      }),
    ).toContain('only owners and admins with access manage access');
    await james.context().close();

    // ── the commenter: reads, comments, does not edit
    const tom = await as(browser, 'tom@example.com', `/${slug}/s/${ca}`);
    await expect(tom.getByText(CA_ITEM).first()).toBeVisible();
    await expect(
      tom.getByText('You can view and comment on this sheet. Ask an editor or admin to change it.'),
    ).toBeVisible();
    await expect(tom.getByRole('button', { name: /^New corrective action/ })).toHaveCount(0);
    await tom.goto(`/${slug}/s/${ca}?item=${burrs.display_id}`);
    const panel = tom.getByRole('dialog');
    await openTab(panel, /^Updates/);
    await panel.getByRole('combobox', { name: 'Write an update' }).fill('Lot 2210 checked.');
    await panel.getByRole('button', { name: 'Post update' }).click();
    await expect(tom.getByText('Update posted.')).toBeVisible();
    const field = await ids.field('Corrective actions', 'description');
    expect(
      await restError(tom, 'rpc/set_item_values', {
        p_item: burrs.id,
        p_patch: { [field]: 'Changed by a commenter' },
      }),
    ).toContain('no access: you cannot edit this sheet');
    await tom.context().close();

    // ── the owner is not on the list: opening the sheet is logged (once a day)
    await page.goto(`/${slug}/s/${ca}`);
    await page.getByRole('button', { name: 'Access', exact: true }).click();
    await expect(page.getByTestId('access-log')).toContainText(
      'Opened this restricted sheet as an owner who is not on the list',
    );
    await expect(page.getByText(CA_ITEM).first()).toBeVisible();
  });

  test('an auditor reads until the end date, then the access ends', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const slug = seedWorkspace('aud');
    await signIn(page, 'maria@example.com', `/${slug}/settings?tab=members`);
    const ids = await idsOf(page, slug);
    const ca = ids.sheets['Corrective actions']!;

    // ── the owner makes Vic an auditor until a day in a month
    const end = isoIn(30);
    await page.getByLabel('Role for Vic Viewer').selectOption('auditor');
    await page.getByLabel('Access for Vic Viewer ends on').fill(end);
    await page.getByRole('button', { name: 'Save end date' }).click();
    const label = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(`${end}T12:00:00Z`));
    await expect(page.getByText(`Auditor · read-only until ${label}`)).toBeVisible();

    // ── the auditor: read-only everywhere, with a banner
    const vic = await as(browser, 'vic@example.com', `/${slug}/s/${ca}`);
    await expect(vic.getByTestId('auditor-banner')).toHaveText(
      `Read-only auditor access until ${label}.`,
    );
    await expect(vic.getByText(CA_ITEM).first()).toBeVisible();
    await expect(vic.getByText('You have read-only auditor access.')).toBeVisible();
    await expect(vic.getByRole('button', { name: /^New corrective action/ })).toHaveCount(0);
    const burrs = await ids.item('Corrective actions', CA_ITEM);
    await vic.goto(`/${slug}/s/${ca}?item=${burrs.display_id}`);
    const panel = vic.getByRole('dialog');
    await openTab(panel, /^Updates/);
    await expect(panel.getByRole('combobox', { name: 'Write an update' })).toHaveCount(0);
    await openTab(panel, /^Activity log/);
    await expect(panel.getByText('Created in').first()).toBeVisible();
    expect(
      await restError(vic, 'item_updates', {
        org_id: ids.orgId,
        item_id: burrs.id,
        author_id: await userId(page, ids.orgId, 'Vic Viewer'),
        body: 'Auditor note',
      }),
    ).toContain('42501');

    // ── the end date passes: access ends without anyone doing anything
    localSql(
      `update memberships set expires_at = now() - interval '1 minute' where org_id = '${ids.orgId}' and role = 'auditor'`,
    );
    expect(await rest(vic, `items?sheet_id=eq.${ca}&select=id`)).toEqual([]);
    expect(await rest(vic, `orgs?slug=eq.${slug}&select=id`)).toEqual([]);
    await vic.goto(`/${slug}/s/${ca}`);
    await expect(vic).not.toHaveURL(new RegExp(`/${slug}/`));
    await vic.context().close();
  });

  test('a restricted field stays hidden from a viewer: table, panel, lookups, search and Insights', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const slug = seedWorkspace('rfl');
    await signIn(page, 'maria@example.com', `/${slug}/home`);
    const ids = await idsOf(page, slug);
    const ca = ids.sheets['Corrective actions']!;
    const actions = ids.sheets['Actions']!;
    const burrs = await ids.item('Corrective actions', CA_ITEM);
    const source = await ids.field('Corrective actions', 'source');
    const owner = await ids.field('Corrective actions', 'owner');

    // Source and Owner: only the owners see them
    await rest(page, 'rpc/set_field_restriction', {
      method: 'POST',
      body: { p_field: source, p_restricted: true, p_user_ids: [], p_roles: [] },
    });
    await rest(page, 'rpc/set_field_restriction', {
      method: 'POST',
      body: { p_field: owner, p_restricted: true, p_user_ids: [], p_roles: [] },
    });
    // an Insights view grouping by Source
    const [view] = await rest<{ id: string }[]>(page, 'views', {
      method: 'POST',
      body: {
        org_id: ids.orgId,
        sheet_id: ca,
        name: 'By source',
        type: 'insights',
        position: 'z0',
        config: {
          insights: {
            rows: [
              {
                id: 'r1',
                widgets: [
                  {
                    id: 'w1',
                    type: 'bars',
                    span: 6,
                    filter: 'all',
                    by: 'source',
                    title: 'Sources',
                  },
                ],
              },
            ],
          },
        },
      },
    });

    // ── the owner always sees
    await page.goto(`/${slug}/s/${ca}?view=table`);
    const row = page.getByRole('grid').getByRole('row').filter({ hasText: CA_ITEM });
    await expect(row).toContainText('Customer complaint');
    await expect(page.getByLabel('restricted field').first()).toBeVisible();
    await page.goto(`/${slug}/s/${ca}?view=${view!.id}`);
    await expect(page.getByText('Customer complaint').first()).toBeVisible();

    // ── the viewer
    const vic = await as(browser, 'vic@example.com', `/${slug}/s/${ca}?view=table`);
    const vrow = vic.getByRole('grid').getByRole('row').filter({ hasText: CA_ITEM });
    await expect(vrow).toContainText('Restricted');
    await expect(vrow).not.toContainText('Customer complaint');
    await expect(vrow).not.toContainText('Tom Kirby');
    // the panel
    await vic.goto(`/${slug}/s/${ca}?item=${burrs.display_id}`);
    const panel = vic.getByRole('dialog');
    await expect(panel.getByText('Restricted').first()).toBeVisible();
    await expect(panel).not.toContainText('Customer complaint');
    await vic.keyboard.press('Escape');
    // the values never reach the browser
    const rows = await rest<{ values: Record<string, unknown> }[]>(
      vic,
      `items?id=eq.${burrs.id}&select=values`,
    );
    expect(Object.keys(rows[0]!.values)).not.toContain(source);
    expect(await rest(vic, `restricted_values?item_id=eq.${burrs.id}&select=value`)).toEqual([]);
    // Insights
    await vic.goto(`/${slug}/s/${ca}?view=${view!.id}`);
    await expect(
      vic.getByText('Restricted: this widget reads a field you cannot see.'),
    ).toBeVisible();
    await expect(vic.getByText('Customer complaint')).toHaveCount(0);
    // a lookup through the link reads the restricted owner: Restricted
    await vic.goto(`/${slug}/s/${actions}?view=table`);
    const arow = vic.getByRole('grid').getByRole('row').filter({ hasText: 'Deburr lot 2210' });
    await expect(arow).toContainText('Restricted');
    // search by person: the owner finds the item through Owner, the viewer does not
    const search = async (p: Page, q: string) => {
      const box = p.getByRole('combobox', { name: 'Search sheets, items and people' });
      await box.fill(q);
      await expect(p.getByLabel('Searching')).toHaveCount(0);
      return p.getByRole('listbox', { name: 'Search results' });
    };
    await expect(await search(page, 'Tom Kirby')).toContainText(CA_ITEM);
    const results = await search(vic, 'Tom Kirby');
    await expect(vic.getByText(/^\d+ results?$|^No sheets or items match/).first()).toBeVisible();
    await expect(results).not.toContainText(CA_ITEM);
    await vic.context().close();
  });
});

async function userId(page: Page, orgId: string, name: string): Promise<string> {
  const rows = await rest<{ user_id: string; profiles: { display_name: string } }[]>(
    page,
    `memberships?org_id=eq.${orgId}&select=user_id,profiles!inner(display_name)`,
  );
  return rows.find((r) => r.profiles.display_name === name)!.user_id;
}
