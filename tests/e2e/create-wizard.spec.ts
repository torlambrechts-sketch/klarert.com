import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace } from './first-sheet-helpers';
import { rest, signIn } from './helpers';

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
