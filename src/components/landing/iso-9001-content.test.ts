import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFrameworks } from '@/lib/frameworks/catalogue';
import { repoPacks } from '@/lib/packs/catalogue';
import screens from '@/lib/site/screens.json';
import { SITEMAP_PATHS, STANDARD_PAGES } from './content';
import * as page from './iso-9001-content';

const words = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(words)
      : value && typeof value === 'object'
        ? Object.values(value).flatMap(words)
        : [];

const text = words(page).join('\n');

describe('the ISO 9001 page copy', () => {
  it('starts sign-up with the catalogue key of the standard', () => {
    expect(repoPacks().map((p) => p.key)).toContain(page.ISO9001_PACK);
    expect(page.ISO9001_SIGNUP).toBe('/login?mode=signup&standard=iso-9001');
    expect(page.ISO9001_PAGE.hero.cta).toBe('Start with ISO 9001');
    expect(STANDARD_PAGES[page.ISO9001_PACK]).toBe(page.ISO9001_PATH);
    expect(SITEMAP_PATHS).toContain(page.ISO9001_PATH);
  });

  it('follows the copy rules (docs/15 §10, §12)', () => {
    expect(text).not.toContain('!');
    expect(text).not.toMatch(
      /ISO certified|ISO approved|guarantee|compliant out of the box|audit-ready in|AI-powered|tamper-proof|immutable|free forever|free trial|unlimited|seamless|powerful|single source of truth/i,
    );
    expect(text).toContain('Free while in early access. No card needed.');
    expect(text).toMatch(/a certification body certifies/);
  });

  it('never quotes the standard: no requirement title of the catalogue appears in the copy', () => {
    const titles = repoFrameworks()
      .filter((f) => f.key === 'iso-9001')
      .flatMap((f) => f.requirements)
      .filter((r) => r.kind !== 'theme' && r.title.split(' ').length >= 4)
      .map((r) => r.title);
    expect(titles.length).toBeGreaterThan(10);
    for (const t of titles) expect(text, t).not.toContain(t);
    expect(page.CLAUSES.map((c) => c.ref)).toEqual(['4', '5', '6', '7', '8', '9', '10']);
  });

  it('every screenshot it shows exists, with its size, and is captioned as the example workspace', () => {
    const shots = [
      ...page.PROCESSES.map((p) => p.shot),
      ...Object.values(page.SHOTS).map((s) => s.shot),
    ];
    for (const s of shots) {
      const entry = (screens as Record<string, { file: string; width: number; height: number }>)[s];
      expect(entry, s).toBeDefined();
      expect(entry!.width).toBeGreaterThan(0);
      expect(
        existsSync(new URL(`../../../public/site/screens/${entry!.file}`, import.meta.url)),
        s,
      ).toBe(true);
    }
    expect(page.EXAMPLE_CAPTION).toBe('Example workspace: Meridian Components Ltd');
  });

  it('has about eight questions, each answered', () => {
    expect(page.FAQ.length).toBeGreaterThanOrEqual(7);
    expect(page.FAQ.length).toBeLessThanOrEqual(10);
    for (const f of page.FAQ) expect(f.a.length, f.q).toBeGreaterThan(40);
  });
});
