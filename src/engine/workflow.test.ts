import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from './fields/registry';
import { installFieldTypes } from './fields/resolve';
import { makeCtx, makeField, makeItem } from './testing/fixtures';
import type { Automation } from './types';
import { lifecycle, rulesFor, stageField, stageFields } from './workflow';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

// today is 2026-11-11 in the fixtures
const status = makeField('status', FIELD_TYPES.status.defaultConfig(), {
  key: 'status',
  id: 'f-status',
  name: 'Status',
  rules: [
    {
      id: 'r1',
      whenFieldKey: 'status',
      whenValues: ['opt_done'],
      require: ['root_cause'],
      message: 'Add the root cause first.',
    },
    { id: 'r2', whenFieldKey: 'status', whenValues: ['opt_stuck'], requireComment: true },
  ],
});
const cause = makeField('text', {}, { key: 'root_cause', id: 'f-cause', name: 'Root cause' });
const due = makeField(
  'date',
  { relative: true },
  { key: 'due', id: 'f-due', name: 'Due date', position: 'a2' },
);
const owner = makeField('people', { multiple: true }, { key: 'owner', id: 'f-owner' });
const fields = [status, cause, due, owner];

const auto = (over: Partial<Automation>): Automation => ({
  id: 'a1',
  sheetId: 'sheet-ca',
  name: 'Close',
  enabled: true,
  trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_done' },
  conditions: [],
  actions: [{ type: 'lock_item' }],
  source: 'custom',
  version: 1,
  locked: false,
  ...over,
});

describe('stage fields', () => {
  it('offers single-choice option fields only', () => {
    const ctx = makeCtx({ fields });
    expect(stageFields(fields, ctx).map((f) => f.key)).toEqual(['status']);
    expect(stageField(fields, 'missing', ctx)?.key).toBe('status');
    expect(stageField([cause], null, ctx)).toBeNull();
  });
});

describe('lifecycle', () => {
  const a = makeItem({ 'f-status': 'opt_wip', 'f-due': '2026-11-01' }, { id: 'i-a' });
  const b = makeItem({ 'f-status': 'opt_wip', 'f-due': '2026-12-01' }, { id: 'i-b' });
  const c = makeItem({ 'f-status': 'opt_done', 'f-due': '2026-10-01' }, { id: 'i-c' });
  const d = makeItem({}, { id: 'i-d' });
  const ctx = makeCtx({ fields, items: [a, b, c, d] });

  it('puts items in stages in option order, counts overdue and adds "No stage"', () => {
    const l = lifecycle(status, [a, b, c, d], [], ctx);
    expect(l.stages.map((s) => s.label)).toEqual([
      'Not started',
      'Working on it',
      'Stuck',
      'Done',
      'No stage',
    ]);
    const wip = l.stages[1]!;
    expect(wip.items.map((i) => i.id)).toEqual(['i-a', 'i-b']);
    expect(wip.overdue).toBe(1);
    // done items are never overdue
    expect(l.stages[3]!.overdue).toBe(0);
    expect(l.total).toBe(4);
    expect(l.overdue).toBe(1);
  });

  it('shows rules and automations of a stage', () => {
    const l = lifecycle(
      status,
      [a],
      [
        auto({}),
        auto({ id: 'a2', trigger: { type: 'field_changed', fieldKey: 'status' } }),
        auto({ id: 'a3', trigger: { type: 'field_becomes', fieldKey: 'other', value: 'x' } }),
      ],
      ctx,
    );
    const done = l.stages.find((s) => s.key === 'opt_done')!;
    expect(done.rules).toEqual([
      {
        id: 'r1',
        requires: 'Needs Root cause',
        comment: false,
        message: 'Add the root cause first.',
      },
    ]);
    expect(done.automations.map((x) => x.id)).toEqual(['a1']);
    expect(done.automations[0]!.then).toBe('lock');
    expect(l.onChange.map((x) => x.id)).toEqual(['a2']);
    expect(rulesFor(status, 'opt_stuck', ctx)).toEqual([
      { id: 'r2', requires: null, comment: true, message: null },
    ]);
  });
});
