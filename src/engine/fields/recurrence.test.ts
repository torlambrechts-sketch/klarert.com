import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { nextOccurrence, recurrence } from './recurrence';

const monthly = { every: 1, unit: 'months' as const, start: '2026-01-15' };

describe('recurrence', () => {
  contract(recurrence, {
    valid: [
      [monthly, monthly],
      [{ every: '2', unit: 'week', start: '01/12/2026' }, { every: 2, unit: 'weeks', start: '2026-12-01' }],
      ['every 3 days', { every: 3, unit: 'days', start: '2026-11-11' }],
      ['Quarterly from 2026-01-01', { every: 3, unit: 'months', start: '2026-01-01' }],
    ],
    invalid: [{ every: 0, unit: 'months', start: '2026-01-15' }, 'sometimes', '', null, { every: 1, unit: 'hours' }],
    parse: [
      ['Every month · next 15 Dec 2026', { every: 1, unit: 'months', start: '2026-12-15' }],
      ['Monthly', { every: 1, unit: 'months', start: '2026-11-11' }],
      ['every 2 weeks from 01/12/2026', { every: 2, unit: 'weeks', start: '2026-12-01' }],
    ],
    text: [
      [monthly, 'Every month · next 15 Nov 2026'],
      [{ every: 2, unit: 'weeks', start: '2026-11-01' }, 'Every 2 weeks · next 15 Nov 2026'],
    ],
    date: [
      [monthly, '2026-11-15'],
      [{ every: 1, unit: 'years', start: '2027-03-01' }, '2027-03-01'],
      [null, null],
    ],
    order: [monthly, { every: 1, unit: 'years', start: '2020-12-01' }],
  });

  it('finds the next occurrence on or after today', () => {
    expect(nextOccurrence({ every: 1, unit: 'months', start: '2026-01-11' }, '2026-11-11')).toBe('2026-11-11');
    expect(nextOccurrence({ every: 1, unit: 'months', start: '2026-01-10' }, '2026-11-11')).toBe('2026-12-10');
    expect(nextOccurrence({ every: 1, unit: 'months', start: '2026-01-31' }, '2026-11-11')).toBe('2026-11-30');
    expect(nextOccurrence({ every: 1, unit: 'years', start: '2024-02-29' }, '2026-11-11')).toBe('2027-02-28');
    expect(nextOccurrence({ every: 1, unit: 'weeks', start: '2026-11-04' }, '2026-11-11')).toBe('2026-11-11');
    expect(nextOccurrence({ every: 10, unit: 'days', start: '2000-01-01' }, '2026-11-11')).toBe('2026-11-20');
  });

  it('moves forward with today', () => {
    const later = makeCtx({}, { today: '2026-11-16' });
    expect(recurrence.toText(monthly, {}, later)).toBe('Every month · next 15 Dec 2026');
  });
});
