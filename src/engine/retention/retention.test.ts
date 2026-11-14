import { describe, expect, it } from 'vitest';
import '../fields/registry';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import {
  addPeriod,
  describeRule,
  erasedFields,
  erasureMessage,
  queueState,
  readRetention,
  retentionDue,
  retentionProblems,
  retentionRuleSchema,
  templateRetentionRuleSchema,
  type RetentionRule,
} from '.';

const requester = makeField(
  'text',
  { personalData: true },
  { key: 'requester', name: 'Requester' },
);
const email = makeField('email', { personalData: true }, { key: 'email', name: 'Email' });
const outcome = makeField('text', {}, { key: 'outcome', name: 'Outcome' });
const closedOn = makeField('date', {}, { key: 'closed_on', name: 'Closed on' });
const status = makeField(
  'status',
  {
    options: [
      { id: 'opt_open', label: 'Open', color: 'orange' },
      { id: 'opt_closed', label: 'Closed', color: 'green', done: true },
    ],
  },
  { key: 'status', name: 'Status' },
);
const fields = [requester, email, outcome, closedOn, status];

const rule = (r: Partial<RetentionRule> = {}): RetentionRule =>
  retentionRuleSchema.parse({
    id: 'dsr3y',
    name: 'Requests: 3 years after closing',
    from: { kind: 'field', fieldKey: 'closed_on' },
    period: { n: 3, unit: 'years' },
    action: 'erase',
    ...r,
  });

