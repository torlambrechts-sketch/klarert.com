import { describe, expect, it } from 'vitest';
import { rekeyIds } from './rekey';
import type { Json } from './types';

const ids = new Map([
  ['f-old-status', 'f-new-status'],
  ['f-old-due', 'f-new-due'],
  ['g-old-open', 'g-new-open'],
  ['v-old', 'v-new'],
  ['s-old', 's-new'],
]);

describe('rekeyIds', () => {
  it('re-keys automation triggers, conditions and actions', () => {
    const automation: Json = {
      trigger: { type: 'field_becomes', fieldId: 'f-old-status', value: 'opt_done' },
      conditions: [{ fieldKey: 'due_date', op: 'is_before', value: 'today' }],
      actions: [
        { type: 'move', groupId: 'g-old-open' },
        { type: 'set', fieldId: 'f-old-due', value: { relative: 'today+7' } },
        { type: 'notify', message: 'Due {due_date}' },
      ],
    };
    expect(rekeyIds(automation, ids)).toEqual({
      trigger: { type: 'field_becomes', fieldId: 'f-new-status', value: 'opt_done' },
      conditions: [{ fieldKey: 'due_date', op: 'is_before', value: 'today' }],
      actions: [
        { type: 'move', groupId: 'g-new-open' },
        { type: 'set', fieldId: 'f-new-due', value: { relative: 'today+7' } },
        { type: 'notify', message: 'Due {due_date}' },
      ],
    });
  });

  it('re-keys object keys and id lists in view configs', () => {
    const config = {
      hidden: ['f-old-due'],
      widths: { 'f-old-status': 140 },
      labelFieldId: 'f-old-status',
      filters: [{ fieldKey: 'status', op: 'is', value: ['opt_1'] }],
      pageSize: 25,
      compact: true,
      empty: null,
    };
    expect(rekeyIds(config, ids)).toEqual({
      hidden: ['f-new-due'],
      widths: { 'f-new-status': 140 },
      labelFieldId: 'f-new-status',
      filters: [{ fieldKey: 'status', op: 'is', value: ['opt_1'] }],
      pageSize: 25,
      compact: true,
      empty: null,
    });
  });

  it('re-keys sheet settings and leaves other strings alone', () => {
    expect(rekeyIds({ defaultViewId: 'v-old', targetSheetId: 's-old' }, ids)).toEqual({
      defaultViewId: 'v-new',
      targetSheetId: 's-new',
    });
    expect(rekeyIds('f-old-status is mentioned here', ids)).toBe('f-old-status is mentioned here');
  });

  it('passes null and undefined through and does not mutate the input', () => {
    expect(rekeyIds(null, ids)).toBeNull();
    expect(rekeyIds(undefined, ids)).toBeUndefined();
    const input = { a: ['f-old-due'] };
    rekeyIds(input, ids);
    expect(input).toEqual({ a: ['f-old-due'] });
  });
});
