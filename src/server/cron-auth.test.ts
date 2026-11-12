import { describe, expect, it } from 'vitest';
import { isCronAuthorised } from './cron-auth';

const SECRET = 'a-long-enough-cron-secret';

describe('isCronAuthorised', () => {
  it('accepts the exact bearer secret', () => {
    expect(isCronAuthorised(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it.each([
    ['no header', null],
    ['an empty header', ''],
    ['the secret without Bearer', SECRET],
    ['a wrong secret', 'Bearer wrong-secret-of-some-length'],
    ['a prefix of the secret', `Bearer ${SECRET.slice(0, -1)}`],
    ['the secret with extra text', `Bearer ${SECRET}x`],
    ['lowercase bearer', `bearer ${SECRET}`],
    ['an empty bearer', 'Bearer '],
  ])('refuses %s', (_label, header) => {
    expect(isCronAuthorised(header, SECRET)).toBe(false);
  });

  it('refuses everything when the secret is missing or short', () => {
    expect(isCronAuthorised('Bearer ', '')).toBe(false);
    expect(isCronAuthorised('Bearer undefined', undefined)).toBe(false);
    expect(isCronAuthorised('Bearer short', 'short')).toBe(false);
  });
});
