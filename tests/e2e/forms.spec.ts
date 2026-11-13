import { expect, test, type Browser, type Page } from '@playwright/test';
import { MIN_FILL_MS, rest, signIn } from './helpers';

// Forms v1 (docs/05 §3.3, docs/02 §8): an Incident sheet comes with two forms (public report, internal intake). A
// public form opens only once its privacy notice is reviewed; public and internal answers record their source and
// version; an automation listens to one form; a regenerated link kills the old one; forms are duplicated and copied
// to another sheet; the builder works at 390 px. Uses the seed: maria@example.com owns /meridian.

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const prefix = () =>
  Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join(
    '',
  );

async function newSheet(page: Page, start: string, name: string) {
  await page.goto(`/meridian/s/new?start=${start}`);
  await page.getByLabel('Sheet name').fill(name);
  await expect(page.getByLabel('ID prefix')).not.toHaveValue('');
  await page.getByLabel('ID prefix').fill(`${prefix()}-`);
  await page.getByRole('button', { name: 'Create sheet' }).click();
  await expect(page).toHaveURL(/\/meridian\/s\/[0-9a-f-]{36}$/);
  const url = page.url();
  return { url, id: url.split('/s/')[1]! };
}

async function formsOf(page: Page, sheetId: string) {
  return rest<{ id: string; name: string }[]>(
    page,
    `views?sheet_id=eq.${sheetId}&type=eq.form&select=id,name&order=position`,
  );
}

async function signedOut(browser: Browser) {
  const ctx = await browser.newContext();
  return { ctx, page: await ctx.newPage() };
}

