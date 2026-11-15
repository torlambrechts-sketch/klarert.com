import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import {
  actionFields,
  autoName,
  availableActions,
  availableTriggers,
  becomesKey,
  defaultTrigger,
  describeAutomation,
  describeCondition,
  draftProblems,
  emptyDraft,
  insertTemplateKey,
  peopleFields,
  selfTriggering,
  templateKeys,
  templateQuery,
  testOnItem,
  triggerFields,
  type AutomationDraft,
} from '.';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const f = {
  status: makeField('status', FIELD_TYPES.status.defaultConfig(), {
    key: 'status',
    name: 'Status',
    position: 'a0',
  }),
  owner: makeField('people', { multiple: true }, { key: 'owner', name: 'Owner', position: 'a1' }),
  done_on: makeField('date', { relative: false }, { key: 'done_on', name: 'Date', position: 'a2' }),
  version: makeField('version', {}, { key: 'version', name: 'Version', position: 'a3' }),
  notes: makeField('text', {}, { key: 'notes', name: 'Notes', position: 'a4' }),
  score: makeField(
    'formula',
    { expr: '{likelihood} * 2', result: 'number' },
    { key: 'score', name: 'Score', position: 'a5' },
  ),
  likelihood: makeField(
    'number',
    { decimals: 0 },
    { key: 'likelihood', name: 'Likelihood', position: 'a6' },
  ),
  send: makeField('button', { label: 'Send' }, { key: 'send', name: 'Send', position: 'a7' }),
  controls: makeField(
    'link',
    { targetSheetId: 's-controls', multiple: true, inverseFieldId: null },
    { key: 'controls', name: 'Controls', position: 'a8' },
  ),
};
const fields = Object.values(f);
const item = makeItem(
  { [f.status.id]: 'opt_wip', [f.owner.id]: ['u-maria'], [f.likelihood.id]: 4 },
  { id: 'i-1', displayId: 'CA-001', name: 'Guard on press 3' },
);
const ctx = makeCtx({ fields, items: [item] });
const env = {
  appUrl: 'https://app.test',
  workspace: 'meridian',
  automation: { id: 'a-test', name: 'Test', trigger: { type: 'item_created' as const } },
  roleHolders: () => [],
};

const draft = (over: Partial<AutomationDraft>): AutomationDraft => ({
  name: '',
  trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_done' },
  conditions: [],
  actions: [{ type: 'notify', to: ['field:owner'], message: '{id} {name}' }],
  ...over,
});

