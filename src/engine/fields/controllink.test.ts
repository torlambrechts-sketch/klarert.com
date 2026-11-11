import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem, sheet } from '../testing/fixtures';
import { controllink } from './controllink';

const lib = { ...sheet, id: 's-ctl', name: 'Controls', isLibrary: true };
const items = [
  makeItem({}, { id: 'c-1', sheetId: 's-ctl', displayId: 'CTL-001' }),
  makeItem({}, { id: 'c-2', sheetId: 's-ctl', displayId: 'CTL-002' }),
  makeItem({}, { id: 'ca-9', displayId: 'CA-009' }),
];
const ctx = makeCtx({ items, sheets: { 's-ctl': lib } });

describe('controllink', () => {
  contract(controllink, {
    ctx,
    valid: [
      [['c-1'], ['c-1']],
      ['c-2; c-1', ['c-2', 'c-1']],
      [
        ['c-1', 'c-1', 'c-2'],
        ['c-1', 'c-2'],
      ],
    ],
    invalid: [[], '  ', undefined, { id: 'c-1' }],
    parse: [
      ['c-1', ['c-1']],
      ['c-1, c-2', ['c-1', 'c-2']],
      ['', null],
    ],
    text: [[['c-2', 'c-1'], 'CTL-002, CTL-001']],
    number: [[['c-1'], 1]],
    order: [['c-1'], ['c-2']],
  });

  it('is labelled Control link and refuses non-library targets', () => {
    expect(controllink.label).toBe('Control link');
    const field = makeField('controllink', controllink.defaultConfig());
    expect(controllink.validate(['ca-9'], field, makeItem(), ctx)[0]?.code).toBe('not_library');
  });

  it('reads its value from item_links', () => {
    const field = makeField('controllink', controllink.defaultConfig(), { id: 'f-ctl' });
    const c = makeCtx({ items, links: { 'r-1:f-ctl': ['c-1'] } });
    expect(controllink.compute!(makeItem({}, { id: 'r-1' }), field, c)).toEqual(['c-1']);
  });
});
