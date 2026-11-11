import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { rating } from './rating';

describe('rating', () => {
  contract(rating, {
    valid: [
      [4, 4],
      ['3', 3],
      ['★★★★☆', 4],
      ['5 / 5', 5],
    ],
    invalid: [0, 6, 2.5, 'great', '', null],
    parse: [
      ['4', 4],
      ['2 / 5', 2],
      ['★★', 2],
      ['9', 5],
    ],
    text: [[4, '4 / 5']],
    number: [
      [4, 4],
      [null, null],
    ],
    order: [2, 5],
    empty: [
      [1, false],
      [null, true],
    ],
  });

  it('follows the configured scale', () => {
    const ten = { scale: 10 };
    expect(rating.normalize(8, ten, makeCtx())).toBe(8);
    expect(rating.toText(8, ten, makeCtx())).toBe('8 / 10');
    expect(rating.configSchema.safeParse({ scale: 2 }).success).toBe(false);
    expect(rating.configSchema.safeParse({ scale: 11 }).success).toBe(false);
  });

  it('flags a stored rating above a reduced scale', () => {
    const field = makeField('rating', { scale: 3 });
    expect(rating.validate(5, field, makeItem(), makeCtx())[0]?.code).toBe('out_of_scale');
    expect(rating.validate(3, field, makeItem(), makeCtx())).toEqual([]);
  });
});
