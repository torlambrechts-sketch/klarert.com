import { describe, expect, it } from 'vitest';
import { afterEmailLink, linkOutcome } from './auth-links';

const none = { code: null, tokenHash: null, error: null, message: null };

describe('linkOutcome', () => {
  it('exchanges a code or a token hash', () => {
    expect(linkOutcome({ ...none, code: 'abc' })).toBe('exchange');
    expect(linkOutcome({ ...none, tokenHash: 'abc' })).toBe('exchange');
  });
  it('fails on an error, even with a code, and on nothing at all', () => {
    expect(linkOutcome({ ...none, code: 'abc', error: 'access_denied' })).toBe('failed');
    expect(linkOutcome(none)).toBe('failed');
  });
  it('reads a message alone as the first of two email change links', () => {
    expect(
      linkOutcome({
        ...none,
        message:
          'Confirmation link accepted. Please proceed to confirm link sent to the other email',
      }),
    ).toBe('confirm_other');
  });
});

describe('afterEmailLink', () => {
  it('goes to next when the link worked, only on this site', () => {
    expect(afterEmailLink('/acme/home', 'ok')).toBe('/acme/home');
    expect(afterEmailLink('/login/new-password?next=%2Facme', 'ok')).toBe(
      '/login/new-password?next=%2Facme',
    );
    expect(afterEmailLink('//evil.com', 'ok')).toBe('/');
    expect(afterEmailLink(null, 'ok')).toBe('/');
  });
  it('sends a failed reset link back to Forgot password', () => {
    expect(afterEmailLink('/login/new-password?next=%2Facme', 'failed')).toBe(
      '/login/forgot-password?error=link',
    );
  });
  it('tells Your account how an email change link went', () => {
    expect(afterEmailLink('/account', 'failed')).toBe('/account?email=link-failed');
    expect(afterEmailLink('/account', 'confirm_other')).toBe('/account?email=confirm-other');
    expect(afterEmailLink('/account?next=%2Facme', 'confirm_other')).toBe(
      '/account?next=%2Facme&email=confirm-other',
    );
  });
  it('sends other failed links to sign-in', () => {
    expect(afterEmailLink('/acme/home', 'failed')).toBe('/login?error=link');
    expect(afterEmailLink('/\\evil.com', 'failed')).toBe('/login?error=link');
    expect(afterEmailLink('/acme/home', 'confirm_other')).toBe('/acme/home');
  });
});
