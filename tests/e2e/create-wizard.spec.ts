import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace } from './first-sheet-helpers';
import { appScreenNames, rest, signIn } from './helpers';

// The Create wizard (docs/05 §4 Create, docs/11 Bundles): Ctrl+K opens the picker, a goal finds the incident set, the
// preview flags its public form and lets a form be left out, step 3 names it with an owner and a review date, Create
// lands on the sheet with the next action and "Generated from template, not yet reviewed", and the owner marks it
// reviewed (logged). On a phone the picker is one column with the actions in a bar at the bottom.

const SHOTS = process.env.CREATE_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

async function openApp(page: Page, slug: string) {
  await signIn(page, 'maria@example.com', `/${slug}/home`);
  // the magic link lands on the configured site; the session cookie is the same on every localhost port
  await page.goto(`/${slug}/home`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test.describe('desktop', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'chromium', 'desktop walkthrough'));

  test('goal → preview with a part left out → details → created set, reviewed by its owner', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const slug = seedWorkspace('cw');
    await openApp(page, slug);

    // ── 1. Ctrl+K opens Create on the goal box; nothing typed leaves the page
    const wizard = page.getByRole('dialog', { name: 'Create' });
    // the shortcut listens once the page has hydrated
    await expect(async () => {
      await page.keyboard.press('Control+k');
      await expect(wizard).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await expect(
      wizard.getByRole('heading', { name: 'What do you need to handle?' }),
    ).toBeVisible();
    await expect(wizard.getByTestId('create-goal')).toBeFocused();
    await expect(wizard.getByRole('button', { name: 'Supplier onboarding' })).toBeVisible();
    await wizard.getByTestId('create-goal').fill('We need to log security incidents');
    const matches = wizard.getByTestId('create-matches');
    await expect(matches.getByRole('button').first()).toContainText('Incident');
    await shot(page, '1-goal');

    // ── 2. the preview: what it creates, the public form flagged, untick the internal form
    await matches.getByRole('button').first().click();
    const preview = wizard.getByTestId('create-preview');
    await expect(preview).toBeVisible();
    await expect(preview.getByTestId('create-summary')).toHaveText(
      /^Creates 1 sheet · 5 fields · 2 forms\./,
    );
    await expect(wizard.getByTestId('create-flags')).toContainText(
      'Public form: created as a draft.',
    );
    await expect(preview).toContainText('Nothing is created until you press Create.');
    await preview.getByTestId('part-form:incident.intake').uncheck();
    await expect(preview.getByTestId('create-summary')).toHaveText(
      /^Creates 1 sheet · 5 fields · 1 form\./,
    );
    await shot(page, '2-preview');
    // unticking the sheet leaves out its forms too, with a note; ticking a form brings the sheet back
    await preview.getByTestId('part-sheet:incident').uncheck();
    await expect(wizard.getByTestId('create-note')).toContainText('Also leaves out 1 form');
    await expect(wizard.getByTestId('create-next')).toBeDisabled();
    await preview.getByTestId('part-form:incident.report').check();
    await expect(wizard.getByTestId('create-note')).toContainText('Also adds back 1 sheet');
    await expect(preview.getByTestId('part-sheet:incident')).toBeChecked();

    // ── 3. details: name, owner (you), review date, then Create; Back keeps the choices
    await wizard.getByTestId('create-next').click();
    await expect(wizard.getByTestId('create-name')).toHaveValue('Incident');
    await wizard.getByTestId('create-back').click();
    await expect(preview.getByTestId('part-form:incident.intake')).not.toBeChecked();
    await wizard.getByTestId('create-next').click();
    await wizard.getByTestId('create-name').fill('Security incidents');
    await expect(wizard.getByTestId('create-owner').locator('option:checked')).toContainText(
      '(you)',
    );
    await expect(wizard.getByTestId('create-review')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await wizard.getByTestId('create-submit').click();

    // ── 4. lands inside the result: next action, label and the review badge
    await expect(page).toHaveURL(new RegExp(`/${slug}/s/[0-9a-f-]{36}`), { timeout: 30_000 });
    await expect(wizard).toBeHidden();
    await expect(page.getByText(/^Created Security incidents: 1 sheet/)).toBeVisible();
    const banner = page.getByTestId('bundle-banner');
    await expect(banner.getByTestId('next-action')).toHaveText(/Add your first incident/);
    await expect(banner).toContainText('Created by Security incidents');
    await expect(banner.getByTestId('not-reviewed')).toHaveText(
      'Generated from template, not yet reviewed',
    );
    await shot(page, '3-created');

    const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
    const [inst] = await rest<
      { id: string; bundle_name: string; origin: string; review_by: string; ref_map: object }[]
    >(page, `pack_installs?org_id=eq.${org!.id}&pack_key=eq.start-incident&select=*`);
    expect(inst).toMatchObject({ bundle_name: 'Security incidents', origin: 'create' });
    expect(Object.keys(inst!.ref_map)).not.toContain('view:incident.form.intake');
    const created = await rest<{ note: string }[]>(
      page,
      `activity_log?org_id=eq.${org!.id}&action=eq.bundle.created&select=note`,
    );
    expect(created[0]!.note).toBe('created via Create from Incident 1.0.0');

    // ── 5. the owner marks it reviewed: the badge says who and when, the log has it
    await banner.getByRole('button', { name: 'Mark reviewed' }).click();
    await expect(banner).toContainText('Reviewed by Maria');
    await expect(banner.getByTestId('not-reviewed')).toHaveCount(0);
    const reviewed = await rest<unknown[]>(
      page,
      `activity_log?org_id=eq.${org!.id}&action=eq.bundle.reviewed&select=id`,
    );
    expect(reviewed).toHaveLength(1);
  });
});

test.describe('phone', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'phone layout'));

  test('Create from the phone menu is one column with a bottom action bar', async ({ page }) => {
    test.setTimeout(120_000);
    const slug = seedWorkspace('cwp');
    await openApp(page, slug);
    await page
      .getByRole('navigation', { name: 'Bottom bar' })
      .getByRole('button', { name: 'Menu' })
      .click();
    await page.getByRole('dialog', { name: 'Menu' }).getByTestId('create-button').click();
    const wizard = page.getByRole('dialog', { name: 'Create' });
    await expect(wizard).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await shot(page, '4-phone-goal');
    await wizard.getByRole('button', { name: 'Complaints' }).click();
    await wizard.getByTestId('create-matches').getByRole('button').first().click();
    await expect(wizard.getByTestId('create-preview')).toBeVisible();
    await expect(wizard.getByTestId('create-next')).toBeInViewport();
    await shot(page, '5-phone-preview');
  });
});

