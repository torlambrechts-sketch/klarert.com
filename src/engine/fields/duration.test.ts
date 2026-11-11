import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { duration } from './duration';

describe('duration', () => {
  contract(duration, {
    valid: [
      ['3 days', { n: 3, unit: 'days' }],
      ['2w', { n: 2, unit: 'weeks' }],
      ['4 hours', { n: 4, unit: 'hours' }],
      [5, { n: 5, unit: 'days' }],
      [{ n: 1, unit: 'year' }, { n: 1, unit: 'years' }],
    ],
    invalid: ['3 fortnights', '', null, '-2 days', '5m'],
    parse: [
      ['6 months', { n: 6, unit: 'months' }],
      ['1.5 h', { n: 1.5, unit: 'hours' }],
      ['10', { n: 10, unit: 'days' }],
      ['{"n":2,"unit":"weeks"}', { n: 2, unit: 'weeks' }],
    ],
    text: [
      [{ n: 3, unit: 'days' }, '3 days'],
      [{ n: 1, unit: 'weeks' }, '1 week'],
      [{ n: 1.5, unit: 'hours' }, '1.5 hours'],
    ],
    number: [
      [{ n: 2, unit: 'weeks' }, 14],
      [{ n: 1, unit: 'months' }, 30.4],
      [{ n: 1, unit: 'years' }, 365],
      [{ n: 12, unit: 'hours' }, 0.5],
      [null, null],
    ],
    order: [{ n: 30, unit: 'hours' }, { n: 2, unit: 'days' }],
    empty: [
      [{ n: 0, unit: 'days' }, false],
      [null, true],
    ],
  });

  it('uses the configured unit for a bare number', () => {
    expect(duration.parseText('3', { unit: 'weeks' }, makeCtx())).toEqual({ n: 3, unit: 'weeks' });
  });
});
