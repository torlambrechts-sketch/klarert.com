import { safeNext } from './safe-next';

// Where the email-link callback (`/auth/callback`) sends a person (docs/05 §1, docs/09 §11). Supabase Auth's links
// (sign-in, confirm sign-up, reset password, change email) land there with a code, with an error, or, for the first of
// the two links of an email change, with only a message. Pure.

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
  /** Expired, used, opened in another browser or malformed. */
  | 'failed';

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
  if (path === NEW_PASSWORD_PATH) return `${FORGOT_PASSWORD_PATH}?error=link`;
  return '/login?error=link';
}
