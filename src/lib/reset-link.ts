// "This session was opened by a password reset link" for a link that opened its session with `verifyOtp` (the
// token-hash links of supabase/templates, docs/09 §12). Supabase Auth records `recovery` in the token's `amr` only
// for its PKCE code flow; `verifyOtp` records `otp`, as a sign-in link does (checked 17 Nov 2026 on GoTrue 2.197), so
// the token alone cannot tell a reset link from a sign-in link. The callback therefore sets an httpOnly cookie with an
// HMAC of the person and the session id, keyed by the server's secret: only the callback can make it, it holds for
// that one session only (a refreshed token keeps its session id, a new sign-in gets a new one), and a stolen value is
// no use without the session itself. Pure apart from the injected HMAC; src/server/reset-link.ts wires it in.

export const RESET_LINK_COOKIE = 'klarert-reset-link';

/** A session lasts 12 hours at most (supabase/config.toml [auth.sessions] timebox, docs/09 §8.3). */
export const RESET_LINK_MAX_AGE_S = 12 * 60 * 60;

type Hmac = (key: string, message: string) => string;

function sessionOf(claims: Record<string, unknown> | null): { sub: string; sid: string } | null {
  const sub = claims?.sub;
  const sid = claims?.session_id;
  if (typeof sub !== 'string' || sub === '' || typeof sid !== 'string' || sid === '') return null;
  return { sub, sid };
}

/**
 * The cookie value for the session in `claims`, or null without a person and session id. The message starts with a
 * word, so it can never equal a command proof (`<digits>.<user id>`, src/lib/supabase/command-proof.ts) made with
 * the same secret.
 */
export function resetLinkProof(
  secret: string,
  claims: Record<string, unknown> | null,
  hmacHex: Hmac,
): string | null {
  const s = sessionOf(claims);
  return s ? `v1.${hmacHex(secret, `reset-link.v1.${s.sub}.${s.sid}`)}` : null;
}

/** Equal strings, in time that does not depend on where they differ. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The cookie proves that a reset link opened the session in `claims`. */
export function hasResetLinkProof(
  cookie: string | null | undefined,
  secret: string | null,
  claims: Record<string, unknown> | null,
  hmacHex: Hmac,
): boolean {
  if (!cookie || !secret) return false;
  const want = resetLinkProof(secret, claims, hmacHex);
  return want !== null && same(cookie, want);
}
