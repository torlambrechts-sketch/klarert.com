import { safeNext } from './safe-next';

// Where the email-link callback (`/auth/callback`) sends a person (docs/05 §1, docs/09 §12). Supabase Auth's links
// (sign-in, confirm sign-up, reset password, change email) land there in one of two ways:
// - our templates (supabase/templates) link to `/auth/confirm` with `token_hash`, `type`, the page's `next` and
//   `redirect_to` (the address the app asked Supabase Auth to send the person back to, which carries the page's own
//   `next`); its Continue button posts them to the callback, which opens the session with `verifyOtp`, so the link
//   works on any device and a link scanner's GET does not use it up (src/lib/email-link.ts);
// - Supabase's default templates (the hosted project until its templates are applied) link to Supabase Auth's verify
//   step, which comes back with a PKCE `code` (only the browser that asked holds its verifier), with an error, or, for
//   the first of the two links of an email change, with only a message. Pure.

/** The page that sets a new password after a reset link. */
export const NEW_PASSWORD_PATH = '/login/new-password';
export const FORGOT_PASSWORD_PATH = '/login/forgot-password';
export const ACCOUNT_PATH = '/account';

/**
 * How long Supabase Auth's email links work: `otp_expiry` in supabase/config.toml (3600 s) and the hosted project's
 * "Email OTP expiration". The emails (supabase/templates) and the pages say the same.
 */
export const EMAIL_LINK_EXPIRY = '1 hour';

export type LinkOutcome =
  /** The link opened a session (or confirmed the change). */
  | 'ok'
  /** One of the two links of an email change was opened; the other address must confirm too. */
  | 'confirm_other'
  /** A code link that failed: opened in another browser than the one that asked, expired, used or malformed. */
  | 'failed'
  /** A token-hash link Supabase Auth refused: expired or already used (it works in any browser). */
  | 'expired';

const BASE = 'https://link.invalid';

function withParam(path: string, key: string, value: string): string {
  const url = new URL(path, BASE);
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

/** What the callback's query says happened. */
export function linkOutcome(params: {
  code: string | null;
  tokenHash: string | null;
  error: string | null;
  message: string | null;
}): LinkOutcome | 'exchange' {
  if (params.error) return 'failed';
  if (params.code || params.tokenHash) return 'exchange';
  if (params.message) return 'confirm_other';
  return 'failed';
}

/**
 * Where a link goes when it worked: the template's `next` (a page) with the query the app asked for, which arrives in
 * `redirect_to` as that page's own `next` (`/auth/callback?next=/login/new-password%3Fnext%3D%252Facme`). The inner
 * value is used when the link names no page or the same page, so a reset link always lands on Set a new password.
 * Both through `safeNext`; anything else gives the template's `next`.
 */
export function emailLinkNext(next: string | null, redirectTo: string | null): string | null {
  const page = safeNext(next);
  let asked: string | null = null;
  try {
    const url = redirectTo ? new URL(redirectTo) : null;
    if (url?.pathname === '/auth/callback') asked = safeNext(url.searchParams.get('next'));
  } catch {
    asked = null;
  }
  if (!asked) return page;
  if (!page) return asked;
  return new URL(asked, BASE).pathname === new URL(page, BASE).pathname ? asked : page;
}

/** The path to redirect to, for a `next` from the link (checked by `safeNext`) and the outcome. */
export function afterEmailLink(next: unknown, outcome: LinkOutcome): string {
  const target = safeNext(next) ?? '/';
  const path = new URL(target, BASE).pathname;
  if (outcome === 'ok') return target;
  if (path === ACCOUNT_PATH)
    return withParam(
      target,
      'email',
      outcome === 'confirm_other' ? 'confirm-other' : 'link-failed',
    );
  if (outcome === 'confirm_other') return target;
  if (path === NEW_PASSWORD_PATH)
    return `${FORGOT_PASSWORD_PATH}?error=${outcome === 'expired' ? 'expired' : 'link'}`;
  return '/login?error=link';
}
