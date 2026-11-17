import 'server-only';
import { createHmac } from 'node:crypto';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import {
  RESET_LINK_COOKIE,
  RESET_LINK_MAX_AGE_S,
  hasResetLinkProof,
  resetLinkProof,
} from '@/lib/reset-link';
import { commandSecret } from '@/lib/supabase/command-proof';

// The reset-link cookie (src/lib/reset-link.ts), keyed by the server's secret (SUPABASE_COMMAND_SECRET, or the local
// development value against the local stack). Without a secret no cookie is made or accepted (fail closed).

const hmacHex = (key: string, message: string) =>
  createHmac('sha256', key).update(message).digest('hex');

const secret = () =>
  commandSecret({
    secret: process.env.SUPABASE_COMMAND_SECRET,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
  });

/** Remember that a reset link opened this session (only the email-link callback calls this). */
export async function markResetLinkSession(
  claims: Record<string, unknown> | null,
  secure: boolean,
) {
  const key = secret();
  const value = key ? resetLinkProof(key, claims, hmacHex) : null;
  if (!value) return;
  (await cookies()).set(RESET_LINK_COOKIE, value, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: RESET_LINK_MAX_AGE_S,
  });
}

/** A reset link opened the session in `claims` (its cookie matches). */
export async function isResetLinkSession(claims: Record<string, unknown> | null) {
  const cookie = (await cookies()).get(RESET_LINK_COOKIE)?.value;
  return hasResetLinkProof(cookie, secret(), claims, hmacHex);
}
