import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { link } from './link';
import { number } from './number';
import { installFieldTypes } from './resolve';
import { rollup, type RollupConfig } from './rollup';
import { status } from './status';
import { text } from './text';

installFieldTypes([link, number, status, text, rollup]);

const state = makeField('status', status.defaultConfig(), { key: 'state', sheetId: 's-ctl' });
const score = makeField('number', { unit: '', decimals: 2 }, { key: 'score', sheetId: 's-ctl' });
const title = makeField('text', {}, { key: 'title', sheetId: 's-ctl' });
const controls = makeField('link', { targetSheetId: 's-ctl', multiple: true, inverseFieldId: null }, { key: 'controls' });

const c1 = makeItem({ [state.id]: 'opt_done', [score.id]: 3, [title.id]: 'Access' }, { id: 'i-c1', sheetId: 's-ctl' });
const c2 = makeItem({ [state.id]: 'opt_wip', [score.id]: 5 }, { id: 'i-c2', sheetId: 's-ctl' });
const c3 = makeItem({ [title.id]: 'Backups' }, { id: 'i-c3', sheetId: 's-ctl' });
const a = makeItem({}, { id: 'i-a' });
const none = makeItem({}, { id: 'i-none' });
const ctx = makeCtx({
  fields: [controls],
  otherFields: { 's-ctl': [title, state, score] },
  items: [c1, c2, c3, a, none],
  links: { 'i-a:f-controls': ['i-c1', 'i-c2', 'i-c3'] },
});

const run = (cfg: Partial<RollupConfig>, item = a) =>
  rollup.compute!(item, makeField<RollupConfig>('rollup', { linkFieldKey: 'controls', targetFieldKey: null, fn: 'count', ...cfg }), ctx);

describe('rollup', () => {
  contract(rollup, {
    ctx,
    valid: [
      [12, 12],
      ['1,200', 1200],
      [0, 0],
    ],
    invalid: ['abc', null, '', Infinity],
    parse: [
      ['12', 12],
      ['1,234.5', 1234.5],
      ['50%', 50],
    ],
    text: [
      [3.456, '3.46'],
      [3, '3'],
    ],
    number: [
      [8, 8],
      [null, null],
    ],
    order: [1, 2],
    empty: [
      [0, false],
      [null, true],
    ],
  });

  it('counts, totals and averages the linked items', () => {
    expect(run({ fn: 'count' })).toBe(3);
    expect(run({ fn: 'sum', targetFieldKey: 'score' })).toBe(8);
    expect(run({ fn: 'avg', targetFieldKey: 'score' })).toBe(4);
    expect(run({ fn: 'min', targetFieldKey: 'score' })).toBe(3);
    expect(run({ fn: 'max', targetFieldKey: 'score' })).toBe(5);
    expect(run({ fn: 'countEmpty', targetFieldKey: 'score' })).toBe(1);
  });

  it('works out % done from the target status, or the first status field when none is chosen', () => {
    expect(run({ fn: 'pctDone', targetFieldKey: 'state' })).toBe(33);
    expect(run({ fn: 'pctDone' })).toBe(33);
    expect(rollup.toText(33, { linkFieldKey: 'controls', targetFieldKey: null, fn: 'pctDone' }, ctx)).toBe('33%');
  });

  it('counts the linked items that match a where clause', () => {
    expect(run({ fn: 'countWhere', targetFieldKey: 'score', where: { op: 'gt', value: 4 } })).toBe(1);
    expect(run({ fn: 'countWhere', targetFieldKey: 'score', where: { op: 'lte', value: 5 } })).toBe(2);
    expect(run({ fn: 'countWhere', targetFieldKey: 'state', where: { op: 'eq', value: 'Done' } })).toBe(1);
    expect(run({ fn: 'countWhere', targetFieldKey: 'state', where: { op: 'neq', value: 'opt_wip' } })).toBe(2);
    expect(run({ fn: 'countWhere', targetFieldKey: 'title', where: { op: 'is_empty' } })).toBe(1);
    expect(run({ fn: 'countWhere', targetFieldKey: 'title', where: { op: 'is_not_empty' } })).toBe(2);
    expect(run({ fn: 'countWhere', targetFieldKey: 'title' })).toBeNull();
  });

  it('gives 0 for a count and empty for the rest when nothing is linked', () => {
    expect(run({ fn: 'count' }, none)).toBe(0);
    expect(run({ fn: 'sum', targetFieldKey: 'score' }, none)).toBeNull();
    expect(run({ fn: 'pctDone', targetFieldKey: 'state' }, none)).toBeNull();
  });
});
