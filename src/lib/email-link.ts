import type { EmailOtpType } from '@supabase/supabase-js';
import { afterEmailLink, emailLinkNext, linkOutcome, type LinkOutcome } from './auth-links';
import { BRAND } from './brand';

// Opening an email link (docs/09 §12): the one place that turns a link's parameters into a session and a page to go
// to. Two routes call it: POST `/auth/callback`, the Continue button of `/auth/confirm` (our templates' token-hash
// links, used only when the person clicks, so a link scanner that opens every link in an email cannot use up the
// token), and GET `/auth/callback` (PKCE `code` links from Supabase's default templates, and, for a transition
// period, token-hash links from emails sent before `/auth/confirm`). Pure: Supabase Auth and the reset-link cookie
// are injected (src/server/email-link.ts wires them in).

/** The `type` values `verifyOtp` takes (supabase-js 2.119); our templates send `email`, `recovery`, `email_change`. */
const EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  'email',
  'recovery',
  'email_change',
  'signup',
  'magiclink',
  'invite',
];

export function emailOtpType(raw: unknown): EmailOtpType | null {
  return typeof raw === 'string' && (EMAIL_OTP_TYPES as readonly string[]).includes(raw)
    ? (raw as EmailOtpType)
    : null;
}

export type ConfirmCopy = { heading: string; button: string };

/** What `/auth/confirm` says for each kind of link (owner decision 17 Nov 2026). */
const CONFIRM_COPY = {
  recovery: { heading: 'Set a new password', button: 'Continue to set a new password' },
  email: { heading: `Sign in to ${BRAND.product}`, button: 'Continue' },
  email_change: { heading: 'Confirm your new email address', button: 'Confirm' },
} satisfies Record<string, ConfirmCopy>;

/** The heading and button of `/auth/confirm` for a link's `type`; null for a type our templates never send. */
export function confirmCopy(type: unknown): ConfirmCopy | null {
  switch (emailOtpType(type)) {
    case 'recovery':
      return CONFIRM_COPY.recovery;
    case 'email_change':
      return CONFIRM_COPY.email_change;
    // `signup` and `magiclink` are the deprecated names of `email`
    case 'email':
    case 'signup':
    case 'magiclink':
      return CONFIRM_COPY.email;
    default:
      return null;
  }
}

export type EmailLinkParams = {
  code: string | null;
  tokenHash: string | null;
  type: string | null;
  error: string | null;
  message: string | null;
  next: string | null;
  redirectTo: string | null;
};

export type EmailLinkDeps = {
  /** Supabase Auth's PKCE exchange; true when it opened a session. */
  exchangeCode: (code: string) => Promise<boolean>;
  /** Supabase Auth's `verifyOtp`: refused, or the access token of the session it opened (null: no session). */
  verifyOtp: (
    tokenHash: string,
    type: EmailOtpType,
  ) => Promise<{ refused: boolean; accessToken: string | null }>;
  /** Remember that a reset link opened the session of `accessToken` (src/lib/reset-link.ts). */
  markResetLink: (accessToken: string) => Promise<void>;
};

/** Open the link (at most one call to Supabase Auth) and return the path to send the person to. */
export async function openEmailLink(p: EmailLinkParams, deps: EmailLinkDeps): Promise<string> {
  const next = emailLinkNext(p.next, p.redirectTo);
  let outcome: LinkOutcome | 'exchange' = linkOutcome(p);
  if (outcome === 'exchange') {
    const type = emailOtpType(p.type);
    if (p.code) outcome = (await deps.exchangeCode(p.code)) ? 'ok' : 'failed';
    else if (p.tokenHash && type) {
      const { refused, accessToken } = await deps.verifyOtp(p.tokenHash, type);
      if (refused) outcome = 'expired';
      else if (!accessToken) outcome = type === 'email_change' ? 'confirm_other' : 'failed';
      else {
        outcome = 'ok';
        // only a session a reset link opened may set a password without the current one (docs/09 §12)
        if (type === 'recovery') await deps.markResetLink(accessToken);
      }
    } else outcome = 'failed';
  }
  return afterEmailLink(next, outcome);
}

/**
 * A POST that may open an email link comes from a page of this site (CSRF, docs/09 §12): another site's form must
 * not use up a token. `Sec-Fetch-Site` (every current browser) must be `same-origin`; without it, the `Origin` must be
 * this host. `/auth/confirm` sends no referrer, so a browser posts its form with `Origin: null`: that alone, without
 * `Sec-Fetch-Site`, is refused (fail closed), as is a POST with neither header.
 */
export function sameOriginPost(h: {
  secFetchSite: string | null;
  origin: string | null;
  host: string | null;
}): boolean {
  if (h.secFetchSite) return h.secFetchSite === 'same-origin';
  if (!h.origin || !h.host) return false;
  try {
    return new URL(h.origin).host === h.host;
  } catch {
    return false;
  }
}
