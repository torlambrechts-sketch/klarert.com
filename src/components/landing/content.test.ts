import { describe, expect, it } from 'vitest';
import { FIELD_TYPE_IDS } from '@/engine/fields/registry';
import { repoPacks } from '@/lib/packs/catalogue';
import * as content from './content';
import * as legal from './legal';

const words = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(words)
      : value && typeof value === 'object'
        ? Object.values(value).flatMap(words)
        : [];

describe('product site copy', () => {
  it('names only standards the catalogue ships', () => {
    const keys = new Set(repoPacks().map((p) => p.key));
    for (const s of content.STANDARDS) expect(keys, s.name).toContain(s.pack);
  });

  it('Corrective actions stands for the Core registers’ CAPA register', () => {
    const core = repoPacks().find((p) => p.key === 'core')!;
    expect(core.sheets.map((s) => s.name)).toContain('Nonconformities and CAPA');
  });

  it('follows the copy rules: no exclamation marks, sign-up goes to the existing page', () => {
    for (const w of words(content)) expect(w, w).not.toContain('!');
    expect(content.LINKS.createAccount).toBe('/login?mode=signup');
    expect(content.LINKS.signIn).toBe('/login');
  });

  it('robots and the sitemap list only the public pages', () => {
    expect([...content.PUBLIC_PATHS]).toEqual(['/', '/privacy', '/terms']);
    expect([...content.SITEMAP_PATHS]).toEqual([
      '/',
      '/platform',
      '/frameworks',
      '/standards/iso-9001',
      '/privacy',
      '/terms',
    ]);
  });

  it('the numbers in the copy are the product’s: field types from the registry', () => {
    for (const w of words(content))
      for (const m of w.matchAll(/(\d+) field types/g))
        expect(Number(m[1]), w).toBe(FIELD_TYPE_IDS.length);
  });

  it('every platform card links to a section of /platform, each with its own anchor', () => {
    const anchors = content.PLATFORM_FEATURES.map((f) => f.key);
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const f of content.FEATURES) expect(anchors, f.key).toContain(f.key);
    expect(content.NAV.map((n) => n.href)).toEqual(['/platform', '/frameworks']);
  });

  it('names no level "Standard" and uses the plain pack words', () => {
    const text = words(content).join(' ');
    expect(text).not.toMatch(/\(add-on\)|Core registers|\bStarter\b|\bFoundations\b/);
  });
});

describe('privacy notice and terms (drafts)', () => {
  const pages = [legal.PRIVACY, legal.TERMS];
  const runs = (page: legal.LegalPage): legal.Inline[] => [
    ...page.intro,
    ...page.sections.flatMap((s) => s.blocks.flatMap((b) => ('p' in b ? b.p : b.list.flat()))),
  ];

  it('follows the copy rules: no exclamation marks', () => {
    for (const w of words(legal)) expect(w, w).not.toContain('!');
  });

  it('every placeholder on a page is in PLACEHOLDERS, and every one in PLACEHOLDERS is used', () => {
    const listed = new Set<string>(Object.values(legal.PLACEHOLDERS));
    const used = new Set<string>();
    for (const page of pages)
      for (const run of runs(page))
        if (typeof run === 'object' && 'placeholder' in run) {
          expect(listed, run.placeholder).toContain(run.placeholder);
          used.add(run.placeholder);
        }
    expect([...used].sort()).toEqual([...listed].sort());
  });

  it('gives one contact address and links only to our own pages or that address', () => {
    expect(content.CONTACT.email).toBe('support@klarert.com');
    for (const page of pages)
      for (const run of runs(page))
        if (typeof run === 'object' && 'link' in run)
          expect(['/privacy', '/terms', `mailto:${content.CONTACT.email}`], run.text).toContain(
            run.link,
          );
  });

  it('names exactly the three subprocessors, and the facts the notice rests on', () => {
    const section = legal.PRIVACY.sections.find((s) => s.id === 'subprocessors')!;
    const list = section.blocks.find((b) => 'list' in b) as { list: legal.Inline[][] };
    expect(list.list.map((item) => String(item[0]).split(':')[0])).toEqual([
      'Supabase',
      'Vercel',
      'Brevo',
    ]);
    const text = words(legal.PRIVACY).join(' ');
    for (const fact of ['Frankfurt', 'fra1', 'Former member', 'hash-chained', 'no analytics'])
      expect(text).toContain(fact);
  });

  it('the privacy notice has the agreed sections, in order', () => {
    expect(legal.PRIVACY.sections.map((s) => s.title)).toEqual([
      'Who we are',
      'What we collect',
      'Why we use it',
      'Where it is stored',
      'Subprocessors',
      'How long it is kept',
      'Your rights',
      'Contact',
    ]);
  });
});
