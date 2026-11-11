import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { link } from './link';
import { progress, type ProgressConfig } from './progress';
import { installFieldTypes } from './resolve';
import { status } from './status';
import type { AnyFieldType } from './types';

// Local stand-in for the checklist type: progress only needs to know where its value is stored.
const checklistStub = {
  ...status,
  id: 'checklist',
  storage: 'values',
  kind: 'number',
} as AnyFieldType;
installFieldTypes([link, status, checklistStub]);

const lines = ['l1', 'l2', 'l3', 'l4'].map((id) => ({ id, text: `Check ${id}`, noteOnNo: true }));
const checks = makeField('checklist', { lines }, { key: 'checks' });
const noLines = makeField('checklist', { lines: [] }, { key: 'no_lines' });
const state = makeField('status', status.defaultConfig(), { key: 'state', sheetId: 's-ctl' });
const controls = makeField(
  'link',
  { targetSheetId: 's-ctl', multiple: true, inverseFieldId: null },
  { key: 'controls' },
);
const reqs = makeField(
  'requirement',
  { targetSheetId: 's-ctl', multiple: true, inverseFieldId: null },
  { key: 'reqs' },
);

const c1 = makeItem({ [state.id]: 'opt_done' }, { id: 'i-c1', sheetId: 's-ctl' });
const c2 = makeItem({ [state.id]: 'opt_wip' }, { id: 'i-c2', sheetId: 's-ctl' });
const c3 = makeItem({}, { id: 'i-c3', sheetId: 's-ctl' });
const answers = {
  l1: { a: 'yes' },
  l2: { a: 'no', note: 'Guard missing' },
  l3: { a: 'na' },
  gone: { a: 'yes' },
};
const a = makeItem({ [checks.id]: { answers } }, { id: 'i-a' });
const ctx = makeCtx({
  fields: [checks, noLines, controls, reqs],
  otherFields: { 's-ctl': [state] },
  items: [c1, c2, c3, a],
  links: { 'i-a:f-controls': ['i-c1', 'i-c2', 'i-c3'], 'i-a:f-reqs': ['i-c1', 'i-c2'] },
});
const run = (sourceFieldKey: string, item = a) =>
  progress.compute!(item, makeField<ProgressConfig>('progress', { sourceFieldKey }), ctx);

describe('progress', () => {
  contract(progress, {
    valid: [
      [50, 50],
      ['75%', 75],
      [140, 100],
    ],
    invalid: ['half', null, ''],
    parse: [
      ['50%', 50],
      ['0.5', 0.5],
      ['100', 100],
    ],
    text: [
      [75, '75%'],
      [0, '0%'],
    ],
    number: [
      [75, 75],
      [null, null],
    ],
    order: [25, 75],
    empty: [
      [0, false],
      [null, true],
    ],
  });

  it('shows answered lines of a checklist as a percentage', () => {
    expect(run('checks')).toBe(75);
    expect(run('checks', makeItem({}, { id: 'i-blank' }))).toBe(0);
    expect(run('no_lines')).toBeNull();
  });

  it('shows the share of linked items whose status is done', () => {
    expect(run('controls')).toBe(33);
    expect(run('reqs')).toBe(50);
    expect(run('controls', c1)).toBeNull();
    expect(run('missing')).toBeNull();
  });
});
