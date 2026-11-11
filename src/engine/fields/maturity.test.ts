import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { maturity } from './maturity';

describe('maturity', () => {
  contract(maturity, {
    valid: [
      [3, 3],
      ['Managed', 4],
      ['Level 2', 2],
      [0, 0],
    ],
    invalid: [6, -1, 2.5, 'Expert', '', null],
    parse: [
      ['5', 5],
      ['3 Defined', 3],
      ['optimised', 5],
    ],
    text: [
      [3, '3 Defined'],
      [0, '0 None'],
    ],
    number: [[4, 4]],
    order: [1, 4],
    empty: [
      [0, false],
      [null, true],
    ],
    done: [
      [2, false],
      [3, true],
      [5, true],
      [null, false],
    ],
  });

  it('is ordered with six levels and can be a kanban lane', () => {
    const opts = maturity.options!({}, makeCtx());
    expect(opts.map((o) => o.label)).toEqual([
      'None',
      'Initial',
      'Repeatable',
      'Defined',
      'Managed',
      'Optimised',
    ]);
    expect(maturity.rank!(4, {})).toBe(4);
    expect(maturity.kanbanCapable).toBe(true);
  });
});