describe('compatibility filters', () => {
  it('offers trigger fields from def.triggers only', () => {
    expect(triggerFields('field_becomes', ctx).map((x) => x.key)).toEqual(['status', 'owner']);
    expect(triggerFields('number_above', ctx).map((x) => x.key)).toEqual(['score', 'likelihood']);
    expect(triggerFields('date_arrives', ctx).map((x) => x.key)).toEqual(['done_on']);
    // a formula watches a date only when its result is a date
    const deadline = makeField(
      'formula',
      { expr: 'ADDMONTHS({done_on}, 1)', result: 'date' },
      { key: 'deadline', name: 'Deadline', position: 'a9' },
    );
    const withDeadline = makeCtx({ fields: [...Object.values(f), deadline] });
    expect(triggerFields('date_arrives', withDeadline).map((x) => x.key)).toEqual([
      'done_on',
      'deadline',
    ]);
    expect(triggerFields('button_clicked', ctx).map((x) => x.key)).toEqual(['send']);
  });

  it('offers triggers that have a compatible field, and the ones without a field', () => {
    const t = availableTriggers(ctx);
    expect(t).toContain('item_created');
    expect(t).toContain('form_submitted');
    expect(t).toContain('button_clicked');
    expect(t).not.toContain('checklist_no');
    // every item has a Files tab, so evidence expiry is offered even without an evidence field (source item_files)
    expect(t).toContain('evidence_expiring');
    expect(availableTriggers(makeCtx({ fields: [f.notes] }))).not.toContain('field_becomes');
  });

  it("evidence_expiring can watch the item's Files tab instead of a field", () => {
    const t = {
      type: 'evidence_expiring' as const,
      source: 'item_files',
      fieldKey: null,
      days: 14,
    };
    expect(describeAutomation({ trigger: t, conditions: [], actions: [] }, ctx)).toBe(
      'When an item file expires within 14 days, then …',
    );
    expect(
      draftProblems({ name: 'x', trigger: t, conditions: [], actions: [{ type: 'notify' }] }, ctx)
        .trigger,
    ).toBeUndefined();
    expect(
      draftProblems(
        {
          name: 'x',
          trigger: { ...t, source: 'field' },
          conditions: [],
          actions: [{ type: 'notify' }],
        },
        ctx,
      ).trigger,
    ).toBe('Choose a field.');
  });

  it('set_field takes stored fields, assign people, raise_version version fields', () => {
    expect(actionFields('set_field', ctx).map((x) => x.key)).toEqual([
      'status',
      'owner',
      'done_on',
      'version',
      'notes',
      'likelihood',
    ]);
    expect(actionFields('assign', ctx).map((x) => x.key)).toEqual(['owner']);
    expect(actionFields('raise_version', ctx).map((x) => x.key)).toEqual(['version']);
    expect(actionFields('update_linked', ctx).map((x) => x.key)).toEqual(['controls']);
    expect(peopleFields(ctx).map((x) => x.key)).toEqual(['owner']);
  });

  it('hides actions whose field type the sheet does not have', () => {
    const plain = makeCtx({ fields: [f.notes] });
    expect(availableActions(plain)).not.toContain('assign');
    expect(availableActions(plain)).not.toContain('raise_version');
    expect(availableActions(plain)).toContain('notify');
    expect(availableActions(plain)).toContain('lock_item');
  });

  it('defaults a trigger to its first compatible field', () => {
    expect(defaultTrigger('number_below', ctx)).toEqual({
      type: 'number_below',
      fieldKey: 'score',
      threshold: 0,
    });
    expect(emptyDraft(ctx).trigger.type).toBe('field_becomes');
  });

  it('reads the key a field_becomes value picker commits', () => {
    expect(becomesKey(f.status, 'opt_done', ctx)).toBe('opt_done');
    expect(becomesKey(f.owner, ['u-maria', 'u-james'], ctx, 'u-maria')).toBe('u-james');
  });
});

describe('describe automation', () => {
  it('reads the whole rule as one sentence', () => {
    expect(describeAutomation(draft({}), ctx)).toBe('When Status becomes Done, then notify Owner.');
    expect(
      describeAutomation(
        draft({
          conditions: [{ fieldKey: 'status', op: 'is_any_of', value: ['opt_done'] }],
          actions: [{ type: 'lock_item' }, { type: 'post_update', message: 'x' }],
        }),
        ctx,
      ),
    ).toBe(
      'When Status becomes Done, and only if Status is any of Done, then lock and post an update.',
    );
    expect(describeAutomation(draft({ actions: [] }), ctx)).toBe(
      'When Status becomes Done, then …',
    );
  });
});

describe('auto name', () => {
  it('reads as a sentence', () => {
    expect(autoName(draft({}), ctx)).toBe('When Status becomes Done → notify Owner');
  });

  it('joins several actions and reads tokens', () => {
    expect(
      autoName(
        draft({
          actions: [
            { type: 'set_field', fieldKey: 'done_on', value: '$today' },
            { type: 'lock_item', reason: 'Done' },
          ],
        }),
        ctx,
      ),
    ).toBe('When Status becomes Done → set Date to Today and lock');
  });

  it('describes every trigger shape', () => {
    const name = (trigger: AutomationDraft['trigger']) =>
      autoName(draft({ trigger, actions: [{ type: 'post_update', message: 'x' }] }), ctx);
    expect(name({ type: 'item_created' })).toBe('When an action is created → post an update');
    expect(name({ type: 'field_changed', fieldKey: 'owner' })).toBe(
      'When Owner changes → post an update',
    );
    expect(name({ type: 'number_above', fieldKey: 'score', threshold: 12 })).toBe(
      'When Score goes above 12 → post an update',
    );
    expect(name({ type: 'date_arrives', fieldKey: 'done_on', offsetDays: -30 })).toBe(
      'When Date is 30 days away → post an update',
    );
    expect(name({ type: 'date_arrives', fieldKey: 'done_on', offsetDays: 1 })).toBe(
      'When Date is 1 day past → post an update',
    );
    expect(name({ type: 'button_clicked', fieldKey: 'send' })).toBe(
      'When Send is clicked → post an update',
    );
  });

  it('reads relative dates', () => {
    expect(
      autoName(
        draft({ actions: [{ type: 'set_field', fieldKey: 'done_on', value: '$in:14' }] }),
        ctx,
      ),
    ).toBe('When Status becomes Done → set Date to 14 days from today');
  });

  it('names target sheets and people', () => {
    expect(
      autoName(
        draft({
          actions: [
            { type: 'create_item', sheetId: 's-x', name: 'x' },
            { type: 'assign', fieldKey: 'owner', who: 'user:u-james' },
            { type: 'notify', to: ['user:u-maria', 'actor'], message: '' },
          ],
        }),
        ctx,
        (id) => (id === 's-x' ? 'Follow-ups' : undefined),
      ),
    ).toBe(
      'When Status becomes Done → create an item on Follow-ups, assign James Okafor to Owner and notify Maria Pereira and the person who made the change',
    );
  });
});

