import { describe, expect, it } from 'vitest';
import '../fields/registry';
import { makeCtx, makeField, makeItem, NOW, sheet } from '../testing/fixtures';
import { matchTrigger, planActions, type AutomationEvent } from '../automations';
import { activityText } from '../activity';
import type { Automation } from '../types';
import {
  approvalState,
  approvalTimeline,
  approvalWorkflowSchema,
  decide,
  decisionProblem,
  describeApprovers,
  inboxRows,
  isApprovalOverdue,
  overdueOccurrence,
  planApprovalFirings,
  readWorkflows,
  resolveApprovers,
  slaDue,
  stepApprovers,
  stepFieldOptions,
  stepOption,
  submitCheck,
  templateWorkflowSchema,
  waitingOn,
  workflowIdFor,
  workflowProblems,
  type ApprovalDecision,
  type ApprovalInstance,
  type ApprovalWorkflow,
} from '.';

const owner = makeField('people', { multiple: false }, { key: 'owner', name: 'Owner' });
const reviewers = makeField('people', { multiple: true }, { key: 'reviewers', name: 'Reviewers' });
const summary = makeField('text', {}, { key: 'summary', name: 'Summary' });
const status = makeField(
  'status',
  {
    options: [
      { id: 'opt_draft', label: 'Draft', color: 'grey' },
      { id: 'opt_review', label: 'In review', color: 'orange' },
      { id: 'opt_ok', label: 'Approved', color: 'green', done: true },
    ],
  },
  { key: 'status', name: 'Status' },
);
const step = makeField(
  'workflowstep',
  {
    options: [
      { id: 'opt_draft', label: 'Draft', color: 'grey' },
      { id: 'opt_review', label: 'Review', color: 'blue' },
      { id: 'opt_approval', label: 'Approval', color: 'purple' },
      { id: 'opt_done', label: 'Done', color: 'green', done: true },
    ],
  },
  { key: 'step', name: 'Workflow step' },
);
const fields = [owner, reviewers, summary, status, step];

const holders = (name: string) => (name === 'Compliance manager' ? ['u-james'] : []);

function workflow(over: Partial<ApprovalWorkflow> = {}): ApprovalWorkflow {
  return approvalWorkflowSchema.parse({
    id: 'doc',
    name: 'Document approval',
    enabled: true,
    requiredFields: ['summary'],
    allowSelfApproval: false,
    lockOnApproval: true,
    stepField: { fieldKey: 'step', draft: 'opt_draft', approved: 'opt_done', rejected: null },
    statusField: {
      fieldKey: 'status',
      onSubmit: 'opt_review',
      onApproved: 'opt_ok',
      onRejected: 'opt_draft',
    },
    steps: [
      {
        id: 'review',
        name: 'Review',
        approvers: { kind: 'field', fieldKey: 'owner' },
        mode: 'any',
        sla: { amount: 2, unit: 'days' },
        onReject: { to: 'draft' },
        optionId: 'opt_review',
      },
      {
        id: 'approval',
        name: 'Approval',
        approvers: { kind: 'jobRole', roleId: 'r-cm', roleName: 'Compliance manager' },
        mode: 'all',
        sla: { amount: 8, unit: 'hours' },
        onReject: { to: 'step', stepId: 'review' },
        optionId: 'opt_approval',
      },
    ],
    ...over,
  });
}

const ctxWith = (items = [makeItem()]) => makeCtx({ fields, items });

function instance(over: Partial<ApprovalInstance> = {}): ApprovalInstance {
  return {
    id: 'inst-1',
    sheetId: sheet.id,
    itemId: 'i-doc',
    workflowId: 'doc',
    definition: workflow(),
    status: 'in_progress',
    stepIndex: 0,
    round: 1,
    stepStartedAt: '2026-11-10T09:00:00Z',
    stepDueAt: '2026-11-12T09:00:00Z',
    approvers: [['u-maria'], ['u-james', 'u-vic']],
    submittedBy: 'u-vic',
    submittedAt: '2026-11-10T09:00:00Z',
    endedAt: null,
    endedBy: null,
    endReason: null,
    ...over,
  };
}

