// klarert.com stays a 301 redirect to www.keptrow.com for at least 12 months after the rename (owner decision,
// 16 Nov 2026; docs/14). next.config.ts turns LEGACY_REDIRECTS into host-based redirects, which Vercel applies
// before any page or middleware runs: same path, same query string. legacyRedirectTarget is the same rule as a
// function, for tests and for reasoning. Pure, and only relative imports, because next.config.ts loads this file.
import { SITE_URL } from '../brand';

/** The old hosts. The keptrow.com apex is not here: Vercel's primary-domain setting sends it to www (docs/14 step 3). */
export const LEGACY_HOSTS = ['klarert.com', 'www.klarert.com'] as const;

/** A Next.js `has` host value matches the whole host, as a regular expression. */
const LEGACY_HOST_PATTERN = '(?:www\\.)?klarert\\.com';

type HostRedirect = {
  source: string;
  has: { type: 'host'; value: string }[];
  destination: string;
  statusCode: 301;
};

/** The rule for next.config.ts `redirects()`: every path, query string carried over by Next.js. */
export const LEGACY_REDIRECTS: HostRedirect[] = [
  {
    source: '/:path*',
    has: [{ type: 'host', value: LEGACY_HOST_PATTERN }],
    destination: `${SITE_URL}/:path*`,
    statusCode: 301,
  },
];

/**
 * Where a request goes: the same path and query on www.keptrow.com when the host is an old one, otherwise null.
 * `host` may carry a port and any case, as a Host header can.
 */
export function legacyRedirectTarget(
  host: string | null | undefined,
  pathAndQuery: string,
): string | null {
  if (!host) return null;
  const name = host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (!(LEGACY_HOSTS as readonly string[]).includes(name)) return null;
  const rest = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  return `${SITE_URL}${rest}`;
}
