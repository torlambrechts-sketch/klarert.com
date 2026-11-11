import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { percent } from './percent';

describe('percent', () => {
  contract(percent, {
    valid: [
      [45, 45],
      ['12.5%', 12.5],
      [0, 0],
      [100, 100],
    ],
    invalid: [101, -1, 'abc', '', null],
    parse: [
      ['45%', 45],
      ['80', 80],
      ['99.5 %', 99.5],
    ],
    text: [
      [45, '45%'],
      [12.5, '12.5%'],
    ],
    number: [
      [45, 45],
      [null, null],
    ],
    order: [5, 90],
    empty: [
      [0, false],
      [null, true],
    ],
  });

  it('keeps values inside 0 to 100', () => {
    expect(percent.normalize('100.1', { bar: true }, makeCtx())).toBeNull();
    expect(percent.valueSchema.safeParse(150).success).toBe(false);
  });
});
