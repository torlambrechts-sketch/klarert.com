import { describe, expect, it, vi } from 'vitest';
import {
  confirmCopy,
  emailOtpType,
  openEmailLink,
  sameOriginPost,
  type EmailLinkDeps,
  type EmailLinkParams,
} from './email-link';

const none: EmailLinkParams = {
  code: null,
  tokenHash: null,
  type: null,
  error: null,
  message: null,
  next: null,
  redirectTo: null,
};

function deps(over: Partial<EmailLinkDeps> = {}) {
  return {
    exchangeCode: vi.fn(async () => true),
    verifyOtp: vi.fn(async () => ({ refused: false, accessToken: 'token' as string | null })),
    markResetLink: vi.fn(async () => {}),
    ...over,
  };
}

const back = (next: string) =>
  `http://localhost:3000/auth/callback?next=${encodeURIComponent(next)}`;

describe('emailOtpType and confirmCopy', () => {
  it('takes only the types verifyOtp knows', () => {
    expect(emailOtpType('recovery')).toBe('recovery');
    expect(emailOtpType('sms')).toBeNull();
    expect(emailOtpType(null)).toBeNull();
    expect(emailOtpType(['email'])).toBeNull();
  });
  it('words the page by type', () => {
    expect(confirmCopy('recovery')).toEqual({
      heading: 'Set a new password',
      button: 'Continue to set a new password',
    });
    expect(confirmCopy('email')).toEqual({
      heading: 'Sign in to Compliance OS',
      button: 'Continue',
    });
    expect(confirmCopy('magiclink')).toEqual(confirmCopy('email'));
    expect(confirmCopy('signup')).toEqual(confirmCopy('email'));
    expect(confirmCopy('email_change')).toEqual({
      heading: 'Confirm your new email address',
      button: 'Confirm',
    });
    expect(confirmCopy('invite')).toBeNull();
    expect(confirmCopy('nonsense')).toBeNull();
    expect(confirmCopy(null)).toBeNull();
  });
});

