import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createWorkspaceInput, orgRef } from '@/lib/schemas/workspace';
import { isReservedSlug, RESERVED_SLUGS } from './reserved-slugs';

const APP = new URL('../app/', import.meta.url);

// Files in a route folder that are not addresses of their own.
const NOT_ROUTES =
  /^(page|layout|template|loading|error|global-error|not-found|default|route|fonts)\.(tsx?|jsx?)$|\.css$/;
// Metadata files Next.js serves at the top level, by the address they get.
const METADATA: [RegExp, string][] = [
  [/^robots\.(ts|js|txt)$/, 'robots.txt'],
  [/^sitemap\.(ts|js|xml)$/, 'sitemap.xml'],
  [/^favicon\.ico$/, 'favicon.ico'],
  [/^opengraph-image\.\w+$/, 'opengraph-image'],
  [/^twitter-image\.\w+$/, 'twitter-image'],
  [/^icon\.\w+$/, 'icon'],
  [/^apple-icon\.\w+$/, 'apple-icon'],
  [/^manifest\.(ts|js|json|webmanifest)$/, 'manifest.webmanifest'],
];

/** The first path segment of every address under `dir` (route groups `(name)` add no segment). */
function topLevel(dir: URL): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (/^\(.+\)$/.test(e.name)) out.push(...topLevel(new URL(`${e.name}/`, dir)));
      else if (e.name.startsWith('[') || e.name.startsWith('@'))
        continue; // the workspace itself, slots
      else if (e.name.startsWith('_'))
        continue; // private folders are not routes
      else out.push(e.name);
    } else if (!NOT_ROUTES.test(e.name)) {
      const meta = METADATA.find(([re]) => re.test(e.name));
      // an unknown top-level file: decide whether it is an address, then list it here or above
      out.push(meta ? meta[1] : `unknown file: ${e.name}`);
    }
  }
  return out;
}

describe('reserved workspace addresses', () => {
  it('lists every top-level page and file of src/app', () => {
    const found = topLevel(APP);
    expect(found.length).toBeGreaterThan(5);
    expect(found.filter((s) => !(RESERVED_SLUGS as readonly string[]).includes(s))).toEqual([]);
  });

  it('includes what Next.js serves itself', () => {
    expect(RESERVED_SLUGS).toContain('_next');
  });

  it('matches the list the database refuses (the newest migration that defines it)', () => {
    const dir = new URL('../../supabase/migrations/', import.meta.url);
    const newest = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) =>
        readFileSync(new URL(f, dir), 'utf8').includes(
          'create or replace function _reserved_slugs()',
        ),
      )
      .pop();
    expect(newest).toBe('0077_reserved_slug_standards.sql');
    const sql = readFileSync(new URL(newest!, dir), 'utf8');
    const fn = sql.indexOf('create or replace function _reserved_slugs()');
    const start = sql.indexOf('array[', fn);
    const block = sql.slice(start, sql.indexOf(']', start));
    expect(fn).toBeGreaterThan(-1);
    expect([...block.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...RESERVED_SLUGS]);
  });

  it('compares trimmed and in lower case', () => {
    expect(isReservedSlug('account')).toBe(true);
    expect(isReservedSlug(' Privacy ')).toBe(true);
    expect(isReservedSlug('acme')).toBe(false);
    expect(isReservedSlug('accounts')).toBe(false);
  });

  it('a new workspace cannot take one; an existing workspace is still reached by its address', () => {
    const r = createWorkspaceInput.safeParse({ name: 'Acme', slug: 'Account', timeZone: 'UTC' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['slug', 'That address is reserved. Try another.'],
    ]);
    expect(
      createWorkspaceInput.safeParse({ name: 'Acme', slug: 'acme', timeZone: 'UTC' }).success,
    ).toBe(true);
    expect(orgRef.safeParse({ org: 'account' }).success).toBe(true);
  });
});