// ── Owner decision (14 Nov 2026): the App card and the settings step (docs/05 §4 Create, docs/11 Pack settings,
// docs/13). Screenshots go to CREATE_SHOTS when it is set.

const NIS2 = 'NIS2 cybersecurity';
// screenshots for review are taken at twice the pixel density
const SHOT_SCALE = SHOTS ? { deviceScaleFactor: 2 } : {};

/** Tab (or Shift+Tab) until the element with this test id has the focus: keyboard only, however many stops. */
async function tabTo(page: Page, testId: string, back = false) {
  for (let i = 0; i < 120; i += 1) {
    if (
      await page.evaluate(
        (id) => document.activeElement?.getAttribute('data-testid') === id,
        testId,
      )
    )
      return;
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
  }
  throw new Error(`${testId} never took the focus`);
}

async function openCreate(page: Page) {
  const wizard = page.getByRole('dialog', { name: 'Create' });
  await expect(async () => {
    await page.keyboard.press('Control+k');
    await expect(wizard).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return wizard;
}

test.describe('App card and settings, desktop', () => {
  test.use(SHOT_SCALE);
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'chromium', 'desktop walkthrough'));

  test('keyboard only: Create › App › CAPA, its preview, Create, lands on the app', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const slug = seedWorkspace('cwa', { empty: true });
    await openApp(page, slug);
    const wizard = await openCreate(page);

    // ── 1. the App card sits next to Solve a problem; Tab reaches it, Enter opens it
    await expect(wizard.getByTestId('create-card-app')).toContainText('App');
    await tabTo(page, 'create-card-app');
    await expect(wizard.getByTestId('create-card-app')).toBeFocused();
    await shot(page, 'app-1-card');
    await page.keyboard.press('Enter');

    // ── 2. the apps a person can start: CAPA comes with its set; the focus is on the step's heading
    await expect(wizard.getByRole('heading', { name: 'Pick an app' })).toBeFocused();
    const list = wizard.getByRole('radiogroup', { name: 'Apps' });
    await expect(list.getByTestId('create-app-capa')).toContainText(
      'Comes with Corrective action (CAPA)',
    );
    await expect(list.getByTestId('create-app-isms-capa')).toBeVisible();
    await tabTo(page, 'create-app-capa');
    await page.keyboard.press('Enter');
    await expect(list.getByTestId('create-app-capa')).toHaveAttribute('aria-checked', 'true');
    const preview = wizard.getByTestId('create-app-preview');
    await expect(preview.getByRole('heading', { name: 'CAPA', exact: true })).toBeVisible();
    await expect(preview).toContainText('Comes with the ready-made set Corrective action (CAPA)');
    await expect(preview.getByRole('list', { name: 'Work screens' })).toContainText(
      'Report a problem',
    );
    // the set's own preview, as in Solve a problem
    await expect(preview.getByTestId('create-preview')).toBeVisible();
    await expect(preview.getByTestId('create-summary')).toContainText('1 app');
    await expect(wizard.getByTestId('create-next')).toBeEnabled();
    await shot(page, 'app-2-preview');

    // leaving out the sheet leaves no screen: Next waits until the parts are ticked back (Space on the boxes; the
    // automation brings back the sheet and the form it needs, then the dashboard)
    const full = /1 form · 1 automation · 1 dashboard · 1 app\./;
    await expect(preview.getByTestId('create-summary')).toHaveText(full);
    await tabTo(page, 'part-sheet:capa');
    await page.keyboard.press('Space');
    await expect(wizard.getByTestId('create-app-empty')).toBeVisible();
    await expect(wizard.getByTestId('create-next')).toBeDisabled();
    await tabTo(page, 'part-automation:reported_add_steps');
    await page.keyboard.press('Space');
    await expect(wizard.getByTestId('create-app-empty')).toHaveCount(0);
    await tabTo(page, 'part-dashboard:capa_overview');
    await page.keyboard.press('Space');
    await expect(preview.getByTestId('create-summary')).toHaveText(full);

    // ── 3. Next, the details (no settings for this set), Create
    await tabTo(page, 'create-next');
    await page.keyboard.press('Enter');
    await expect(wizard.getByTestId('create-name')).toHaveValue('Corrective action (CAPA)');
    await expect(wizard.getByTestId('create-settings')).toHaveCount(0);
    await tabTo(page, 'create-submit');
    await page.keyboard.press('Enter');

    // ── 4. lands on the app's first screen; the side menu has it
    await expect(page).toHaveURL(new RegExp(`/${slug}/apps/capa(/[a-z-]+)?$`), {
      timeout: 60_000,
    });
    await expect(page.getByText(/^Created Corrective action \(CAPA\): 1 sheet/)).toContainText(
      '1 draft form, 1 automation, 1 dashboard',
    );
    await page.getByRole('navigation', { name: 'CAPA screens' }).waitFor();
    expect(await appScreenNames(page, 'CAPA screens')).toEqual([
      'Report a problem',
      'My actions',
      'Needs my approval',
      'All nonconformities',
      'Overview',
      'Workflow',
    ]);
    await expect(
      page.getByRole('list', { name: 'Apps' }).getByRole('link', { name: 'CAPA' }),
    ).toBeVisible();
    await shot(page, 'app-4-installed');
    const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
    const [inst] = await rest<{ origin: string; bundle_name: string }[]>(
      page,
      `pack_installs?org_id=eq.${org!.id}&pack_key=eq.start-capa&status=eq.installed&select=origin,bundle_name`,
    );
    expect(inst).toEqual({ origin: 'create', bundle_name: 'Corrective action (CAPA)' });

    // ── 5. Create again: a goal finds CAPA as an app that is ready here, and it opens
    const again = await openCreate(page);
    await again.getByTestId('create-goal').fill('corrective actions');
    const first = again.getByTestId('create-matches').getByRole('button').first();
    await expect(first).toContainText('CAPA');
    await expect(first).toContainText('Ready');
    await first.press('Enter');
    await expect(again.getByTestId('create-app-capa')).toContainText('Ready');
    await expect(again.getByTestId('create-app-preview')).toContainText('CAPA is ready here.');
    await again.getByRole('button', { name: 'Open CAPA' }).press('Enter');
    await expect(again).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/${slug}/apps/capa`));
  });

  test('NIS2 from Create with Norway in the settings step, then the same choice in Packs', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const slug = seedWorkspace('cwn', { empty: true });
    await openApp(page, slug);
    const wizard = await openCreate(page);
    await wizard.getByTestId('create-card-solve').click();
    await wizard.getByTestId('create-set-nis2').click();
    await expect(wizard.getByTestId('create-preview')).toBeVisible({ timeout: 60_000 });
    await expect(wizard.getByTestId('create-next')).toBeEnabled({ timeout: 60_000 });
    await wizard.getByTestId('create-next').click();

    // ── the settings section of step 3: the same picker and unverified notice as Packs › Settings
    const settings = wizard.getByTestId('create-settings');
    await expect(settings).toBeVisible();
    await expect(wizard.getByRole('list', { name: 'Steps' }).getByRole('listitem')).toHaveCount(3);
    const country = settings.getByLabel('Country of main establishment');
    await expect(country).toHaveValue('');
    await country.selectOption({ label: 'Norway' });
    const details = settings.getByTestId('setting-details');
    await expect(details.getByTestId('setting-unverified')).toHaveText(
      'Not verified yet: check these details with the authority before you rely on them.',
    );
    await expect(details).toContainText('NorCERT');
    await settings.evaluate((el) => {
      el.scrollIntoView({ block: 'start' });
      el.closest('.overflow-y-auto')?.scrollBy(0, -24);
    });
    await shot(page, 'settings-desktop');
    await wizard.getByTestId('create-submit').click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/s/[0-9a-f-]{36}`), { timeout: 240_000 });
    await expect(wizard).toBeHidden();

    // ── recorded with the set: the choice, the defaults it set, the log
    const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
    const [nis2] = await rest<{ id: string; settings: unknown; origin: string }[]>(
      page,
      `pack_installs?org_id=eq.${org!.id}&pack_key=eq.nis2&status=eq.installed&select=id,settings,origin`,
    );
    expect(nis2).toMatchObject({ settings: { country: 'no' }, origin: 'create' });
    const [reports] = await rest<{ id: string }[]>(
      page,
      `sheets?pack_install_id=eq.${nis2!.id}&name=eq.NIS2%20incident%20reports&select=id`,
    );
    const [recipient] = await rest<{ config: { default?: string } }[]>(
      page,
      `fields?sheet_id=eq.${reports!.id}&key=eq.recipient&select=config`,
    );
    expect(recipient!.config.default).toMatch(/NorCERT/);
    const logged = await rest<{ new_value: { labels: Record<string, string> } }[]>(
      page,
      `activity_log?org_id=eq.${org!.id}&action=eq.pack.settings_changed&select=new_value`,
    );
    expect(logged.map((l) => l.new_value.labels)).toEqual([
      { 'Country of main establishment': 'Norway' },
    ]);

    // ── Workspace admin › Packs shows the same choice, still editable
    await page.goto(`/${slug}/settings?tab=packs`);
    const installed = page
      .getByRole('list', { name: 'Installed packs' })
      .getByRole('listitem')
      .filter({ hasText: NIS2 });
    await expect(installed.getByTestId('pack-settings-summary')).toHaveText(
      'Country of main establishment: Norway',
    );
    await installed.getByRole('button', { name: `Settings of ${NIS2}` }).click();
    const dialog = page.getByRole('dialog', { name: `Settings of ${NIS2}` });
    await expect(dialog.getByLabel('Country of main establishment')).toHaveValue('no');
    await shot(page, 'settings-in-packs');
  });
});