test('two forms on an Incident sheet: notice review, public and internal answers, a form-filtered automation, regenerate, duplicate and copy', async ({
  page,
  browser,
}, info) => {
  test.skip(info.project.name === 'phone', 'the phone test covers the builder at 390 px');
  test.setTimeout(180_000);
  await signIn(page, 'maria@example.com');
  const sheet = await newSheet(page, 'incident', `Incidents ${unique()}`);
  const forms = await formsOf(page, sheet.id);
  expect(forms.map((f) => f.name)).toEqual([
    'Report an incident or near miss',
    'Investigator intake',
  ]);
  const report = forms[0]!;
  const intake = forms[1]!;
  const [org] = await rest<{ id: string }[]>(page, 'orgs?slug=eq.meridian&select=id');

  // an automation that listens to the public form only
  const maria = (
    await rest<{ user_id: string }[]>(
      page,
      `memberships?org_id=eq.${org!.id}&role=eq.owner&select=user_id`,
    )
  )[0]!.user_id;
  const [auto] = await rest<{ id: string }[]>(page, 'automations?select=id', {
    method: 'POST',
    body: {
      org_id: org!.id,
      sheet_id: sheet.id,
      name: 'Public reports only',
      trigger: { type: 'form_submitted', formId: report.id },
      actions: [{ type: 'post_update', message: 'Public report received' }],
      created_by: maria,
    },
  });

  // the Forms tab lists both, as drafts
  await page.goto(`${sheet.url}?view=form`);
  await expect(page.getByRole('navigation', { name: 'Views' })).toContainText('Forms (2)');
  const cards = page.getByRole('list', { name: 'Forms' }).getByRole('listitem');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('Draft');
  await expect(cards.nth(0)).toContainText('Public');
  await expect(cards.nth(1)).toContainText('Internal');

  // the public form cannot open until its notice is reviewed
  await cards
    .nth(0)
    .getByRole('button', { name: 'Report an incident or near miss', exact: true })
    .click();
  await page.getByRole('radio', { name: 'Open' }).click();
  const settings = page.getByRole('region', { name: 'Settings' });
  await expect(settings.getByText('Before this form can open')).toBeVisible();
  await expect(
    settings.getByText('An owner or admin must mark the privacy notice as reviewed.'),
  ).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Draft' })).toHaveAttribute('aria-checked', 'true');
  await settings.getByRole('button', { name: 'Mark as reviewed' }).click();
  await expect(settings.getByText(/^Reviewed by Maria/)).toBeVisible();
  await page.getByRole('radio', { name: 'Open' }).click();
  await expect(page.getByRole('radio', { name: 'Open' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(/^Saved · version \d+$/)).toBeVisible();

  // share: create the link
  await page.getByRole('button', { name: 'Share form' }).click();
  const share = page.getByRole('dialog', { name: /^Share/ });
  await share.getByRole('button', { name: 'Create public link' }).click();
  const link = await share.getByLabel('Public link').inputValue();
  await page.keyboard.press('Escape');

  // signed out: the notice, then an answer
  const visitor = await signedOut(browser);
  await visitor.page.goto(link);
  await expect(
    visitor.page.getByRole('heading', { name: 'Report an incident or near miss' }),
  ).toBeVisible();
  await visitor.page.getByText('How we use your answers').click();
  await expect(visitor.page.getByText('Legal obligation')).toBeVisible();
  await visitor.page.getByLabel('What happened, in a few words').fill('Forklift near miss');
  await visitor.page.getByLabel(/Describe what you saw/).fill('Reversed without a spotter.');
  await visitor.page.waitForTimeout(MIN_FILL_MS);
  await visitor.page.getByRole('button', { name: 'Send' }).click();
  await expect(visitor.page.getByText('Thank you. Your answers were sent.')).toBeVisible();
  await expect(visitor.page.getByText('The safety team reads every report.')).toBeVisible();
  // the thank-you page never echoes the answers
  await expect(visitor.page.getByText('Reversed without a spotter.')).toHaveCount(0);

  // the internal intake: open it, then send an answer as Maria
  await page.getByRole('button', { name: 'All forms' }).click();
  await cards.nth(1).getByRole('button', { name: 'Investigator intake', exact: true }).click();
  await page.getByRole('radio', { name: 'Open' }).click();
  await expect(page.getByRole('radio', { name: 'Open' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Preview' }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview' });
  await dialog.getByRole('textbox', { name: /^Incident/ }).fill('Chemical splash in lab 2');
  await dialog.getByRole('button', { name: /^Severity/ }).click();
  await page.getByRole('option').first().click();
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/^Sent\. .+ was added\.$/)).toBeVisible();
  await page.keyboard.press('Escape');

  // both items name their form, version and channel
  const items = await rest<
    {
      display_id: string;
      name: string;
      source_form_id: string;
      source_channel: string;
      form_version: number;
    }[]
  >(
    page,
    `items?sheet_id=eq.${sheet.id}&select=display_id,name,source_form_id,source_channel,form_version&order=seq`,
  );
  expect(items.map((i) => [i.name, i.source_form_id, i.source_channel])).toEqual([
    ['Forklift near miss', report.id, 'public'],
    ['Chemical splash in lab 2', intake.id, 'internal'],
  ]);
  await page.goto(`${sheet.url}?item=${items[0]!.display_id}`);
  await expect(
    page.getByText(/From form: Report an incident or near miss \(v\d+\) · Public/),
  ).toBeVisible();
  await page.goto(`${sheet.url}?item=${items[1]!.display_id}`);
  await expect(page.getByText(/From form: Investigator intake \(v\d+\) · Internal/)).toBeVisible();

  // the automation ran for the public form only
  const runs = await rest<{ item_id: string }[]>(
    page,
    `automation_runs?automation_id=eq.${auto!.id}&select=item_id`,
  );
  expect(runs).toHaveLength(1);

  // regenerate: the old link stops working at once
  await page.goto(`${sheet.url}?view=form&form=${report.id}`);
  await page.getByRole('button', { name: 'Share form' }).click();
  await share.getByRole('button', { name: 'Regenerate link' }).click();
  await share.getByRole('alert').getByRole('button', { name: 'Make a new link' }).click();
  await expect(share.getByLabel('Public link')).not.toHaveValue(link);
  await visitor.page.goto(link);
  await expect(
    visitor.page.getByRole('heading', { name: 'This form is not available' }),
  ).toBeVisible();
  await visitor.ctx.close();
  await page.keyboard.press('Escape');

  // duplicate (a draft copy) and copy to another sheet (missing fields reported)
  const other = await newSheet(page, 'log', `Log ${unique()}`);
  await page.goto(`${sheet.url}?view=form`);
  await page.getByRole('button', { name: 'Actions for Report an incident or near miss' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.getByText('Form duplicated as a draft.')).toBeVisible();
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(2)).toContainText('Report an incident or near miss (copy)');
  await expect(cards.nth(2)).toContainText('Draft');

  await page.getByRole('button', { name: 'Actions for Investigator intake' }).click();
  await page.getByRole('menuitem', { name: 'Copy to another sheet' }).click();
  const copy = page.getByRole('dialog', { name: /^Copy Investigator intake/ });
  await copy.getByLabel('Sheet').selectOption(other.id);
  await copy.getByRole('button', { name: 'Copy form' }).click();
  await expect(page.getByText(/^Copied to Log /)).toBeVisible();
  const copied = await rest<{ config: { form: { fields: { key: string }[]; status: string } } }[]>(
    page,
    `views?sheet_id=eq.${other.id}&type=eq.form&select=config`,
  );
  expect(copied).toHaveLength(1);
  expect(copied[0]!.config.form.status).toBe('draft');
  // the Log has these keys too; nothing was asked that it lacks
  expect(copied[0]!.config.form.fields.map((f) => f.key)).toEqual([
    'reported_by',
    'happened_at',
    'severity',
    'description',
  ]);
  const links = await rest<unknown[]>(page, `form_links?sheet_id=eq.${other.id}&select=id`);
  expect(links).toEqual([]);

  // the sheet's log has the form changes and link events
  const log = await rest<{ action: string }[]>(
    page,
    `activity_log?sheet_id=eq.${sheet.id}&action=in.(view.form_changed,form.link_created,form.link_regenerated)&select=action`,
  );
  expect(log.some((l) => l.action === 'view.form_changed')).toBe(true);
  expect(log.filter((l) => l.action === 'form.link_created')).toHaveLength(1);
  expect(log.filter((l) => l.action === 'form.link_regenerated')).toHaveLength(1);
});

test('a copy to a sheet without some fields reports what was left out', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop flow');
  await signIn(page, 'maria@example.com');
  const sheet = await newSheet(page, 'incident', `Incidents ${unique()}`);
  const other = await newSheet(page, 'tracker', `Tracker ${unique()}`);
  await page.goto(`${sheet.url}?view=form`);
  await page.getByRole('button', { name: 'Actions for Investigator intake' }).click();
  await page.getByRole('menuitem', { name: 'Copy to another sheet' }).click();
  const copy = page.getByRole('dialog', { name: /^Copy Investigator intake/ });
  await copy.getByLabel('Sheet').selectOption(other.id);
  await copy.getByRole('button', { name: 'Copy form' }).click();
  await expect(
    page.getByText(
      /^Left out \(not on Tracker .+\): Reported by, Happened at, Severity, Description\.$/,
    ),
  ).toBeVisible();
  const [copied] = await rest<{ config: { form: { fields: { key: string }[] } } }[]>(
    page,
    `views?sheet_id=eq.${other.id}&type=eq.form&select=config`,
  );
  expect(copied!.config.form.fields.map((f) => f.key)).toEqual([]);
});

test('the builder at 390 px: one column, Fields | Preview | Settings at the bottom', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout');
  await signIn(page, 'maria@example.com');
  const sheet = await newSheet(page, 'incident', `Incidents ${unique()}`);
  const [report] = await formsOf(page, sheet.id);
  await page.goto(`${sheet.url}?view=form&form=${report!.id}`);
  const panels = page.getByRole('tablist', { name: 'Builder panels' });
  await expect(panels).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share form' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Status' })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'Preview' })).toBeVisible();
  await panels.getByRole('tab', { name: 'Fields' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Fields' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Ask Severity' })).toBeVisible();
  await panels.getByRole('tab', { name: 'Settings' }).click();
  await expect(
    page
      .getByRole('tabpanel', { name: 'Settings' })
      .getByRole('heading', { name: 'Privacy notice' }),
  ).toBeVisible();
  // nothing wider than the screen
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(wide).toBeLessThanOrEqual(390);
});
