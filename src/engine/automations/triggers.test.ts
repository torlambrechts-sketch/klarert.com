import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import type { Automation, Json } from '../types';
import {
  computedChanges,
  computedTriggerFields,
  ctxBefore,
  itemBefore,
  matchTrigger,
  TRIGGERS,
  type Actor,
  type AutomationEvent,
} from '.';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const user: Actor = { kind: 'user', id: 'u-maria' };
const f = {
  status: makeField('status', FIELD_TYPES.status.defaultConfig(), { key: 'status' }),
  owner: makeField('people', { multiple: true }, { key: 'owner' }),
  tags: makeField(
    'multiselect',
    {
      options: [
        { id: 'opt_a', label: 'Safety', color: 'red' },
        { id: 'opt_b', label: 'Quality', color: 'blue' },
      ],
    },
    { key: 'tags' },
  ),
  approved: makeField('check', {}, { key: 'approved' }),
  answer: makeField('yesno', { allowNA: true }, { key: 'answer' }),
  applies: makeField('applicability', FIELD_TYPES.applicability.defaultConfig(), {
    key: 'applies',
  }),
  likelihood: makeField('number', { unit: '', decimals: 0 }, { key: 'likelihood' }),
  impact: makeField('number', { unit: '', decimals: 0 }, { key: 'impact' }),
  residual: makeField(
    'formula',
    { expr: '{likelihood} * {impact}', result: 'number' },
    { key: 'residual' },
  ),
  inspection: makeField(
    'checklist',
    {
      lines: [
        { id: 'l1', text: 'Guard fitted', noteOnNo: false },
        { id: 'l2', text: 'Sign visible', noteOnNo: false },
      ],
    },
    { key: 'inspection' },
  ),
  approve: makeField('button', { label: 'Approve' }, { key: 'approve' }),
  related: makeField(
    'link',
    { targetSheetId: 's-ca', multiple: true, inverseFieldId: null },
    { key: 'related' },
  ),
  review: makeField('date', { relative: false }, { key: 'review' }),
};
const fields = Object.values(f);
const ctx = makeCtx({ fields });
const item = makeItem({});

type Trigger = Automation['trigger'];
const trig = (type: Trigger['type'], rest: Record<string, Json> = {}) =>
  ({ type, ...rest }) as Trigger;

const changed = (fieldId: string, before: unknown, after: unknown): AutomationEvent => ({
  type: 'value.changed',
  sheetId: 's-ca',
  itemId: item.id,
  fieldId,
  before,
  after,
  actor: user,
});

