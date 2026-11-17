import { describe, expect, it } from 'vitest';
import { afterEmailLink, emailLinkNext, linkOutcome } from './auth-links';

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
  it('sends a failed reset link back to Forgot password, saying why', () => {
    expect(afterEmailLink('/login/new-password?next=%2Facme', 'failed')).toBe(
      '/login/forgot-password?error=link',
    );
    expect(afterEmailLink('/login/new-password', 'expired')).toBe(
      '/login/forgot-password?error=expired',
    );
  });
  it('tells Your account how an email change link went', () => {
    expect(afterEmailLink('/account', 'failed')).toBe('/account?email=link-failed');
    expect(afterEmailLink('/account', 'expired')).toBe('/account?email=link-failed');
    expect(afterEmailLink('/account', 'confirm_other')).toBe('/account?email=confirm-other');
    expect(afterEmailLink('/account?next=%2Facme', 'confirm_other')).toBe(
      '/account?next=%2Facme&email=confirm-other',
    );
  });
  it('sends other failed links to sign-in', () => {
    expect(afterEmailLink('/acme/home', 'failed')).toBe('/login?error=link');
    expect(afterEmailLink('/acme/home', 'expired')).toBe('/login?error=link');
    expect(afterEmailLink('/\\evil.com', 'failed')).toBe('/login?error=link');
    expect(afterEmailLink('/acme/home', 'confirm_other')).toBe('/acme/home');
  });
});

describe('emailLinkNext', () => {
  const back = (next: string) =>
    `http://localhost:3000/auth/callback?next=${encodeURIComponent(next)}`;

  it('keeps the page a template names, with the query the app asked for', () => {
    expect(emailLinkNext('/login/new-password', back('/login/new-password?next=/acme'))).toBe(
      '/login/new-password?next=/acme',
    );
    expect(emailLinkNext('/login/new-password', null)).toBe('/login/new-password');
    // the app's address cannot move a reset link to another page
    expect(emailLinkNext('/login/new-password', back('/acme/home'))).toBe('/login/new-password');
    expect(emailLinkNext('/account', back('/account'))).toBe('/account');
  });
  it('takes the page the app asked for when the template names none', () => {
    expect(emailLinkNext(null, back('/acme/home?a=1&b=2'))).toBe('/acme/home?a=1&b=2');
    expect(emailLinkNext(null, 'https://www.keptrow.com')).toBeNull();
    expect(emailLinkNext(null, null)).toBeNull();
  });
  it('keeps only paths on this site', () => {
    expect(emailLinkNext(null, back('//evil.com'))).toBeNull();
    expect(emailLinkNext(null, back('/\\evil.com'))).toBeNull();
    expect(emailLinkNext('//evil.com', back('//evil.com'))).toBeNull();
    expect(emailLinkNext(null, 'https://evil.com/elsewhere?next=/acme')).toBeNull();
    expect(emailLinkNext(null, 'not a url')).toBeNull();
    expect(emailLinkNext('/login/new-password', back('//evil.com'))).toBe('/login/new-password');
  });
});
