import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { workflowstep } from './workflowstep';

describe('workflowstep', () => {
  contract(workflowstep, {
    valid: [
      ['opt_review', 'opt_review'],
      ['Approval', 'opt_approval'],
      [' draft ', 'opt_draft'],
    ],
    invalid: ['Published', 3, null, ''],
    parse: [
      ['Done', 'opt_done'],
      ['REVIEW', 'opt_review'],
      ['opt_draft', 'opt_draft'],
    ],
    text: [
      ['opt_approval', 'Approval'],
      ['opt_missing', ''],
    ],
    number: [['opt_done', null]],
    order: ['opt_draft', 'opt_approval'],
    done: [
      ['opt_done', true],
      ['opt_review', false],
      [null, false],
    ],
  });

  it('has Draft, Review, Approval and Done, and is never on a form', () => {
    // Only automations may set it; the SQL write path enforces that, the engine only keeps it off forms.
    expect(
      workflowstep.options!(workflowstep.defaultConfig(), undefined as never).map((o) => o.label),
    ).toEqual(['Draft', 'Review', 'Approval', 'Done']);
    expect(workflowstep.formAllowed).toBe(false);
    expect(workflowstep.kanbanCapable).toBe(true);
  });
});