describe('matchTrigger', () => {
  it('has a matcher for every trigger id', () => {
    expect(Object.keys(TRIGGERS).sort()).toEqual(
      [
        'button_clicked',
        'checklist_no',
        'clock_warning',
        'date_arrives',
        'evidence_expiring',
        'field_becomes',
        'field_changed',
        'form_submitted',
        'item_created',
        'number_above',
        'number_below',
        'subitem_created',
        'subitem_field_becomes',
        'all_subitems_done',
      ].sort(),
    );
  });

  it('item_created fires on item.created only', () => {
    const t = trig('item_created');
    expect(
      matchTrigger(t, { type: 'item.created', sheetId: 's-ca', itemId: 'i', actor: user }, ctx),
    ).toBe(true);
    expect(
      matchTrigger(
        t,
        { type: 'form.submitted', sheetId: 's-ca', itemId: 'i', formId: null, actor: user },
        ctx,
      ),
    ).toBe(false);
  });

  it('form_submitted: any form, or the named form', () => {
    const ev: AutomationEvent = {
      type: 'form.submitted',
      sheetId: 's-ca',
      itemId: 'i',
      formId: 'view-1',
      actor: { kind: 'form', id: null },
    };
    expect(matchTrigger(trig('form_submitted', { formId: null }), ev, ctx)).toBe(true);
    expect(matchTrigger(trig('form_submitted', { formId: 'view-1' }), ev, ctx)).toBe(true);
    expect(matchTrigger(trig('form_submitted', { formId: 'view-2' }), ev, ctx)).toBe(false);
  });

  it('field_changed: any real change of that field, including clearing it and links', () => {
    const t = trig('field_changed', { fieldKey: 'owner' });
    expect(matchTrigger(t, changed(f.owner.id, null, ['u-maria']), ctx)).toBe(true);
    expect(matchTrigger(t, changed(f.owner.id, ['u-maria'], null), ctx)).toBe(true);
    expect(matchTrigger(t, changed(f.owner.id, ['u-maria'], ['u-maria']), ctx)).toBe(false);
    expect(matchTrigger(t, changed(f.status.id, null, 'opt_done'), ctx)).toBe(false);
    const links = trig('field_changed', { fieldKey: 'related' });
    const ev = (before: string[], after: string[]): AutomationEvent => ({
      type: 'links.changed',
      sheetId: 's-ca',
      itemId: item.id,
      fieldId: f.related.id,
      before,
      after,
      actor: user,
    });
    expect(matchTrigger(links, ev([], ['i-2']), ctx)).toBe(true);
    expect(matchTrigger(links, ev(['i-2'], ['i-2']), ctx)).toBe(false);
  });

  it('field_changed on a field type that does not offer it never fires', () => {
    expect(
      matchTrigger(
        trig('field_changed', { fieldKey: 'residual' }),
        changed(f.residual.id, 1, 2),
        ctx,
      ),
    ).toBe(false);
  });

  it('field_becomes is a transition: the new value matches and the old did not', () => {
    const t = trig('field_becomes', { fieldKey: 'status', value: 'opt_done' });
    expect(matchTrigger(t, changed(f.status.id, 'opt_wip', 'opt_done'), ctx)).toBe(true);
    expect(matchTrigger(t, changed(f.status.id, null, 'opt_done'), ctx)).toBe(true);
    expect(matchTrigger(t, changed(f.status.id, 'opt_done', 'opt_done'), ctx)).toBe(false);
    expect(matchTrigger(t, changed(f.status.id, 'opt_done', 'opt_wip'), ctx)).toBe(false);
  });

  it('field_becomes on multi and people fields: the value was added', () => {
    const tag = trig('field_becomes', { fieldKey: 'tags', value: 'opt_a' });
    expect(matchTrigger(tag, changed(f.tags.id, ['opt_b'], ['opt_b', 'opt_a']), ctx)).toBe(true);
    expect(matchTrigger(tag, changed(f.tags.id, ['opt_a'], ['opt_a', 'opt_b']), ctx)).toBe(false);
    const person = trig('field_becomes', { fieldKey: 'owner', value: 'u-james' });
    expect(
      matchTrigger(person, changed(f.owner.id, ['u-maria'], ['u-maria', 'u-james']), ctx),
    ).toBe(true);
    expect(matchTrigger(person, changed(f.owner.id, ['u-james'], []), ctx)).toBe(false);
  });

  it('field_becomes on check, yes/no and applicability', () => {
    const on = trig('field_becomes', { fieldKey: 'approved', value: true });
    expect(matchTrigger(on, changed(f.approved.id, null, true), ctx)).toBe(true);
    expect(matchTrigger(on, changed(f.approved.id, false, true), ctx)).toBe(true);
    expect(matchTrigger(on, changed(f.approved.id, true, false), ctx)).toBe(false);
    const off = trig('field_becomes', { fieldKey: 'approved', value: false });
    expect(matchTrigger(off, changed(f.approved.id, true, false), ctx)).toBe(true);
    const no = trig('field_becomes', { fieldKey: 'answer', value: 'no' });
    expect(matchTrigger(no, changed(f.answer.id, 'yes', 'no'), ctx)).toBe(true);
    expect(matchTrigger(no, changed(f.answer.id, 'no', 'na'), ctx)).toBe(false);
    const na = trig('field_becomes', { fieldKey: 'applies', value: 'not_applicable' });
    expect(
      matchTrigger(
        na,
        changed(f.applies.id, { applicable: true, reason: '' }, { applicable: false, reason: 'x' }),
        ctx,
      ),
    ).toBe(true);
    expect(
      matchTrigger(
        na,
        changed(
          f.applies.id,
          { applicable: false, reason: '' },
          { applicable: false, reason: 'y' },
        ),
        ctx,
      ),
    ).toBe(false);
  });

  it('number_above fires when crossing from at or below (or empty) to above', () => {
    const t = trig('number_above', { fieldKey: 'likelihood', threshold: 3 });
    expect(matchTrigger(t, changed(f.likelihood.id, 2, 4), ctx)).toBe(true);
    expect(matchTrigger(t, changed(f.likelihood.id, 3, 4), ctx)).toBe(true);
    expect(matchTrigger(t, changed(f.likelihood.id, null, 4), ctx)).toBe(true);
    expect(matchTrigger(t, changed(f.likelihood.id, 4, 5), ctx)).toBe(false);
    expect(matchTrigger(t, changed(f.likelihood.id, 1, 3), ctx)).toBe(false);
    expect(matchTrigger(t, changed(f.likelihood.id, 4, null), ctx)).toBe(false);
  });

  it('number_below fires when crossing from at or above (or empty) to below', () => {
    const t = trig('number_below', { fieldKey: 'likelihood', threshold: 3 });
    expect(matchTrigger(t, changed(f.likelihood.id, 3, 2), ctx)).toBe(true);
    expect(matchTrigger(t, changed(f.likelihood.id, null, 2), ctx)).toBe(true);
    expect(matchTrigger(t, changed(f.likelihood.id, 2, 1), ctx)).toBe(false);
    expect(matchTrigger(t, changed(f.likelihood.id, 2, 4), ctx)).toBe(false);
  });

  it('number triggers on a formula: before/after computed by the runner, once per crossing', () => {
    const t = trig('number_above', { fieldKey: 'residual', threshold: 12 });
    const run = (before: Record<string, Json>, after: Record<string, Json>) => {
      const a = makeItem(after, { id: 'i-risk' });
      const b = itemBefore(
        a,
        Object.keys({ ...before, ...after }).map((k) => ({ fieldId: k, before: before[k] })),
      );
      const changes = computedChanges(
        computedTriggerFields([t], ctx),
        { item: b, ctx: ctxBefore(ctx, b) },
        { item: a, ctx },
      );
      return changes.some((c) => matchTrigger(t, changed(c.fieldId, c.before, c.after), ctx));
    };
    const L = f.likelihood.id;
    const I = f.impact.id;
    expect(run({ [L]: 3, [I]: 3 }, { [L]: 3, [I]: 5 })).toBe(true); // 9 → 15
    expect(run({ [L]: 3, [I]: 5 }, { [L]: 3, [I]: 5 })).toBe(false); // no change
    expect(run({ [L]: 3, [I]: 5 }, { [L]: 4, [I]: 5 })).toBe(false); // 15 → 20, still above
    expect(run({ [L]: 4, [I]: 5 }, { [L]: 2, [I]: 5 })).toBe(false); // 20 → 10
    expect(run({ [L]: 2, [I]: 5 }, { [L]: 4, [I]: 4 })).toBe(true); // 10 → 16
  });

  it('computedTriggerFields lists only computed fields of number triggers', () => {
    const list = computedTriggerFields(
      [
        trig('number_above', { fieldKey: 'residual', threshold: 1 }),
        trig('number_above', { fieldKey: 'likelihood', threshold: 1 }),
        trig('field_changed', { fieldKey: 'status' }),
      ],
      ctx,
    );
    expect(list.map((x) => x.key)).toEqual(['residual']);
  });

  it('ctxBefore sees old links for rollups', () => {
    const b = makeItem({}, { id: 'i-x' });
    const c = ctxBefore(makeCtx({ fields, links: { [`i-x:${f.related.id}`]: ['a', 'b'] } }), b, [
      { fieldId: f.related.id, ids: ['a'] },
    ]);
    expect(c.links('i-x', f.related.id)).toEqual(['a']);
    expect(c.item('i-x')).toBe(b);
  });

  it('checklist_no fires when the number of No answers increases', () => {
    const t = trig('checklist_no', { fieldKey: 'inspection' });
    const v = (l1: string, l2?: string) => ({
      answers: { l1: { a: l1 }, ...(l2 ? { l2: { a: l2 } } : {}) },
    });
    expect(matchTrigger(t, changed(f.inspection.id, v('yes'), v('yes', 'no')), ctx)).toBe(true);
    expect(matchTrigger(t, changed(f.inspection.id, null, v('no')), ctx)).toBe(true);
    expect(matchTrigger(t, changed(f.inspection.id, v('no'), v('no', 'yes')), ctx)).toBe(false);
    expect(matchTrigger(t, changed(f.inspection.id, v('no', 'no'), v('yes', 'no')), ctx)).toBe(
      false,
    );
  });

  it('button_clicked fires for its own button only', () => {
    const t = trig('button_clicked', { fieldKey: 'approve' });
    const ev = (fieldId: string): AutomationEvent => ({
      type: 'button.clicked',
      sheetId: 's-ca',
      itemId: 'i',
      fieldId,
      actor: user,
    });
    expect(matchTrigger(t, ev(f.approve.id), ctx)).toBe(true);
    expect(matchTrigger(t, ev('other'), ctx)).toBe(false);
  });

  it('scheduled triggers match the scheduler event of their own automation', () => {
    const ev: AutomationEvent = {
      type: 'schedule',
      sheetId: 's-ca',
      itemId: 'i',
      automationId: 'a-1',
      occurrence: '2026-12-01',
      actor: { kind: 'system', id: null },
    };
    for (const t of [
      trig('date_arrives', { fieldKey: 'review', offsetDays: -30 }),
      trig('clock_warning', { fieldKey: 'clock', hoursLeft: 24 }),
      trig('evidence_expiring', { fieldKey: 'evidence', days: 30 }),
    ]) {
      expect(matchTrigger(t, ev, ctx, 'a-1')).toBe(true);
      expect(matchTrigger(t, ev, ctx, 'a-2')).toBe(false);
      expect(matchTrigger(t, changed(f.review.id, null, '2026-12-01'), ctx, 'a-1')).toBe(false);
    }
  });

  it('item.moved fires no MVP trigger', () => {
    const ev: AutomationEvent = {
      type: 'item.moved',
      sheetId: 's-ca',
      itemId: 'i',
      fromGroupId: 'g-open',
      toGroupId: 'g-closed',
      actor: user,
    };
    for (const id of Object.keys(TRIGGERS) as Trigger['type'][]) {
      expect(matchTrigger(trig(id, { fieldKey: 'status', value: 'opt_done' }), ev, ctx)).toBe(
        false,
      );
    }
  });
});