function decision(over: Partial<ApprovalDecision>): ApprovalDecision {
  return {
    id: `d-${Math.random()}`,
    instanceId: 'inst-1',
    stepIndex: 0,
    stepId: 'review',
    stepName: 'Review',
    round: 1,
    userId: 'u-maria',
    decision: 'approved',
    comment: null,
    decidedAt: '2026-11-10T10:00:00Z',
    ...over,
  };
}

describe('definitions', () => {
  it('reads sheet settings leniently and drops broken or repeated workflows', () => {
    const good = workflow();
    expect(readWorkflows({ workflows: [good, { id: 'x' }, good] })).toEqual([good]);
    expect(readWorkflows({})).toEqual([]);
    expect(readWorkflows(null)).toEqual([]);
  });

  it('checks fields, step references and options against the sheet', () => {
    expect(workflowProblems(workflow(), fields)).toEqual([]);
    const bad = workflow({
      requiredFields: ['nope'],
      steps: [
        {
          id: 'a',
          name: 'A',
          approvers: { kind: 'field', fieldKey: 'summary' },
          mode: 'any',
          onReject: { to: 'step', stepId: 'b' },
        },
        {
          id: 'b',
          name: 'B',
          approvers: { kind: 'team', teamName: 'IT' },
          mode: 'any',
          onReject: { to: 'close' },
        },
      ],
      stepField: null,
    });
    expect(workflowProblems(bad, fields)).toEqual([
      'Step 1, A: choose a people field for the approvers.',
      'Step 1, A: a rejection can go back to this step or an earlier one.',
      'The field nope cannot be required before submitting.',
    ]);
    expect(
      workflowProblems(
        workflow({ statusField: { fieldKey: 'status', onApproved: 'opt_gone' } }),
        fields,
      ),
    ).toEqual(['Status no longer has every option the workflow sets.']);
  });

  it('never takes approvers from, or requires, a field only the approval fills in', () => {
    // a documents register's Approver and Approved on (approvalRecordKeys): empty until the approval finishes
    const w = workflow({ requiredFields: ['owner'] });
    expect(workflowProblems(w, fields, [], ['owner'])).toEqual([
      'Step 1, Review: Owner is filled in only when the approval finishes. Choose a people field that is filled in before submitting.',
      'Owner is filled in only when the approval finishes, so it cannot be required before submitting.',
    ]);
    expect(workflowProblems(w, fields, [], ['reviewers_on'])).toEqual([]);
  });

  it('keeps people and ids out of pack manifests', () => {
    const w = workflow();
    expect(templateWorkflowSchema.safeParse(w).success).toBe(false); // roleId given
    const ok = {
      ...w,
      steps: [
        { ...w.steps[0], approvers: { kind: 'field', fieldKey: 'owner' } },
        { ...w.steps[1], approvers: { kind: 'jobRole', roleName: 'Top management' } },
      ],
    };
    expect(templateWorkflowSchema.safeParse(ok).success).toBe(true);
    const people = {
      ...ok,
      steps: [{ ...ok.steps[0], approvers: { kind: 'people', userIds: ['u-1'] } }],
    };
    expect(templateWorkflowSchema.safeParse(people).success).toBe(false);
  });

  it('maps the step field by label and adds the missing options before the done one', () => {
    let n = 0;
    const w = workflow({
      steps: [
        { ...workflow().steps[0]!, name: 'Review' },
        { ...workflow().steps[1]!, name: 'Sign-off' },
      ],
    });
    const { options, mapping } = stepFieldOptions(w, step, () => `opt_new${++n}`);
    expect(mapping).toEqual({
      draft: 'opt_draft',
      approved: 'opt_done',
      rejected: 'opt_new2',
      steps: ['opt_review', 'opt_new1'],
    });
    expect(options.map((o) => o.label)).toEqual([
      'Draft',
      'Review',
      'Approval',
      'Sign-off',
      'Rejected',
      'Done',
    ]);
  });

  it('makes ids from names', () => {
    expect(workflowIdFor('Document approval', [])).toBe('document-approval');
    expect(workflowIdFor('Document approval', ['document-approval'])).toBe('document-approval-2');
    expect(workflowIdFor('!!!', [])).toBe('approval');
  });
});