test.describe('App card and settings, phone', () => {
  test.use(SHOT_SCALE);
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'phone layout'));

  test('at 390 px: the App card with CAPA first, and the NIS2 settings step', async ({ page }) => {
    test.setTimeout(180_000);
    const slug = seedWorkspace('cwap', { empty: true });
    await openApp(page, slug);
    await page
      .getByRole('navigation', { name: 'Bottom bar' })
      .getByRole('button', { name: 'Menu' })
      .click();
    await page.getByRole('dialog', { name: 'Menu' }).getByTestId('create-button').click();
    const wizard = page.getByRole('dialog', { name: 'Create' });
    await expect(wizard).toBeVisible();
    await wizard.getByTestId('create-card-app').click();
    await wizard.getByTestId('create-app-capa').click();
    // below 1000 px the chosen app's preview comes before the list
    await expect(wizard.getByTestId('create-app-preview')).toBeInViewport();
    await expect(wizard.getByTestId('create-next')).toBeInViewport();
    await expect(wizard.getByTestId('create-preview')).toBeVisible();
    await expect(wizard.getByTestId('create-next')).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await shot(page, 'app-phone-preview');

    // the settings step for NIS2 at 390 px (not created here: the desktop test does that)
    await wizard.getByTestId('create-back').click();
    await wizard.getByTestId('create-card-solve').click();
    await wizard.getByTestId('create-set-nis2').click();
    await expect(wizard.getByTestId('create-next')).toBeEnabled({ timeout: 60_000 });
    await wizard.getByTestId('create-next').click();
    const settings = wizard.getByTestId('create-settings');
    await settings.getByLabel('Country of main establishment').selectOption({ label: 'Norway' });
    await expect(settings.getByTestId('setting-unverified')).toBeVisible();
    await settings.evaluate((el) => {
      el.scrollIntoView({ block: 'start' });
      el.closest('.overflow-y-auto')?.scrollBy(0, -24);
    });
    await expect(wizard.getByTestId('create-submit')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await shot(page, 'settings-phone');
  });
});
