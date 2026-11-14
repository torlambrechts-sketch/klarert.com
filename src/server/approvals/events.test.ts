import { describe, expect, it } from 'vitest';
import { approvalChangeEvents, decisionEvents } from './events';

const actor = { kind: 'user' as const, id: 'u-maria' };

describe('approval events', () => {
  const data = {
    instance_id: 'inst-1',
    workflow_id: 'doc',
    status: 'approved',
    outcome: 'approved',
    step_index: 1,
    step_id: 'approval',
    changes: [{ field_id: 'f-status', before: 'opt_review', after: 'opt_ok' }],
  };

  it('emits value.changed for each field the move changed', () => {
    expect(approvalChangeEvents(data, 's-1', 'i-1', actor)).toEqual([
      {
        type: 'value.changed',
        sheetId: 's-1',
        itemId: 'i-1',
        fieldId: 'f-status',
        before: 'opt_review',
        after: 'opt_ok',
        actor,
      },
    ]);
    expect(approvalChangeEvents(null, 's-1', 'i-1', actor)).toEqual([]);
  });

  it('emits the step decided, the changes, then approved', () => {
    const events = decisionEvents(data, 'approved', 's-1', 'i-1', actor);
    expect(events.map((e) => (e.type === 'workflow.event' ? e.kind : e.type))).toEqual([
      'decided',
      'value.changed',
      'approved',
    ]);
    expect(events[0]).toMatchObject({
      workflowId: 'doc',
      instanceId: 'inst-1',
      stepIndex: 1,
      stepId: 'approval',
      decision: 'approved',
    });
  });

  it('emits rejected when a rejection ends it, and nothing more while it goes on', () => {
    const kinds = (outcome: string) =>
      decisionEvents({ ...data, outcome, changes: [] }, 'rejected', 's-1', 'i-1', actor).map((e) =>
        e.type === 'workflow.event' ? e.kind : e.type,
      );
    expect(kinds('rejected')).toEqual(['decided', 'rejected']);
    expect(kinds('returned')).toEqual(['decided']);
    expect(kinds('waiting')).toEqual(['decided']);
  });
});
