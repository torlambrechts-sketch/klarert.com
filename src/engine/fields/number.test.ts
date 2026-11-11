import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { number } from './number';

describe('number', () => {
  contract(number, {
    valid: [
      [12.5, 12.5],
      ['1,234.5', 1234.5],
      ['-3', -3],
      [0, 0],
    ],
    invalid: ['abc', '', null, Infinity, '1.2.3'],
    parse: [
      ['1,200', 1200],
      ['12%', 12],
      ['€1,200.50', 1200.5],
    ],
    text: [
      [1234.5, '1,234.5'],
      [2, '2'],
    ],
    number: [
      [3, 3],
      [null, null],
    ],
    order: [-1, 10],
    empty: [
      [0, false],
      [null, true],
    ],
  });

  it('shows the unit and rounds to the configured decimals', () => {
    expect(number.toText(1.23456, { unit: 'kg', decimals: 1 }, makeCtx())).toBe('1.2 kg');
  });
});