describe('approver resolution', () => {
  const item = makeItem({
    [owner.id]: ['u-maria'],
    [reviewers.id]: ['u-james', 'u-gone', 'u-maria'],
  });
  const ctx = ctxWith([item]);
  it('resolves people, a people field, a job role and a team, members only', () => {
    expect(
      resolveApprovers({ kind: 'people', userIds: ['u-vic', 'u-x'] }, item, ctx, holders),
    ).toEqual(['u-vic']);
    expect(resolveApprovers({ kind: 'field', fieldKey: 'reviewers' }, item, ctx, holders)).toEqual([
      'u-james',
      'u-maria',
    ]);
    expect(
      resolveApprovers(
        { kind: 'jobRole', roleId: 'r-cm', roleName: 'Old name' },
        item,
        ctx,
        holders,
      ),
    ).toEqual(['u-james']);
    expect(
      resolveApprovers({ kind: 'jobRole', roleName: 'Compliance manager' }, item, ctx, holders),
    ).toEqual(['u-james']);
    expect(resolveApprovers({ kind: 'team', teamName: 'quality' }, item, ctx, holders)).toEqual([
      'u-maria',
      'u-vic',
    ]);
    expect(
      resolveApprovers({ kind: 'team', teamId: 't-it', teamName: 'x' }, item, ctx, holders),
    ).toEqual(['u-james']);
  });

  it('describes approvers in words', () => {
    expect(describeApprovers({ kind: 'field', fieldKey: 'owner' }, ctx)).toBe(
      'the people in Owner',
    );
    expect(describeApprovers({ kind: 'jobRole', roleId: 'r-cm', roleName: 'x' }, ctx)).toBe(
      'Compliance manager (job role)',
    );
    expect(describeApprovers({ kind: 'people', userIds: ['u-maria', 'u-james'] }, ctx)).toBe(
      'Maria Pereira and James Okafor',
    );
  });

  it('blocks self-approval: the submitter is not an approver unless the workflow allows it', () => {
    const w = workflow({
      steps: [{ ...workflow().steps[0]!, approvers: { kind: 'field', fieldKey: 'reviewers' } }],
    });
    expect(stepApprovers(w, 0, item, ctx, { submitter: 'u-maria', holders })).toEqual({
      ids: ['u-james'],
      withoutSubmitter: true,
    });
    expect(
      stepApprovers({ ...w, allowSelfApproval: true }, 0, item, ctx, {
        submitter: 'u-maria',
        holders,
      }).ids,
    ).toEqual(['u-james', 'u-maria']);
    expect(stepApprovers(w, 0, item, ctx, { submitter: null, holders }).withoutSubmitter).toBe(
      false,
    );
  });
});