describe('retention rules', () => {
  it('adds days, months and years (month ends clamp)', () => {
    expect(addPeriod('2023-11-11', { n: 3, unit: 'years' })).toBe('2026-11-11');
    expect(addPeriod('2026-01-31', { n: 1, unit: 'months' })).toBe('2026-02-28');
    expect(addPeriod('2026-11-01', { n: 10, unit: 'days' })).toBe('2026-11-11');
  });

  it('finds the items whose period ended by today (the date field)', () => {
    const due = makeItem({ [closedOn.id]: '2023-11-11' }, { id: 'due' });
    const notYet = makeItem({ [closedOn.id]: '2023-11-12' }, { id: 'later' });
    const noDate = makeItem({}, { id: 'nodate' });
    const ctx = makeCtx({ fields, items: [due, notYet, noDate] });
    expect(retentionDue([rule()], [due, notYet, noDate], ctx)).toEqual([
      { sheetId: due.sheetId, itemId: 'due', ruleId: 'dsr3y', dueOn: '2026-11-11' },
    ]);
  });

  it('counts from creation or the last change in the workspace time zone', () => {
    const a = makeItem(
      {},
      { id: 'a', createdAt: '2026-10-31T23:30:00Z', updatedAt: '2026-11-10T09:00:00Z' },
    );
    const ctx = makeCtx({ fields, items: [a] }, { timeZone: 'Europe/Berlin' });
    const created = rule({ id: 'c', from: { kind: 'created' }, period: { n: 10, unit: 'days' } });
    const updated = rule({ id: 'u', from: { kind: 'updated' }, period: { n: 1, unit: 'days' } });
    // 23:30 UTC on 31 Oct is 1 Nov in Berlin: due 11 Nov
    expect(retentionDue([created, updated], [a], ctx).map((d) => [d.ruleId, d.dueOn])).toEqual([
      ['c', '2026-11-11'],
      ['u', '2026-11-11'],
    ]);
  });

  it('applies to groups, done items and conditions only', () => {
    const open = makeItem({ [closedOn.id]: '2020-01-01', [status.id]: 'opt_open' }, { id: 'open' });
    const closed = makeItem(
      { [closedOn.id]: '2020-01-01', [status.id]: 'opt_closed', [outcome.id]: 'Refused' },
      { id: 'closed', groupId: 'g-closed' },
    );
    const items = [open, closed];
    const ctx = makeCtx({ fields, items });
    expect(retentionDue([rule({ onlyDone: true })], items, ctx).map((d) => d.itemId)).toEqual([
      'closed',
    ]);
    expect(retentionDue([rule({ groupIds: ['g-open'] })], items, ctx).map((d) => d.itemId)).toEqual(
      ['open'],
    );
    expect(
      retentionDue(
        [rule({ conditions: [{ fieldKey: 'outcome', op: 'is_not_empty' }] })],
        items,
        ctx,
      ).map((d) => d.itemId),
    ).toEqual(['closed']);
  });

  it('archived items stay due for erasure but not for archiving', () => {
    const gone = makeItem(
      { [closedOn.id]: '2020-01-01' },
      { id: 'gone', archivedAt: '2024-01-01T00:00:00Z' },
    );
    const ctx = makeCtx({ fields, items: [gone] });
    expect(retentionDue([rule()], [gone], ctx)).toHaveLength(1);
    expect(retentionDue([rule({ action: 'archive' })], [gone], ctx)).toHaveLength(0);
  });

  it('an item whose Retention field says Legal hold is never due', () => {
    const hold = makeField(
      'retention',
      { years: 3, fromFieldKey: null },
      { key: 'keep', name: 'Keep' },
    );
    const held = makeItem({
      [closedOn.id]: '2020-01-01',
      [hold.id]: { hold: true, holdReason: 'Claim' },
    });
    const ctx = makeCtx({ fields: [...fields, hold], items: [held] });
    expect(retentionDue([rule()], [held], ctx)).toEqual([]);
  });

  it('erases the personal-data fields, all or the ones named', () => {
    expect(erasedFields(rule(), fields).map((f) => f.key)).toEqual(['requester', 'email']);
    expect(
      erasedFields(rule({ fieldKeys: ['email', 'outcome'] }), fields).map((f) => f.key),
    ).toEqual(['email']);
  });

  it('says the rule in words', () => {
    expect(describeRule(rule({ comments: true, files: true }), fields)).toBe(
      '3 years after Closed on: erase the personal data (Requester, Email), personal files and comments',
    );
    expect(
      describeRule(
        rule({
          action: 'anonymise',
          from: { kind: 'created' },
          period: { n: 1, unit: 'months' },
          onlyDone: true,
        }),
        fields,
      ),
    ).toBe(
      '1 month after creation once done: anonymise the item (Requester, Email), personal files and comments',
    );
    expect(describeRule(rule({ action: 'archive' }), [])).toBe(
      '3 years after a deleted field: archive the item',
    );
    expect(describeRule(rule(), [outcome, closedOn])).toBe(
      '3 years after Closed on: erase the personal data (no field is marked personal data yet)',
    );
  });

  it('reads settings leniently and refuses duplicate ids', () => {
    const s = readRetention({
      retention: { personalNames: true, rules: [rule(), { id: 'BAD id' }, rule({ id: 'two' })] },
    });
    expect(s.personalNames).toBe(true);
    expect(s.rules.map((r) => r.id)).toEqual(['dsr3y', 'two']);
    expect(readRetention(null)).toEqual({ rules: [] });
    expect(retentionProblems([{ id: 'a' }, { id: 'a' }])).toEqual([
      'Two retention rules share the id a.',
    ]);
  });

  it('manifest rules name groups by ref', () => {
    const t = templateRetentionRuleSchema.parse({
      id: 'x',
      name: 'X',
      from: { kind: 'created' },
      period: { n: 1, unit: 'years' },
      action: 'archive',
      groups: ['closed'],
    });
    expect(t.groups).toEqual(['closed']);
    expect(() => retentionRuleSchema.parse({ ...t, period: { n: 0, unit: 'years' } })).toThrow();
  });

  it('queue state: a hold wins, a postponement ends on its date', () => {
    expect(queueState({ status: 'due', postponedUntil: null }, true, '2026-11-11')).toBe('held');
    expect(
      queueState({ status: 'postponed', postponedUntil: '2026-12-01' }, false, '2026-11-11'),
    ).toBe('postponed');
    expect(
      queueState({ status: 'postponed', postponedUntil: '2026-11-11' }, false, '2026-11-11'),
    ).toBe('due');
    expect(queueState({ status: 'done', postponedUntil: null }, true, '2026-11-11')).toBe('done');
  });

  it('the toast says what was erased and what the log still holds', () => {
    expect(erasureMessage({ action: 'erase', fields: 2, files: 1, comments: 0, in_clear: 0 })).toBe(
      'Erased: 2 fields, 1 file.',
    );
    expect(
      erasureMessage({ action: 'anonymise', fields: 1, files: 0, comments: 3, in_clear: 2 }),
    ).toBe(
      'Anonymised: 1 field, 3 comments. 2 older log entries were written before the field was marked personal data and still hold their values.',
    );
    expect(
      erasureMessage({ action: 'archive', fields: 0, files: 0, comments: 0, in_clear: 0 }),
    ).toBe('Archived under the retention rule.');
  });
});
