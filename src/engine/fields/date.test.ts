import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { date, dateCountdown, relativeDue } from './date';

describe('date', () => {
  contract(date, {
    valid: [
      ['2026-11-11', '2026-11-11'],
      ['11/12/2026', '2026-12-11'],
      ['2026-11-11T14:20:00Z', '2026-11-11'],
    ],
    invalid: ['2026-02-30', 'tomorrow', '', null, '13/13/2026'],
    parse: [
      ['11 Nov 2026', '2026-11-11'],
      ['46337', '2026-11-11'],
      ['01/02/2026', '2026-02-01'],
    ],
    text: [['2026-11-11', '11 Nov 2026']],
    date: [
      ['2026-11-11', '2026-11-11'],
      [null, null],
    ],
    order: ['2026-01-01', '2026-11-11'],
  });

  it('describes the due date relative to today', () => {
    expect(relativeDue('2026-11-14', '2026-11-11')).toBe('in 3 days');
    expect(relativeDue('2026-11-11', '2026-11-11')).toBe('today');
    expect(relativeDue('2026-11-12', '2026-11-11')).toBe('tomorrow');
    expect(relativeDue('2026-11-09', '2026-11-11')).toBe('2 days overdue');
    expect(relativeDue('2026-11-10', '2026-11-11')).toBe('1 day overdue');
  });

  it('counts down to the date for the Table, with done and late states', () => {
    expect(dateCountdown('2027-01-15', '2026-11-11', false)).toEqual({
      text: 'in 65d',
      tone: 'far',
      pct: 28,
    });
    expect(dateCountdown('2026-11-20', '2026-11-11', false).tone).toBe('soon');
    expect(dateCountdown('2026-11-11', '2026-11-11', false).text).toBe('today');
    expect(dateCountdown('2026-11-08', '2026-11-11', false)).toEqual({
      text: 'late 3d',
      tone: 'late',
      pct: 100,
    });
    expect(dateCountdown('2026-11-08', '2026-11-11', true).text).toBe('done');
    expect(dateCountdown('2027-11-11', '2026-11-11', false).pct).toBe(6);
  });
});
