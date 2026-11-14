import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { localSql, seedWorkspace } from './first-sheet-helpers';
import { signIn } from './helpers';

// Approval workflows (docs/04 §13, docs/05): an owner defines a two-step workflow in Sheet settings (Review by the
// item's Owner, then Approval by everyone with the job role "Quality lead", a rejection there back to Review, lock on
// approval); submits an item from the panel; the reviewer approves from My work; the approver, who can only view the
// sheet, rejects with a reason and the item goes back to step 1; both approve again; the item is locked and every
// submission and decision is in its activity log. Screenshots of the editor, the inbox and the panel timeline go to
// APPROVAL_SHOTS when it is set.

const SHOTS = process.env.APPROVAL_SHOTS;

const id = (email: string) => localSql(`select id from auth.users where email = '${email}'`).trim();

/** No serious or critical WCAG 2.1 AA issue (axe), as tests/e2e/accessibility.spec.ts. */
async function axe(page: Page, what: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bad = result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.html.slice(0, 160)).join(' | ')}`);
  expect(bad, `${what}: serious or critical axe violations`).toEqual([]);
}

async function as(browser: Browser, email: string, next: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email, next);
  await page.goto(next);
  return page;
}

test('define, submit, approve from My work, a rejection back to step 1, locked', async ({
  page,
  browser,
}, info) => {
  test.skip(info.project.name === 'phone', 'the inbox is checked at 390 px inside the test');
  test.setTimeout(240_000);
  const slug = seedWorkspace('appr', { empty: true });
  const org = localSql(`select id from orgs where slug = '${slug}'`).trim();
  const [maria, james, vic] = [
    id('maria@example.com'),
    id('james@example.com'),
    id('vic@example.com'),
  ];
  const sheet = randomUUID();
  const group = randomUUID();
  const f = {
    owner: randomUUID(),
    summary: randomUUID(),
    status: randomUUID(),
    step: randomUUID(),
  };
  const item = randomUUID();
  // a sheet with an Owner, a Status and a Workflow step field, and one procedure owned by James; Vic (a viewer)
  // holds the job title Quality lead
  localSql(`
    insert into job_roles (org_id, name) values ('${org}', 'Quality lead') on conflict do nothing;
    update memberships set job_title = 'Quality lead' where org_id = '${org}' and user_id = '${vic}';
    insert into sheets (id, org_id, name, item_label, id_prefix, position, next_seq)
      values ('${sheet}', '${org}', 'Procedures', 'Procedure', 'PRC-', 'zz', 2);
    insert into groups (id, org_id, sheet_id, name, color, position) values ('${group}', '${org}', '${sheet}', 'Open', 'blue', 'a0');
    insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
      ('${f.owner}', '${org}', '${sheet}', 'owner', 'Owner', 'people', 'a0', '{"multiple":false}'),
      ('${f.summary}', '${org}', '${sheet}', 'summary', 'Summary', 'text', 'a1', '{}'),
      ('${f.status}', '${org}', '${sheet}', 'status', 'Status', 'status', 'a2',
       '{"options":[{"id":"opt_draft","label":"Draft","color":"grey"},{"id":"opt_review","label":"In review","color":"orange"},{"id":"opt_ok","label":"Approved","color":"green","done":true}]}'),
      ('${f.step}', '${org}', '${sheet}', 'approval_step', 'Approval step', 'workflowstep', 'a3',
       '{"options":[{"id":"opt_s_draft","label":"Draft","color":"grey"},{"id":"opt_s_review","label":"Review","color":"blue"},{"id":"opt_s_approval","label":"Approval","color":"purple"},{"id":"opt_s_done","label":"Done","color":"green","done":true}]}');
    insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, "values", position, created_by, updated_by)
      values ('${item}', '${org}', '${sheet}', '${group}', 1, 'PRC-001', 'Change control procedure',
              '{"${f.owner}":["${james}"],"${f.summary}":"How changes are approved","${f.status}":"opt_draft"}',
              'a0', '${maria}', '${maria}');
  `);

  // ── define (owner) ──
  await signIn(page, 'maria@example.com', `/${slug}/s/${sheet}/settings`);
  await page.goto(`/${slug}/s/${sheet}/settings#approvals`);
  await page.getByRole('button', { name: 'New approval workflow' }).click();
  const form = page.getByRole('form', { name: 'New approval workflow' });
  await form.getByLabel('Name', { exact: true }).fill('Procedure approval');
  const step1 = form.getByRole('listitem', { name: 'Step 1' });
  await step1.getByLabel('Step name').fill('Review');
  await expect(step1.getByLabel('Step 1 approvers')).toHaveValue('owner');
  await form.getByRole('button', { name: 'Add a step' }).click();
  const step2 = form.getByRole('listitem', { name: 'Step 2' });
  await step2.getByLabel('Step name').fill('Approval');
  await step2.getByLabel('Who approves').selectOption('jobRole');
  await step2.getByLabel('Step 2 approvers').selectOption({ label: 'Quality lead' });
  await step2.getByLabel('Step 2 time limit', { exact: true }).fill('8');
  await step2.getByLabel('Step 2 time limit unit').selectOption('hours');
  await step2.getByLabel('If rejected').selectOption({ label: 'Back to step 1, Review' });
  await form.getByLabel('Summary').check();
  await form.getByLabel('Show the step in').selectOption({ label: 'Approval step' });
  await form.getByLabel('Set a status as it moves').selectOption({ label: 'Status' });
  await form.getByLabel('When submitted').selectOption({ label: 'In review' });
  await form.getByLabel('When approved').selectOption({ label: 'Approved' });
  await form.getByLabel('When rejected').selectOption({ label: 'Draft' });
  await expect(
    form.getByLabel('Lock the item when it is approved', { exact: false }),
  ).toBeChecked();
  if (SHOTS) {
    await page.setViewportSize({ width: 1280, height: 2200 });
    // the bottom of the form at the bottom of the window: the sticky top bar stays clear of it
    await form.evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await form.screenshot({ path: `${SHOTS}/editor.png` });
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await axe(page, 'Approval workflow editor');
  await form.getByRole('button', { name: 'Save workflow' }).click();
  const list = page.getByRole('list', { name: 'Approval workflows' });
  await expect(list).toContainText('Procedure approval');
  await expect(list).toContainText('Quality lead (job role), any one approves, 8 hours');
  if (SHOTS) await page.locator('#approvals').screenshot({ path: `${SHOTS}/editor-saved.png` });

  // ── submit (owner, from the item panel) ──
  await page.goto(`/${slug}/s/${sheet}?item=PRC-001`);
  const panel = page.getByTestId('item-approvals');
  await panel.getByRole('button', { name: 'Submit for approval' }).click();
  const submit = page.getByRole('dialog', { name: 'Submit for approval' });
  await expect(submit.getByRole('list', { name: 'Who approves' })).toContainText('James Okafor');
  await expect(submit.getByRole('list', { name: 'Who approves' })).toContainText('Vic Viewer');
  await submit.getByLabel('Comment (optional)').fill('Ready for review');
  await submit.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(panel.getByTestId('approval-state')).toContainText(
    'Waiting for approval: step 1 of 2, Review',
  );
  const status = () =>
    localSql(
      `select "values"->>'${f.status}' || '|' || ("values"->>'${f.step}') || '|' || locked from items where id = '${item}'`,
    ).trim();
  expect(status()).toBe('opt_review|opt_s_review|false');
  if (SHOTS) await panel.screenshot({ path: `${SHOTS}/panel-waiting.png` });
  await axe(page, 'Item panel with an approval waiting');

  // ── the reviewer approves from My work ──
  const jamesPage = await as(browser, 'james@example.com', `/${slug}/my-work`);
  const inbox = jamesPage.getByTestId('approval-inbox');
  await expect(inbox.getByTestId('approval-row')).toHaveCount(1);
  await expect(inbox).toContainText('Step 1 of 2: Review');
  await expect(inbox).toContainText('Submitted by Maria Pereira');
  await inbox.getByRole('button', { name: 'Approve PRC-001 Change control procedure' }).click();
  await jamesPage
    .getByRole('dialog', { name: /^Approve PRC-001/ })
    .getByRole('button', { name: 'Approve' })
    .click();
  await expect(inbox).toContainText('Nothing waits for your approval.');

  // ── the approver (view access only) rejects with a reason: back to step 1 ──
  const vicPage = await as(browser, 'vic@example.com', `/${slug}/my-work`);
  const vicInbox = vicPage.getByTestId('approval-inbox');
  await expect(vicInbox).toContainText('Step 2 of 2: Approval');
  await vicInbox.getByRole('button', { name: 'Reject PRC-001 Change control procedure' }).click();
  const reject = vicPage.getByRole('dialog', { name: /^Reject PRC-001/ });
  await reject.getByRole('button', { name: 'Reject' }).click();
  await expect(reject.getByRole('alert')).toHaveText('Say why you reject it.');
  await reject.getByLabel('Why do you reject it?').fill('Add the rollback plan');
  await reject.getByRole('button', { name: 'Reject' }).click();
  await expect(vicInbox).toContainText('Nothing waits for your approval.');
  expect(
    localSql(
      `select step_index || '|' || round from workflow_instances where item_id = '${item}' and status = 'in_progress'`,
    ).trim(),
  ).toBe('0|2');
  expect(status()).toBe('opt_review|opt_s_review|false');

  // ── round 2: the reviewer and the approver approve ──
  await jamesPage.reload();
  await jamesPage
    .getByTestId('approval-inbox')
    .getByRole('button', { name: 'Approve PRC-001 Change control procedure' })
    .click();
  await jamesPage
    .getByRole('dialog', { name: /^Approve PRC-001/ })
    .getByRole('button', { name: 'Approve' })
    .click();
  await expect(jamesPage.getByTestId('approval-inbox')).toContainText(
    'Nothing waits for your approval.',
  );
  await vicPage.reload();
  await expect(vicPage.getByTestId('approval-row')).toHaveCount(1);
  await axe(vicPage, 'My work with Needs my approval');
  if (SHOTS) {
    await vicPage.getByTestId('approval-inbox').screenshot({ path: `${SHOTS}/inbox.png` });
    await vicPage.setViewportSize({ width: 390, height: 844 });
    await vicPage.screenshot({ path: `${SHOTS}/inbox-390.png`, fullPage: true });
  }
  await vicPage.setViewportSize({ width: 390, height: 844 });
  const overflow = await vicPage.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await vicPage
    .getByTestId('approval-inbox')
    .getByRole('button', { name: 'Approve PRC-001 Change control procedure' })
    .click();
  await vicPage
    .getByRole('dialog', { name: /^Approve PRC-001/ })
    .getByRole('button', { name: 'Approve' })
    .click();
  await expect(vicPage.getByText('Approved. Every step is done.')).toBeVisible();

  // ── locked, the status and the step set, every decision in the log ──
  expect(status()).toBe('opt_ok|opt_s_done|true');
  expect(
    localSql(
      `select string_agg(action || coalesce(':' || (new_value->>'decision'), ''), ',' order by id) from activity_log
        where item_id = '${item}' and (action like 'workflow.%' or action = 'item.locked')`,
    ).trim(),
  ).toBe(
    [
      'workflow.submitted',
      'workflow.decided:approved',
      'workflow.decided:rejected',
      'workflow.decided:approved',
      'workflow.decided:approved',
      'workflow.approved',
      'item.locked',
    ].join(','),
  );
  expect(
    localSql(
      `select note from activity_log where item_id = '${item}' and action = 'workflow.decided' and new_value->>'decision' = 'rejected'`,
    ).trim(),
  ).toBe('Add the rollback plan');

  // the owner sees the timeline and the log in the panel
  await page.reload();
  await expect(panel.getByTestId('approval-state')).toContainText('Approved (Procedure approval)');
  const steps = panel.getByRole('list', { name: 'Approval steps' });
  await expect(steps.getByTestId('approval-step')).toHaveCount(2);
  await expect(steps).toContainText('Round 1: 1 decision');
  await expect(steps).toContainText('Vic Viewer ✕ rejected');
  await expect(steps).toContainText('“Add the rollback plan”');
  if (SHOTS) await panel.screenshot({ path: `${SHOTS}/panel-timeline.png` });
  await page.getByRole('tab', { name: /Activity log/ }).click();
  await expect(page.getByText('Approval complete: Procedure approval')).toBeVisible();
  await expect(
    page.getByText(
      'Rejected step 2, Approval of Procedure approval · Comment: “Add the rollback plan”',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Verify audit trail' }).click();
  await expect(page.getByText(/Audit trail intact/)).toBeVisible();
});