describe('openEmailLink', () => {
  it('opens a reset link and marks the session as a reset session', async () => {
    const d = deps();
    const to = await openEmailLink(
      {
        ...none,
        tokenHash: 'h',
        type: 'recovery',
        next: '/login/new-password',
        redirectTo: back('/login/new-password?next=/acme'),
      },
      d,
    );
    expect(to).toBe('/login/new-password?next=/acme');
    expect(d.verifyOtp).toHaveBeenCalledWith('h', 'recovery');
    expect(d.markResetLink).toHaveBeenCalledWith('token');
    expect(d.exchangeCode).not.toHaveBeenCalled();
  });
  it('opens a sign-in link without the reset mark, to the page the app asked for', async () => {
    const d = deps();
    const to = await openEmailLink(
      { ...none, tokenHash: 'h', type: 'email', redirectTo: back('/acme/home') },
      d,
    );
    expect(to).toBe('/acme/home');
    expect(d.markResetLink).not.toHaveBeenCalled();
  });
  it('says expired when Supabase Auth refuses the token (used or too old)', async () => {
    const d = deps({ verifyOtp: vi.fn(async () => ({ refused: true, accessToken: null })) });
    expect(
      await openEmailLink(
        { ...none, tokenHash: 'h', type: 'recovery', next: '/login/new-password' },
        d,
      ),
    ).toBe('/login/forgot-password?error=expired');
    expect(d.markResetLink).not.toHaveBeenCalled();
    expect(await openEmailLink({ ...none, tokenHash: 'h', type: 'email' }, d)).toBe(
      '/login?error=link',
    );
    expect(
      await openEmailLink({ ...none, tokenHash: 'h', type: 'email_change', next: '/account' }, d),
    ).toBe('/account?email=link-failed');
  });
  it('reads an email change link with no session as the first of two', async () => {
    const d = deps({ verifyOtp: vi.fn(async () => ({ refused: false, accessToken: null })) });
    expect(
      await openEmailLink({ ...none, tokenHash: 'h', type: 'email_change', next: '/account' }, d),
    ).toBe('/account?email=confirm-other');
    expect(await openEmailLink({ ...none, tokenHash: 'h', type: 'email' }, d)).toBe(
      '/login?error=link',
    );
  });
  it('does not call Supabase Auth for an unknown type, a missing token or an error', async () => {
    const d = deps();
    expect(await openEmailLink({ ...none, tokenHash: 'h', type: 'sms' }, d)).toBe(
      '/login?error=link',
    );
    expect(await openEmailLink({ ...none, type: 'email' }, d)).toBe('/login?error=link');
    expect(await openEmailLink({ ...none, code: 'c', error: 'access_denied' }, d)).toBe(
      '/login?error=link',
    );
    expect(d.verifyOtp).not.toHaveBeenCalled();
    expect(d.exchangeCode).not.toHaveBeenCalled();
  });
  it('exchanges a PKCE code', async () => {
    const ok = deps();
    expect(await openEmailLink({ ...none, code: 'c', redirectTo: back('/acme/home') }, ok)).toBe(
      '/acme/home',
    );
    expect(ok.exchangeCode).toHaveBeenCalledWith('c');
    expect(ok.verifyOtp).not.toHaveBeenCalled();
    const failed = deps({ exchangeCode: vi.fn(async () => false) });
    expect(
      await openEmailLink({ ...none, code: 'c', redirectTo: back('/login/new-password') }, failed),
    ).toBe('/login/forgot-password?error=link');
  });
  it('takes a message alone as the first of two email change links', async () => {
    const d = deps();
    expect(
      await openEmailLink({ ...none, message: 'Confirmation link accepted', next: '/account' }, d),
    ).toBe('/account?email=confirm-other');
  });
  it('never leaves the site', async () => {
    const d = deps();
    expect(
      await openEmailLink({ ...none, tokenHash: 'h', type: 'email', next: '//evil.com' }, d),
    ).toBe('/');
    expect(
      await openEmailLink(
        { ...none, tokenHash: 'h', type: 'email', redirectTo: back('/\\evil.com') },
        d,
      ),
    ).toBe('/');
  });
});

describe('sameOriginPost', () => {
  const host = 'www.klarert.com';
  it('takes Sec-Fetch-Site same-origin, also with Origin null (the page sends no referrer)', () => {
    expect(sameOriginPost({ secFetchSite: 'same-origin', origin: 'null', host })).toBe(true);
    expect(
      sameOriginPost({ secFetchSite: 'same-origin', origin: 'https://www.klarert.com', host }),
    ).toBe(true);
  });
  it('refuses another site, also a sibling subdomain, whatever the Origin says', () => {
    expect(
      sameOriginPost({ secFetchSite: 'cross-site', origin: 'https://evil.example', host }),
    ).toBe(false);
    expect(
      sameOriginPost({ secFetchSite: 'same-site', origin: 'https://app.klarert.com', host }),
    ).toBe(false);
    expect(
      sameOriginPost({ secFetchSite: 'cross-site', origin: 'https://www.klarert.com', host }),
    ).toBe(false);
    expect(sameOriginPost({ secFetchSite: 'none', origin: null, host })).toBe(false);
  });
  it('without Sec-Fetch-Site, needs an Origin of this host', () => {
    expect(sameOriginPost({ secFetchSite: null, origin: 'https://www.klarert.com', host })).toBe(
      true,
    );
    expect(sameOriginPost({ secFetchSite: null, origin: 'https://evil.example', host })).toBe(
      false,
    );
    expect(sameOriginPost({ secFetchSite: null, origin: 'null', host })).toBe(false);
    expect(sameOriginPost({ secFetchSite: null, origin: null, host })).toBe(false);
    expect(
      sameOriginPost({ secFetchSite: null, origin: 'https://www.klarert.com', host: null }),
    ).toBe(false);
  });
});
