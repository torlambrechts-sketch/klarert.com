import { describe, expect, it } from 'vitest';
import { greeting, hourIn } from './home';

describe('greeting', () => {
  it('says morning, afternoon or evening by the hour', () => {
    expect(greeting(5)).toBe('Good morning');
    expect(greeting(11)).toBe('Good morning');
    expect(greeting(12)).toBe('Good afternoon');
    expect(greeting(17)).toBe('Good afternoon');
    expect(greeting(18)).toBe('Good evening');
    expect(greeting(0)).toBe('Good evening');
    expect(greeting(4)).toBe('Good evening');
  });
});

describe('hourIn', () => {
  const now = new Date('2026-11-12T08:30:00Z');
  it('reads the hour in the given time zone', () => {
    expect(hourIn(now, 'UTC')).toBe(8);
    expect(hourIn(now, 'Europe/Oslo')).toBe(9);
    expect(hourIn(now, 'America/New_York')).toBe(3);
  });
  it('falls back to UTC for an unknown zone', () => {
    expect(hourIn(now, 'Not/AZone')).toBe(8);
  });
});