describe('validation and the self-trigger guard', () => {
  it('accepts a complete draft', () => {
    expect(draftProblems(draft({}), ctx)).toEqual({});
  });

  it('keeps a saved webhook address without showing it, and asks for one when there is none (0056)', () => {
    const saved = draft({
      actions: [{ type: 'webhook', urlRef: 'r1', urlHost: 'hooks.slack.com', preset: 'slack' }],
    });
    expect(draftProblems(saved, ctx)).toEqual({});
    const none = draft({ actions: [{ type: 'webhook', url: '', preset: 'generic' }] });
    expect(draftProblems(none, ctx)['actions.0']).toBe('Enter an address that starts with https://.');
  });

  it('flags a field_changed automation that sets its own field', () => {
    const d = draft({
      trigger: { type: 'field_changed', fieldKey: 'status' },
      actions: [
        { type: 'notify', to: ['field:owner'], message: '' },
        { type: 'set_field', fieldKey: 'status', value: 'opt_done' },
      ],
    });
    expect(selfTriggering(d)).toEqual([1]);
    expect(draftProblems(d, ctx)['actions.1']).toMatch(/^This would trigger itself/);
  });

  it('does not flag field_becomes on the same field (a transition, not an instant loop)', () => {
    const d = draft({ actions: [{ type: 'set_field', fieldKey: 'status', value: 'opt_stuck' }] });
    expect(selfTriggering(d)).toEqual([]);
  });

  it('needs a value, a field and at least one action', () => {
    const p = draftProblems(
      draft({ trigger: { type: 'field_becomes', fieldKey: 'status', value: null }, actions: [] }),
      ctx,
    );
    expect(p.trigger).toBe('Choose a value.');
    expect(p.actions).toBe('Add an action.');
    expect(
      draftProblems(
        draft({ trigger: { type: 'number_above', fieldKey: 'notes', threshold: 1 } }),
        ctx,
      ).trigger,
    ).toBe('Notes cannot be used with this trigger.');
  });

  it('checks set_field values against the field and its tokens', () => {
    const p = (value: unknown, fieldKey = 'done_on') =>
      draftProblems(
        draft({ actions: [{ type: 'set_field', fieldKey, value: value as never }] }),
        ctx,
      )['actions.0'];
    expect(p('$today')).toBeUndefined();
    expect(p('$in:14')).toBeUndefined();
    expect(p('$empty')).toBeUndefined();
    expect(p('2026-12-01')).toBeUndefined();
    expect(p('not a date')).toBe('This value does not fit Date.');
    expect(p('$actor')).toBe('Date cannot take this value.');
    expect(p('$actor', 'owner')).toBeUndefined();
    expect(p(null)).toBe('Choose a value.');
  });

  it('checks conditions, recipients, webhooks and sheets', () => {
    const p = draftProblems(
      draft({
        conditions: [
          { fieldKey: 'status', op: 'is_any_of', value: [] },
          { fieldKey: 'gone', op: 'is_empty' },
          { fieldKey: 'status', op: 'is_not_done' },
        ],
        actions: [
          { type: 'notify', to: ['field:notes'], message: '' },
          { type: 'webhook', url: 'http://x.test', preset: 'generic' },
          { type: 'create_item', sheetId: 's-other', name: 'x' },
          { type: 'post_update', message: ' ' },
        ],
      }),
      ctx,
      { sheetIds: ['s-ca'] },
    );
    expect(p).toEqual({
      'conditions.0': 'Choose a value.',
      'conditions.1': 'Field "gone" no longer exists.',
      'actions.0': 'Choose a people field.',
      'actions.1': 'Enter an address that starts with https://.',
      'actions.2': 'Choose the sheet to create on.',
      'actions.3': 'Write the update to post.',
    });
  });
});

