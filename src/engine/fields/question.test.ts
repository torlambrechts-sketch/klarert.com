import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { question } from './question';

describe('question', () => {
  contract(question, {
    valid: [
      ['q2', 'q2'],
      ['Partly', 'q1'],
      [' not in place ', 'q0'],
      [2, 'q2'],
    ],
    invalid: ['Maybe', '', null, 7],
    parse: [
      ['Fully', 'q2'],
      ['PARTLY', 'q1'],
      ['0', 'q0'],
    ],
    text: [
      ['q1', 'Partly'],
      ['q9', ''],
    ],
    number: [
      ['q2', 2],
      ['q0', 0],
      [null, null],
    ],
    order: ['q0', 'q2'],
  });

  it('multiplies the score by the weight', () => {
    const cfg = { ...question.defaultConfig(), weight: 3 };
    expect(question.toNumber('q2', cfg, makeCtx())).toBe(6);
    expect(question.toNumber('q1', cfg, makeCtx())).toBe(3);
  });
});
