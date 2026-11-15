import { createHmac, timingSafeEqual } from 'node:crypto';

// The server secret of public forms (docs/01 FR-25, docs/09 §6.1 and §7, SA-10): it keys the per-visitor rate-limit
// hash (HMAC of IP and form id, so the database never sees an address) and signs the "page served at" stamp behind
// the minimum fill time. It is FORM_RATE_LIMIT_SALT only, at least 32 characters, and never another secret. Without
// it public forms fail closed: the page says the form cannot take answers and every submission is refused.

export const MIN_SECRET_LENGTH = 32;

type Env = Readonly<Record<string, string | undefined>>;

/** FORM_RATE_LIMIT_SALT when it is set and long enough, else null. */
export function formSecret(env: Env = process.env): string | null {
  const value = env.FORM_RATE_LIMIT_SALT?.trim();
  return value && value.length >= MIN_SECRET_LENGTH ? value : null;
}

/** Logged on every refused use, so an operator sees why public forms stopped taking answers. */
export const MISSING_SECRET = `FORM_RATE_LIMIT_SALT is missing or shorter than ${MIN_SECRET_LENGTH} characters: public forms refuse every submission until it is set`;

export function logMissingSecret() {
  console.error(JSON.stringify({ level: 'error', source: 'public-form', message: MISSING_SECRET }));
}

/** The per-visitor key: HMAC-SHA-256 of the IP and the form id. */
export function visitorKey(secret: string, ip: string, formId: string): string {
  return createHmac('sha256', secret).update(`${ip}|${formId}`).digest('hex');
}

/** A signed "page served at" stamp for the form behind this token. */
export function startStamp(secret: string, token: string, now = Date.now()): string {
  const sig = createHmac('sha256', secret).update(`start|${token}|${now}`).digest('hex');
  return `${now}.${sig}`;
}

/** How long ago the page was served, or null when the stamp is not ours. */
export function elapsedSince(
  secret: string,
  token: string,
  stamp: string,
  now = Date.now(),
): number | null {
  const [t, sig] = stamp.split('.');
  const at = Number(t);
  if (!Number.isFinite(at) || !sig || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const want = createHmac('sha256', secret).update(`start|${token}|${at}`).digest();
  const got = Buffer.from(sig, 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return now - at;
}
