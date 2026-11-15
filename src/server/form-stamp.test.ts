import { describe, expect, it } from 'vitest';
import { elapsedSince, formSecret, startStamp, visitorKey } from './form-stamp';

const SECRET = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);

describe('form secret (fails closed)', () => {
  it('is FORM_RATE_LIMIT_SALT when it has at least 32 characters', () => {
    expect(formSecret({ FORM_RATE_LIMIT_SALT: SECRET })).toBe(SECRET);
    expect(formSecret({ FORM_RATE_LIMIT_SALT: `  ${SECRET}  ` })).toBe(SECRET);
  });
  it('is missing when unset, empty or short', () => {
    expect(formSecret({})).toBeNull();
    expect(formSecret({ FORM_RATE_LIMIT_SALT: '' })).toBeNull();
    expect(formSecret({ FORM_RATE_LIMIT_SALT: 'a'.repeat(31) })).toBeNull();
  });
  it('never falls back to the cron secret', () => {
    expect(formSecret({ CRON_SECRET: SECRET })).toBeNull();
  });
});

describe('stamps and visitor keys', () => {
  it('accepts its own stamp and measures the time since', () => {
    const stamp = startStamp(SECRET, 'tok', 1_000);
    expect(elapsedSince(SECRET, 'tok', stamp, 4_500)).toBe(3_500);
  });
  it('refuses a stamp signed with another secret, for another form, or edited', () => {
    const stamp = startStamp(SECRET, 'tok', 1_000);
    expect(elapsedSince(OTHER, 'tok', stamp, 4_500)).toBeNull();
    expect(elapsedSince(SECRET, 'other', stamp, 4_500)).toBeNull();
    expect(elapsedSince(SECRET, 'tok', stamp.replace(/^1000/, '900'), 4_500)).toBeNull();
    expect(elapsedSince(SECRET, 'tok', 'nonsense', 4_500)).toBeNull();
  });
  it('keys a visitor by IP and form, never the plain address', () => {
    const key = visitorKey(SECRET, '203.0.113.7', 'form-1');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('203.0.113.7');
    expect(visitorKey(SECRET, '203.0.113.7', 'form-2')).not.toBe(key);
    expect(visitorKey(OTHER, '203.0.113.7', 'form-1')).not.toBe(key);
  });
});
