import { createHash, timingSafeEqual } from 'node:crypto';

// Vercel Cron calls the cron routes with `Authorization: Bearer ${CRON_SECRET}` (docs/04 §8–§9). Compared in constant
// time (both sides hashed first, so the length of the secret does not leak either). Without a configured secret of at
// least 16 characters every call is refused.
export const MIN_SECRET_LENGTH = 16;

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

export function isCronAuthorised(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return false;
  const given = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const ok = timingSafeEqual(digest(given), digest(secret));
  return ok && given.length > 0;
}
