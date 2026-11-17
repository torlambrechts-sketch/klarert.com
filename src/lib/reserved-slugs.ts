// Workspace addresses that are the app's own pages (owner decision, 16 Nov 2026). A workspace lives at `/{slug}`, so
// a workspace called `account` or `privacy` would be hidden behind that page. These are the top-level route segments
// under `src/app` (reserved-slugs.test.ts scans it and fails when a new one is missing here) and what Next.js serves
// at the top level, plus the public site's /platform, /frameworks and /standards. The same list is in SQL
// (`_reserved_slugs()`, migration 0073, replaced by 0077 to add `standards`), so `create_workspace`, `workspace_slug_available` and a change to `orgs.slug` refuse them too. Workspaces that already had one keep it.

export const RESERVED_SLUGS = [
  '_next',
  'account',
  'account-deleted',
  'api',
  'auth',
  'f',
  'favicon.ico',
  'frameworks',
  'invite',
  'login',
  'onboarding',
  'opengraph-image',
  'platform',
  'poster',
  'privacy',
  'robots.txt',
  'sitemap.xml',
  'standards',
  'terms',
] as const;

export const RESERVED_SLUG_MESSAGE = 'That address is reserved. Try another.';

const reserved = new Set<string>(RESERVED_SLUGS);

/** Compared as the database stores slugs: trimmed and lower case. */
export function isReservedSlug(slug: string): boolean {
  return reserved.has(slug.trim().toLowerCase());
}