describe('submitting', () => {
  const ctx = ctxWith();
  const canRead = () => true;
  it('fixes the approvers of every step', () => {
    const item = makeItem({ [owner.id]: ['u-maria'], [summary.id]: 'Policy' });
    expect(submitCheck(workflow(), item, ctx, { submitter: 'u-vic', holders, canRead })).toEqual({
      ok: true,
      approvers: [['u-maria'], ['u-james']],
    });
  });

  it('reports empty required fields, steps without approvers and approvers without access', () => {
    const item = makeItem({ [owner.id]: ['u-maria'] });
    const r = submitCheck(workflow(), item, ctx, {
      submitter: 'u-maria',
      holders: () => ['u-james'],
      canRead: (id) => id !== 'u-james',
      inProgress: true,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems).toEqual([
      'This item is already waiting for approval.',
      'Fill in Summary before submitting.',
      'Step 1, Review: you are the only approver and cannot approve your own submission.',
      'Step 2, Approval: James Okafor cannot open this sheet. Give them access or change the approvers.',
    ]);
    const nobody = submitCheck(workflow(), makeItem({ [summary.id]: 'x' }), ctx, {
      submitter: 'u-vic',
      holders: () => [],
      canRead,
    });
    expect(!nobody.ok && nobody.problems).toEqual([
      'Step 1, Review: no one can approve it. Fill in Owner.',
      'Step 2, Approval: no one can approve it. Give a member the job title Compliance manager.',
    ]);
  });
});

describe('deciding', () => {
  it('any one approval moves to the next step; the last approval ends it', () => {
    expect(decide(instance(), [], { userId: 'u-maria', decision: 'approved' })).toEqual({
      kind: 'next',
      stepIndex: 1,
    });
    const last = instance({ stepIndex: 1 });
    expect(decide(last, [], { userId: 'u-james', decision: 'approved' })).toEqual({
      kind: 'waiting',
    });
    const vic = decision({ stepIndex: 1, stepId: 'approval', userId: 'u-vic' });
    expect(decide(last, [vic], { userId: 'u-james', decision: 'approved' })).toEqual({
      kind: 'approved',
    });
    // an approval from an earlier round does not count
    expect(
      decide({ ...last, round: 2 }, [vic], { userId: 'u-james', decision: 'approved' }),
    ).toEqual({
      kind: 'waiting',
    });
  });

  it('a rejection goes back to a step, to draft or closes, as the step says', () => {
    expect(decide(instance(), [], { userId: 'u-maria', decision: 'rejected' })).toEqual({
      kind: 'rejected',
      to: 'draft',
    });
    expect(
      decide(instance({ stepIndex: 1 }), [], { userId: 'u-james', decision: 'rejected' }),
    ).toEqual({
      kind: 'returned',
      stepIndex: 0,
    });
    const closing = workflow({
      steps: [{ ...workflow().steps[0]!, onReject: { to: 'close' } }],
    });
    expect(
      decide(instance({ definition: closing }), [], { userId: 'u-maria', decision: 'rejected' }),
    ).toEqual({ kind: 'rejected', to: 'closed' });
  });

  it('refuses self-approval, strangers, a second decision and a rejection without a reason', () => {
    const inst = instance({ approvers: [['u-maria', 'u-vic'], ['u-james']] });
    expect(decisionProblem(inst, [], 'u-vic', 'approved', null)).toBe(
      'You submitted this item and cannot approve your own submission.',
    );
    expect(
      decisionProblem(
        { ...inst, definition: { ...inst.definition, allowSelfApproval: true } },
        [],
        'u-vic',
        'approved',
        null,
      ),
    ).toBeNull();
    expect(decisionProblem(inst, [], 'u-james', 'approved', null)).toBe(
      'You are not an approver of this step.',
    );
    expect(decisionProblem(inst, [decision({})], 'u-maria', 'approved', null)).toBe(
      'You have already decided on this step.',
    );
    expect(decisionProblem(inst, [], 'u-maria', 'rejected', '  ')).toBe('Say why you reject it.');
    expect(decisionProblem(inst, [], 'u-maria', 'rejected', 'Wrong scope')).toBeNull();
    expect(
      decisionProblem(
        { ...inst, status: 'approved', stepIndex: null },
        [],
        'u-maria',
        'approved',
        null,
      ),
    ).toBe('This approval has already ended.');
  });

  it('knows who it still waits on', () => {
    const inst = instance({ stepIndex: 1 });
    expect(waitingOn(inst, [decision({ stepIndex: 1, userId: 'u-vic' })])).toEqual(['u-james']);
  });

  it('shows the step field option for where the item is', () => {
    const w = workflow();
    expect(stepOption(w, { status: 'in_progress', stepIndex: 1 })).toBe('opt_approval');
    expect(stepOption(w, { status: 'approved', stepIndex: null })).toBe('opt_done');
    expect(stepOption(w, { status: 'rejected', stepIndex: null, endReason: 'draft' })).toBe(
      'opt_draft',
    );
    expect(stepOption(w, { status: 'rejected', stepIndex: null, endReason: 'closed' })).toBe(
      'opt_draft',
    );
    expect(
      stepOption({ ...w, stepField: null }, { status: 'approved', stepIndex: null }),
    ).toBeNull();
  });
});

describe('SLA', () => {
  it('works out when a step is due, in calendar hours and days', () => {
    expect(slaDue('2026-11-10T09:00:00Z', { amount: 2, unit: 'days' })).toBe(
      '2026-11-12T09:00:00.000Z',
    );
    expect(slaDue('2026-11-10T09:00:00Z', { amount: 8, unit: 'hours' })).toBe(
      '2026-11-10T17:00:00.000Z',
    );
    expect(slaDue('2026-11-10T09:00:00Z', null)).toBeNull();
  });

  it('is overdue once the due moment passes, while in progress', () => {
    expect(isApprovalOverdue(instance({ stepDueAt: '2026-11-11T11:59:00Z' }), NOW)).toBe(true);
    expect(isApprovalOverdue(instance({ stepDueAt: '2026-11-11T12:01:00Z' }), NOW)).toBe(false);
    expect(
      isApprovalOverdue(instance({ status: 'approved', stepDueAt: '2026-11-01T00:00:00Z' }), NOW),
    ).toBe(false);
  });

  it('plans one firing per instance, round and step, within the last 7 days', () => {
    const item = makeItem({}, { id: 'i-doc' });
    const ctx = ctxWith([item]);
    const auto = {
      id: 'a-1',
      sheetId: sheet.id,
      trigger: { type: 'approval_overdue' as const, workflowId: null },
      conditions: [],
    };
    const late = instance({ stepDueAt: '2026-11-11T08:00:00Z' });
    const old = instance({ id: 'inst-2', stepDueAt: '2026-10-01T08:00:00Z' });
    const notYet = instance({ id: 'inst-3', stepDueAt: '2026-11-12T08:00:00Z' });
    const firings = planApprovalFirings([auto], [late, old, notYet], [item], ctx, () => false);
    expect(firings.map((f) => f.occurrence)).toEqual(['approval:inst-1:1:0']);
    expect(overdueOccurrence({ id: 'x', round: 2, stepIndex: 1 })).toBe('approval:x:2:1');
    expect(
      planApprovalFirings(
        [{ ...auto, trigger: { type: 'approval_overdue', workflowId: 'other' } }],
        [late],
        [item],
        ctx,
        () => false,
      ),
    ).toEqual([]);
    expect(planApprovalFirings([auto], [late], [item], ctx, () => true)).toEqual([]);
  });
});

describe('timeline and inbox', () => {
  const ctx = ctxWith();
  it('says where an approval is, with a symbol', () => {
    expect(approvalState(null, ctx)).toEqual({
      symbol: 'draft',
      text: 'Not submitted for approval',
      detail: null,
    });
    expect(
      approvalState(instance({ stepIndex: 1, stepDueAt: '2026-11-11T10:00:00Z' }), ctx),
    ).toEqual({
      symbol: 'overdue',
      text: 'Waiting for approval: step 2 of 2, Approval',
      detail: 'Due 11 Nov 2026, 10:00 · overdue',
    });
    expect(
      approvalState(
        instance({
          status: 'rejected',
          stepIndex: null,
          endReason: 'draft',
          endedBy: 'u-james',
          endedAt: '2026-11-11T09:00:00Z',
        }),
        ctx,
      ).text,
    ).toBe('Rejected and back to draft (Document approval)');
  });

  it('lists steps with who decided, when and why, and earlier rounds', () => {
    const inst = instance({ stepIndex: 0, round: 2 });
    const t = approvalTimeline(
      inst,
      [
        decision({ userId: 'u-maria', round: 1, decidedAt: '2026-11-10T10:00:00Z' }),
        decision({
          stepIndex: 1,
          stepId: 'approval',
          stepName: 'Approval',
          userId: 'u-james',
          decision: 'rejected',
          comment: 'Missing the scope',
          round: 1,
          decidedAt: '2026-11-10T11:00:00Z',
        }),
      ],
      ctx,
    );
    expect(t.steps.map((s) => s.state)).toEqual(['current', 'upcoming']);
    expect(t.steps[0]!.people).toEqual([
      { id: 'u-maria', name: 'Maria Pereira', decision: null, at: null, comment: null },
    ]);
    expect(t.steps[0]!.earlier[0]!.round).toBe(1);
    expect(t.steps[1]!.people[0]).toMatchObject({
      decision: 'rejected',
      comment: 'Missing the scope',
    });
    expect(t.events.map((e) => e.text)).toEqual([
      'Vic Viewer submitted it for approval',
      'Maria Pereira approved step 1, Review',
      'James Okafor rejected step 2, Approval',
    ]);
    const done = approvalTimeline(
      instance({ status: 'approved', stepIndex: null, endedAt: '2026-11-11T09:00:00Z' }),
      [],
      ctx,
    );
    expect(done.steps.map((s) => s.state)).toEqual(['done', 'done']);
    expect(done.events.at(-1)!.text).toBe('Approved: every step is done. The item is locked.');
  });

  it('lists what waits for me, overdue first, never my own submissions', () => {
    const look = {
      item: (id: string) => ({ displayId: id.toUpperCase(), name: 'Policy', sheetId: sheet.id }),
      sheetName: () => 'ISMS documents',
      isRegister: () => true,
    };
    const rows = inboxRows(
      [
        instance({
          id: 'a',
          itemId: 'i-a',
          stepStartedAt: '2026-11-09T09:00:00Z',
          stepDueAt: null,
        }),
        instance({ id: 'b', itemId: 'i-b', stepDueAt: '2026-11-11T09:00:00Z' }),
        instance({ id: 'c', itemId: 'i-c', submittedBy: 'u-maria' }),
        instance({ id: 'd', itemId: 'i-d', stepIndex: 1, approvers: [['u-maria'], ['u-maria']] }),
      ],
      [decision({ instanceId: 'd', stepIndex: 1, userId: 'u-maria' })],
      'u-maria',
      look,
      ctx,
    );
    expect(rows.map((r) => [r.instanceId, r.overdue])).toEqual([
      ['b', true],
      ['a', false],
    ]);
    expect(rows[0]).toMatchObject({
      displayId: 'I-B',
      stepName: 'Review',
      submittedBy: 'Vic Viewer',
      commentToApprove: false,
    });
  });
});

describe('automations', () => {
  const ctx = makeCtx(
    { fields, items: [makeItem({}, { id: 'i-doc' })] },
    { sheet: { ...sheet, workflows: [workflow()] } },
  );
  const event = (
    kind: 'decided' | 'approved' | 'rejected',
    decision: 'approved' | 'rejected',
  ): AutomationEvent => ({
    type: 'workflow.event',
    sheetId: sheet.id,
    itemId: 'i-doc',
    kind,
    workflowId: 'doc',
    instanceId: 'inst-1',
    stepIndex: 0,
    stepId: 'review',
    decision,
    actor: { kind: 'user', id: 'u-maria' },
  });
  const t = (trigger: Record<string, unknown>) => trigger as Automation['trigger'];

  it('matches step decided, approved and rejected, by workflow and decision', () => {
    expect(
      matchTrigger(
        t({ type: 'workflow_step_decided', workflowId: null }),
        event('decided', 'approved'),
        ctx,
      ),
    ).toBe(true);
    expect(
      matchTrigger(
        t({ type: 'workflow_step_decided', decision: 'rejected' }),
        event('decided', 'approved'),
        ctx,
      ),
    ).toBe(false);
    expect(
      matchTrigger(t({ type: 'workflow_step_decided' }), event('approved', 'approved'), ctx),
    ).toBe(false);
    expect(
      matchTrigger(
        t({ type: 'workflow_approved', workflowId: 'doc' }),
        event('approved', 'approved'),
        ctx,
      ),
    ).toBe(true);
    expect(
      matchTrigger(
        t({ type: 'workflow_approved', workflowId: 'other' }),
        event('approved', 'approved'),
        ctx,
      ),
    ).toBe(false);
    expect(matchTrigger(t({ type: 'workflow_rejected' }), event('rejected', 'rejected'), ctx)).toBe(
      true,
    );
    expect(matchTrigger(t({ type: 'workflow_rejected' }), event('approved', 'approved'), ctx)).toBe(
      false,
    );
    const schedule: AutomationEvent = {
      type: 'schedule',
      sheetId: sheet.id,
      itemId: 'i-doc',
      automationId: 'a-1',
      occurrence: 'approval:inst-1:1:0',
      actor: { kind: 'system', id: null },
    };
    expect(matchTrigger(t({ type: 'approval_overdue' }), schedule, ctx, 'a-1')).toBe(true);
    expect(matchTrigger(t({ type: 'approval_overdue' }), schedule, ctx, 'a-2')).toBe(false);
  });

  it('plans start_workflow with the chain person as the submitter', () => {
    const item = ctx.item('i-doc')!;
    const env = {
      appUrl: 'https://app',
      workspace: 'meridian',
      actor: { kind: 'user' as const, id: 'u-vic' },
      automation: { id: 'a-1', name: 'Submit', trigger: t({ type: 'item_created' }) },
      roleHolders: () => [],
    };
    const [step1] = planActions(
      [{ type: 'start_workflow', workflowId: 'doc' }],
      item,
      null,
      ctx,
      env,
    );
    expect(step1).toEqual({
      action: 'start_workflow',
      summary: 'Submit for approval: Document approval',
      effects: [
        { kind: 'start_workflow', itemId: 'i-doc', workflowId: 'doc', submittedBy: 'u-vic' },
      ],
    });
    const [missing] = planActions(
      [{ type: 'start_workflow', workflowId: 'gone' }],
      item,
      null,
      ctx,
      env,
    );
    expect(missing).toMatchObject({
      outcome: 'failed',
      message: 'This approval workflow no longer exists.',
    });
    const off = makeCtx(
      { fields, items: [item] },
      { sheet: { ...sheet, workflows: [workflow({ enabled: false })] } },
    );
    const [skipped] = planActions(
      [{ type: 'start_workflow', workflowId: 'doc' }],
      item,
      null,
      off,
      env,
    );
    expect(skipped).toMatchObject({
      outcome: 'skipped',
      message: 'Document approval is turned off.',
    });
  });
});

describe('activity log lines', () => {
  const look = {
    ctx: ctxWith(),
    field: () => undefined,
    groupName: () => undefined,
    displayId: () => undefined,
    personName: () => undefined,
  };
  const entry = (action: string, newValue: Record<string, unknown>, note: string | null = null) =>
    activityText(
      {
        id: 1,
        at: '2026-11-11T10:00:00Z',
        actorKind: 'user',
        actorId: 'u-maria',
        action,
        fieldId: null,
        oldValue: null,
        newValue: newValue as never,
        note,
        hash: 'x',
      },
      look,
    );
  it('words submissions, decisions and the end', () => {
    expect(
      entry(
        'workflow.submitted',
        { workflow: 'Document approval', steps: ['Review', 'Approval'] },
        'Ready',
      ),
    ).toBe('Submitted for approval: Document approval (2 steps) · Note: “Ready”');
    expect(
      entry(
        'workflow.decided',
        { workflow: 'Document approval', step_index: 1, step: 'Approval', decision: 'rejected' },
        'Missing scope',
      ),
    ).toBe('Rejected step 2, Approval of Document approval · Comment: “Missing scope”');
    expect(entry('workflow.approved', { workflow: 'Document approval' })).toBe(
      'Approval complete: Document approval',
    );
    expect(
      entry('workflow.rejected', { workflow: 'Document approval', end_reason: 'closed' }),
    ).toBe('Rejected and closed: Document approval');
    expect(entry('workflow.withdrawn', { workflow: 'Document approval' })).toBe(
      'Withdrew the approval: Document approval',
    );
  });
});