describe('test on an item', () => {
  it('shows the trigger, conditions and planned steps without writing', () => {
    const r = testOnItem(
      draft({
        trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_wip' },
        conditions: [{ fieldKey: 'owner', op: 'includes_any_of', value: ['u-maria'] }],
        actions: [
          { type: 'set_field', fieldKey: 'done_on', value: '$today' },
          { type: 'lock_item', reason: 'Done' },
        ],
      }),
      item,
      ctx,
      env,
    );
    expect(r.trigger).toEqual({
      check: 'matches',
      text: 'Status is Working on it, so this matches.',
    });
    expect(r.conditions).toEqual([{ text: 'Owner includes any of Maria Pereira', ok: true }]);
    expect(r.wouldRun).toBe(true);
    expect(r.steps.map((s) => s.summary)).toEqual([
      'Set Date to 11 Nov 2026',
      'Lock the item: Done',
    ]);
    // nothing changed
    expect(item.values[f.done_on.id]).toBeUndefined();
    expect(item.locked).toBe(false);
  });

  it('reports a trigger that does not match and a false condition', () => {
    const r = testOnItem(
      draft({ conditions: [{ fieldKey: 'status', op: 'is_done' }] }),
      item,
      ctx,
      env,
    );
    expect(r.trigger.check).toBe('no_match');
    expect(r.trigger.text).toBe('Status is Working on it, so this does not match.');
    expect(r.conditions).toEqual([{ text: 'Status is done', ok: false }]);
    expect(r.wouldRun).toBe(false);
    expect(r.steps[0]?.summary).toBe('Notify Maria Pereira');
  });

  it('computes number triggers on formulas and date moments', () => {
    expect(
      testOnItem(
        draft({ trigger: { type: 'number_above', fieldKey: 'score', threshold: 7 } }),
        item,
        ctx,
        env,
      ).trigger.check,
    ).toBe('matches');
    const dated = makeItem({ [f.done_on.id]: '2026-12-01' }, { id: 'i-2' });
    const c2 = makeCtx({ fields, items: [dated] });
    const t = (offsetDays: number) =>
      testOnItem(
        draft({ trigger: { type: 'date_arrives', fieldKey: 'done_on', offsetDays } }),
        dated,
        c2,
        env,
      ).trigger;
    expect(t(-30)).toEqual({
      check: 'matches',
      text: 'The moment, 1 Nov 2026, has passed. Date checks would run it for this item.',
    });
    expect(t(0)).toEqual({ check: 'no_match', text: 'The moment is 1 Dec 2026, still to come.' });
  });

  it('treats events as happening now', () => {
    const r = testOnItem(draft({ trigger: { type: 'item_created' } }), item, ctx, env);
    expect(r.trigger.check).toBe('event');
    expect(r.wouldRun).toBe(true);
  });
});

describe('conditions in words and template keys', () => {
  it('describes conditions', () => {
    expect(
      describeCondition({ fieldKey: '__group', op: 'is_any_of', value: ['g-open'] }, ctx),
    ).toBe('Group is any of Open');
    expect(describeCondition({ fieldKey: 'done_on', op: 'next_days', value: 7 }, ctx)).toBe(
      'Date is in the next 7 days',
    );
  });

  it('offers the built-in keys, then field keys, and inserts at the caret', () => {
    const keys = templateKeys(ctx).map((k) => k.key);
    expect(keys.slice(0, 6)).toEqual(['name', 'id', 'sheet', 'group', 'link', 'actor']);
    expect(keys).toContain('status');
    expect(templateQuery('Hello {sta', 10)).toEqual({ start: 6, query: 'sta' });
    expect(templateQuery('Hello {name} x', 14)).toBeNull();
    expect(insertTemplateKey('Hello {sta and', 10, 'status')).toEqual({
      text: 'Hello {status} and',
      caret: 14,
    });
  });
});
