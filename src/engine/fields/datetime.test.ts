import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { datetime } from './datetime';

const berlin = makeCtx({}, { timeZone: 'Europe/Berlin' });

describe('datetime', () => {
  contract(datetime, {
    valid: [
      ['2026-11-11T14:20:00Z', '2026-11-11T14:20:00Z'],
      ['2026-11-11T15:20:00.000+01:00', '2026-11-11T14:20:00Z'],
      ['2026-11-11 14:20', '2026-11-11T14:20:00Z'],
      [new Date('2026-11-11T14:20:00Z'), '2026-11-11T14:20:00Z'],
    ],
    invalid: ['2026-02-30T10:00:00Z', 'soon', '', null, '2026-11-11 25:00'],
    parse: [
      ['11/11/2026 14:20', '2026-11-11T14:20:00Z'],
      ['46337.5', '2026-11-11T12:00:00Z'],
      ['11 Nov 2026, 14:20', '2026-11-11T14:20:00Z'],
      ['2026-11-11', '2026-11-11T00:00:00Z'],
    ],
    text: [['2026-11-11T14:20:00Z', '11 Nov 2026, 14:20']],
    date: [
      ['2026-11-11T23:30:00Z', '2026-11-11'],
      [null, null],
    ],
    order: ['2026-11-11T09:00:00Z', '2026-11-11T14:20:00Z'],
  });

  it('reads and shows wall time in the user time zone', () => {
    expect(datetime.normalize('2026-11-11 14:20', {}, berlin)).toBe('2026-11-11T13:20:00Z');
    expect(datetime.normalize('2026-07-01 14:20', {}, berlin)).toBe('2026-07-01T12:20:00Z');
    expect(datetime.toText('2026-11-11T23:30:00Z', {}, berlin)).toBe('12 Nov 2026, 00:30');
    expect(datetime.toDate('2026-11-11T23:30:00Z', {}, berlin)).toBe('2026-11-12');
  });

  it('round-trips its own display text', () => {
    const v = '2026-03-29T01:30:00Z';
    expect(datetime.parseText(datetime.toText(v, {}, berlin), {}, berlin)).toBe(v);
  });
});
