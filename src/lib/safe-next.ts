// Where to send a person after sign-in, onboarding or two-step sign-in (SA-2, docs/09 §8). A `next` value comes from
// the URL or a form, so anyone can write it: only a path on this site is kept. Browsers read `/\evil.com`,
// `/\t/evil.com` and `//evil.com` as another host, so backslashes, control characters (tab, newline …) and their
// percent-encoded forms are refused before the value is parsed. The parsed URL must keep the base's origin. Pure.

const BASE = 'https://next.invalid';
/** Backslash, C0 control characters (tab, line feed, carriage return …) and DEL. */
const UNSAFE = /[\\\u0000-\u001f\u007f]/;
const MAX_LENGTH = 2048;

/** The value and each percent-decoded form of it, while decoding changes it (at most 3 rounds). */
function decodings(value: string): string[] | null {
  const out = [value];
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return null; // a broken escape is never a path we wrote
    }
    if (decoded === current) break;
    out.push(decoded);
    current = decoded;
  }
  return out;
}

/**
 * A same-site path (`/acme/home?x=1#y`) to redirect to, or null when `next` is missing or could leave the site.
 * The result is the parsed path, query and hash, never the raw input.
 */
export function safeNext(next: unknown): string | null {
  if (typeof next !== 'string' || next.length === 0 || next.length > MAX_LENGTH) return null;
  const forms = decodings(next);
  if (!forms) return null;
  for (const form of forms) {
    if (UNSAFE.test(form)) return null;
    if (!form.startsWith('/') || form.startsWith('//')) return null;
  }
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
