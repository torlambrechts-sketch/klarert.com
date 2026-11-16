import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIELD_TYPE_IDS } from '@/engine/fields/registry';
import { MAX_DEPTH } from '@/engine/automations/chain';
import { SET_COPY } from '@/components/landing/content';
import { repoFrameworks } from '@/lib/frameworks/catalogue';
import { readSiteCatalogue, siteFacts, soaExample } from './catalogue';

const dir = (path: string) => new URL(`../../../templates/${path}/`, import.meta.url);
const packFiles = readdirSync(dir('packs')).filter((f) => f.endsWith('.json'));
const packKeys = packFiles.map(
  (f) => (JSON.parse(readFileSync(new URL(f, dir('packs')), 'utf8')) as { key: string }).key,
);

describe('the site catalogue (/frameworks)', () => {
  const site = readSiteCatalogue();
  const sets = [site.foundation!, ...site.groups.flatMap((g) => g.sets)];

  it('lists every pack file of templates/packs exactly once, and nothing else', () => {
    expect(sets.map((s) => s.key).sort()).toEqual([...packKeys].sort());
    expect(site.counts.sets).toBe(packKeys.length);
  });

  it('has the site’s words for every pack: a group and one line, no pack left to the fallback', () => {
    for (const key of packKeys) {
      expect(SET_COPY[key], key).toBeDefined();
      expect(SET_COPY[key]!.line.length, key).toBeGreaterThan(20);
    }
    expect(Object.keys(SET_COPY).sort()).toEqual([...packKeys].sort());
  });

  it('groups the sets in the three site groups, the shared registers first on their own', () => {
    expect(site.groups.map((g) => g.title)).toEqual([
      'Information security and privacy',
      'Quality, environment and safety',
      'Supply chain and improvement',
    ]);
    expect(site.foundation?.title).toBe('Shared registers');
    for (const g of site.groups) expect(g.sets.length, g.title).toBeGreaterThan(0);
  });

  it('shows the plain words: no "(add-on)", no Core registers, levels Basic, Recommended, Everything', () => {
    for (const s of sets) {
      expect(s.title).not.toMatch(/add-on|Core registers/);
      for (const l of s.levels) expect(['Basic', 'Recommended', 'Everything']).toContain(l);
    }
    const isms = sets.find((s) => s.key === 'iso-27001')!;
    expect(isms.title).toBe('ISO/IEC 27001:2022 ISMS');
    expect(site.foundation!.levels).toEqual(['Basic', 'Recommended', 'Everything']);
  });

  it('every standard names the shared registers it builds on and the sets it shares them with', () => {
    for (const s of sets.filter((x) => x !== site.foundation)) {
      expect(s.sharedRegisters.length, s.key).toBeGreaterThan(0);
      expect(s.sharedWith.length, s.key).toBeGreaterThan(0);
      expect(s.sharedWith).not.toContain(s.title);
    }
    const gdpr = sets.find((s) => s.key === 'gdpr')!;
    expect(gdpr.sharedRegisters).toContain('Risk register');
    expect(gdpr.libraries.map((l) => l.title)).toEqual(['GDPR (Regulation (EU) 2016/679)']);
    expect(site.foundation!.sharedWith.length).toBe(sets.length - 1);
  });

  it('lists every framework edition with its status, never requirement text', () => {
    const frameworks = repoFrameworks();
    expect(site.libraries.map((l) => `${l.key}@${l.version}`)).toEqual(
      frameworks.map((f) => `${f.key}@${f.version}`),
    );
    expect(site.counts.frameworks).toBe(new Set(frameworks.map((f) => f.key)).size);
    const old = site.libraries.find((l) => l.key === 'iso-9001' && l.version === '2015')!;
    expect(old.badge).toMatch(/^Withdrawn · replaced by ISO 9001:2026 · transition ends/);
    // titles, numbers and our words only: no requirement titles reach the site
    const text = JSON.stringify(site);
    for (const f of frameworks)
      for (const r of f.requirements.filter((x) => x.kind !== 'theme' && x.title.length > 24))
        expect(text, r.title).not.toContain(r.title);
  });
});

describe('the site facts (the hero’s stats row)', () => {
  it('come from the registries and the catalogue', () => {
    const facts = siteFacts();
    expect(facts.fieldTypes).toBe(String(FIELD_TYPE_IDS.length));
    expect(facts.fieldTypes).toBe('58');
    expect(facts.loopGuard).toBe(`${MAX_DEPTH} levels`);
    expect(facts.frameworks).toBe(String(new Set(repoFrameworks().map((f) => f.key)).size));
    expect(facts.region).toBe('Frankfurt, EU');
  });
});

describe('the hero’s statement of applicability card', () => {
  it('counts the controls the statement lists', () => {
    expect(soaExample()).toEqual({ title: 'ISO/IEC 27001:2022', controls: 93 });
  });
});
