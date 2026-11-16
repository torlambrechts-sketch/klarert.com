import { describe, expect, it } from 'vitest';
import { repoPacks } from '@/lib/packs/catalogue';
import * as content from './content';

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
});
