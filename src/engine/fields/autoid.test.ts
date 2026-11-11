import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { autoid } from './autoid';

describe('autoid', () => {
  contract(autoid, {
    valid: [
      ['CA-012', 'CA-012'],
      ['  CA-1 ', 'CA-1'],
      [42, '42'],
    ],
    invalid: ['', null, 'two words', {}],
    parse: [
      ['CA-012', 'CA-012'],
      ['RISK-7\t', 'RISK-7'],
      ['12', '12'],
    ],
    text: [['CA-012', 'CA-012']],
    number: [['CA-012', null]],
    date: [['CA-012', null]],
    order: ['CA-9', 'CA-10'],
    empty: [
      ['', true],
      ['CA-1', false],
    ],
  });

  it('reads the display id the sheet gave the item and is never typed in', () => {
    const field = makeField('autoid', {});
    expect(autoid.compute!(makeItem({}, { displayId: 'CA-042' }), field, makeCtx())).toBe('CA-042');
    expect(autoid.formAllowed).toBe(false);
  });

  it('sorts by the number after the prefix, not as text', () => {
    const ids = ['CA-10', 'CA-2', 'CA-001'];
    expect([...ids].sort((x, y) => autoid.compare(x, y, {}, makeCtx()))).toEqual([
      'CA-001',
      'CA-2',
      'CA-10',
    ]);
  });
});
