import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { link } from './link';
import { lookup, lookupKind, type LookupConfig } from './lookup';
import { number } from './number';
import { installFieldTypes } from './resolve';
import { status } from './status';
import { text } from './text';

installFieldTypes([link, lookup, number, status, text]);

const linkCfg = (targetSheetId: string) => ({
  targetSheetId,
  multiple: true,
  inverseFieldId: null,
});
const state = makeField('status', status.defaultConfig(), { key: 'state', sheetId: 's-ctl' });
const score = makeField('number', { unit: '', decimals: 2 }, { key: 'score', sheetId: 's-ctl' });
const back = makeField('link', linkCfg('s-ca'), { key: 'back', sheetId: 's-ctl' });
const backLook = makeField<LookupConfig>(
  'lookup',
  { linkFieldKey: 'back', targetFieldKey: 'loop' },
  { key: 'back_look', sheetId: 's-ctl' },
);
const controls = makeField('link', linkCfg('s-ctl'), { key: 'controls' });
const scores = makeField<LookupConfig>(
  'lookup',
  { linkFieldKey: 'controls', targetFieldKey: 'score' },
  { key: 'scores' },
);
const states = makeField<LookupConfig>(
  'lookup',
  { linkFieldKey: 'controls', targetFieldKey: 'state' },
  { key: 'states' },
);
const loop = makeField<LookupConfig>(
  'lookup',
  { linkFieldKey: 'controls', targetFieldKey: 'back_look' },
  { key: 'loop' },
);

const c1 = makeItem({ [state.id]: 'opt_done', [score.id]: 3 }, { id: 'i-c1', sheetId: 's-ctl' });
const c2 = makeItem({ [state.id]: 'opt_wip', [score.id]: 5 }, { id: 'i-c2', sheetId: 's-ctl' });
const c3 = makeItem({}, { id: 'i-c3', sheetId: 's-ctl' });
const a = makeItem({}, { id: 'i-a' });
const ctx = makeCtx({
  fields: [controls, scores, states, loop],
  otherFields: { 's-ctl': [state, score, back, backLook] },
  items: [c1, c2, c3, a],
  links: { 'i-a:f-controls': ['i-c1', 'i-c2', 'i-c3', 'i-missing'], 'i-c1:f-back': ['i-a'] },
});

describe('lookup', () => {
  contract(lookup, {
    config: scores.config,
    ctx,
    valid: [
      [
        [3, 5],
        [3, 5],
      ],
      ['x', ['x']],
      [[1, null, ''], [1]],
    ],
    invalid: [null, [], '', [null, '  ']],
    parse: [
      ['3, 5', ['3', '5']],
      ['3\n5', ['3', '5']],
      ['["a","b"]', ['a', 'b']],
    ],
    text: [
      [[3, 5], '3, 5'],
      [[1234.5], '1,234.5'],
    ],
    number: [
      [[3, 5], 3],
      [null, null],
    ],
    date: [[[3], null]],
    order: [[3], [5]],
    empty: [
      [[], true],
      [[0], false],
    ],
  });

  it('collects the target field of each linked item, skipping empties and missing items', () => {
    expect(lookup.compute!(a, scores, ctx)).toEqual([3, 5]);
    expect(lookup.compute!(a, states, ctx)).toEqual(['opt_done', 'opt_wip']);
    expect(lookup.compute!(c3, scores, ctx)).toBeNull();
  });

  it('shows target values as the target type shows them and takes the target kind', () => {
    expect(lookup.toText(['opt_done', 'opt_wip'], states.config, ctx)).toBe('Done, Working on it');
    expect(lookupKind(states, ctx)).toBe('option');
    expect(lookupKind(scores, ctx)).toBe('number');
    expect(
      lookupKind(
        makeField<LookupConfig>('lookup', { linkFieldKey: 'nope', targetFieldKey: 'x' }),
        ctx,
      ),
    ).toBe('text');
  });

  it('stops when lookups read each other through a two-way link', () => {
    expect(lookup.compute!(a, loop, ctx)).toBeNull();
  });
});
