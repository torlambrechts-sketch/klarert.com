import { describe, expect, it } from 'vitest';
import { requirementKey } from '@/engine/frameworks/refs';
import { frameworkPacks, repoCrosswalks, repoFrameworks } from './catalogue';
import { MAX_TITLE, parseFramework } from './schema';

const frameworks = repoFrameworks();
const byKey = new Map(frameworks.map((f) => [f.key, f]));
const iso27001 = byKey.get('iso-27001')!;

describe('the shipped catalogue', () => {
  it('has the six frameworks', () => {
    expect(frameworks.map((f) => `${f.key}@${f.version}`)).toEqual([
      'iso-27001@2022',
      'iso-9001@2015',
      'iso-14001@2015',
      'iso-45001@2018',
      'gdpr@2016',
      'nis2@2022',
    ]);
  });

  it('ISO/IEC 27001:2022 Annex A has exactly 93 controls, 37 + 8 + 14 + 34, numbered without gaps', () => {
    const controls = iso27001.requirements.filter((r) => r.kind === 'control');
    expect(controls).toHaveLength(93);
    const expected = (
      [
        ['A.5', 37],
        ['A.6', 8],
        ['A.7', 14],
        ['A.8', 34],
      ] as const
    ).flatMap(([theme, n]) => Array.from({ length: n }, (_, i) => `${theme}.${i + 1}`));
    expect(controls.map((c) => c.ref)).toEqual(expected);
    for (const [theme, n] of [
      ['A.5', 37],
      ['A.6', 8],
      ['A.7', 14],
      ['A.8', 34],
    ] as const)
      expect(controls.filter((c) => c.parent === theme)).toHaveLength(n);
  });

  it('ISO/IEC 27001:2022 lists clauses 4 to 10 to the level auditors use', () => {
    const clauses = iso27001.requirements.filter((r) => r.kind === 'clause').map((r) => r.ref);
    for (const ref of [
      '4.1',
      '4.4',
      '5.3',
      '6.1.1',
      '6.1.2',
      '6.1.3',
      '6.2',
      '6.3',
      '7.5.3',
      '8.3',
    ])
      expect(clauses).toContain(ref);
    for (const ref of ['9.1', '9.2.1', '9.2.2', '9.3.1', '9.3.2', '9.3.3', '10.1', '10.2'])
      expect(clauses).toContain(ref);
    expect(clauses).toHaveLength(34);
  });

  it('marks the controls new in the 2022 edition', () => {
    const fresh = iso27001.requirements
      .filter((r) => r.tags.includes('new-2022'))
      .map((r) => r.ref);
    expect(fresh.sort()).toEqual(
      [
        'A.5.7',
        'A.5.23',
        'A.5.30',
        'A.7.4',
        'A.8.9',
        'A.8.10',
        'A.8.11',
        'A.8.12',
        'A.8.16',
        'A.8.23',
        'A.8.28',
      ].sort(),
    );
  });

  it('NIS2 Article 21(2) has the ten measures (a) to (j) and Article 23 the reporting steps', () => {
    const refs = byKey.get('nis2')!.requirements.map((r) => r.ref);
    for (const p of 'abcdefghij') expect(refs).toContain(`Art. 21(2)(${p})`);
    for (const p of 'abcd') expect(refs).toContain(`Art. 23(4)(${p})`);
  });

  it('GDPR lists the articles a compliance team works with', () => {
    const refs = byKey.get('gdpr')!.requirements.map((r) => r.ref);
    for (const n of [
      5, 6, 7, 9, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 28, 30, 32, 33, 34, 35, 37,
      38, 39, 44, 45, 46, 47, 48, 49,
    ])
      expect(refs).toContain(`Art. ${n}`);
  });

  it('every framework says what may be shipped: short titles only, everything else our own words', () => {
    for (const f of frameworks) {
      expect(f.licence.length).toBeGreaterThan(20);
      expect(['own-words', 'official-short']).toContain(f.titles);
      expect(f.source).not.toBe('');
      if (f.kind === 'standard') expect(f.licence).toMatch(/not the text of the standard/i);
    }
  });

  it('every requirement carries our own purpose, guidance, audit questions and typical evidence', () => {
    for (const f of frameworks)
      for (const r of f.requirements) {
        expect(r.purpose, `${f.key} ${r.ref}`).toBeTruthy();
        if (r.kind === 'theme') continue;
        expect(r.guidance, `${f.key} ${r.ref}`).toBeTruthy();
        expect(r.questions.length, `${f.key} ${r.ref}`).toBeGreaterThanOrEqual(3);
        expect(r.evidence.length, `${f.key} ${r.ref}`).toBeGreaterThanOrEqual(3);
      }
  });

  it('has no duplicate refs, short non-empty titles, and parents listed first', () => {
    for (const f of frameworks) {
      const refs = f.requirements.map((r) => r.ref);
      expect(new Set(refs).size).toBe(refs.length);
      for (const r of f.requirements) {
        expect(r.title.trim()).not.toBe('');
        expect(r.title.length).toBeLessThanOrEqual(MAX_TITLE);
        if (r.parent) expect(refs.indexOf(r.parent)).toBeLessThan(refs.indexOf(r.ref));
      }
    }
  });

  it('refuses a framework without the licence marker, a duplicate ref or a long title', () => {
    const raw = {
      key: 'x',
      version: '2026',
      revision: 1,
      title: 'X',
      shortTitle: 'X',
      publisher: 'X',
      kind: 'internal',
      source: 'X',
      licence: 'Ours.',
      url: 'https://example.com',
      titles: 'own-words',
      library: { name: 'X', itemLabel: 'Item', idPrefix: 'X-', folder: 'F' },
      requirements: [
        { ref: '1', kind: 'theme', title: 'One' },
        { ref: '1.1', parent: '1', kind: 'clause', title: 'A' },
      ],
    };
    expect(() => parseFramework(raw)).not.toThrow();
    expect(() => parseFramework({ ...raw, titles: 'verbatim' })).toThrow();
    expect(() =>
      parseFramework({ ...raw, requirements: [...raw.requirements, raw.requirements[1]] }),
    ).toThrow(/Duplicate ref/);
    expect(() =>
      parseFramework({
        ...raw,
        requirements: [raw.requirements[0], { ...raw.requirements[1], title: 'x'.repeat(81) }],
      }),
    ).toThrow();
    expect(() =>
      parseFramework({ ...raw, requirements: [{ ref: '1.1', kind: 'clause', title: 'A' }] }),
    ).toThrow(/needs a parent theme/);
  });
});

describe('the shipped cross-walks', () => {
  const crosswalks = repoCrosswalks();
  const known = new Set(
    frameworks.flatMap((f) =>
      f.requirements.map((r) =>
        requirementKey({ framework: f.key, version: f.version, ref: r.ref }),
      ),
    ),
  );

  it('every end of every cross-walk is a requirement of the catalogue', () => {
    for (const c of crosswalks) {
      expect(known, requirementKey(c.from)).toContain(requirementKey(c.from));
      expect(known, requirementKey(c.to)).toContain(requirementKey(c.to));
    }
  });

  it('never maps a requirement to itself or within one framework, and says where it comes from', () => {
    for (const c of crosswalks) {
      expect(`${c.from.framework}@${c.from.version}`).not.toBe(`${c.to.framework}@${c.to.version}`);
      expect(c.source).toBe('Klarert mapping v1');
    }
  });

  it('has no pair twice', () => {
    const pairs = crosswalks.map((c) =>
      [requirementKey(c.from), requirementKey(c.to)].sort().join(' ~ '),
    );
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('maps the harmonised clauses of the four ISO standards and Annex A to NIS2 and GDPR', () => {
    const has = (a: string, b: string) =>
      crosswalks.some(
        (c) =>
          (requirementKey(c.from) === a && requirementKey(c.to) === b) ||
          (requirementKey(c.from) === b && requirementKey(c.to) === a),
      );
    expect(has('iso-27001@2022#7.5', 'iso-9001@2015#7.5')).toBe(true);
    expect(has('iso-27001@2022#10.1', 'iso-9001@2015#10.3')).toBe(true);
    expect(has('iso-14001@2015#9.2', 'iso-45001@2018#9.2')).toBe(true);
    expect(has('iso-27001@2022#A.8.24', 'nis2@2022#Art. 21(2)(h)')).toBe(true);
    expect(has('gdpr@2016#Art. 33', 'iso-27001@2022#A.5.26')).toBe(true);
    const counts = new Map<string, number>();
    for (const c of crosswalks) counts.set(c.relation, (counts.get(c.relation) ?? 0) + 1);
    expect(counts.get('equivalent')).toBeGreaterThan(50);
    expect(counts.get('related')).toBeGreaterThan(20);
  });
});

describe('framework libraries as packs', () => {
  const packs = frameworkPacks(frameworks);

  it('one pack per framework, with one library item per requirement that is not a theme', () => {
    expect(packs.map((p) => `${p.key} ${p.version}`)).toEqual([
      'framework-iso-27001 2022.2.0',
      'framework-iso-9001 2015.2.0',
      'framework-iso-14001 2015.2.0',
      'framework-iso-45001 2018.2.0',
      'framework-gdpr 2016.2.0',
      'framework-nis2 2022.2.0',
    ]);
    for (const [i, f] of frameworks.entries()) {
      const sheet = packs[i]!.sheets[0]!;
      expect(sheet.isLibrary).toBe(true);
      expect(sheet.items).toHaveLength(f.requirements.filter((r) => r.kind !== 'theme').length);
      expect(sheet.groups).toHaveLength(f.requirements.filter((r) => r.kind === 'theme').length);
      expect(sheet.description).toContain(f.licence);
    }
    expect(packs[0]!.sheets[0]!.items).toHaveLength(93 + 34);
  });

  it('ID prefixes are unique across the libraries', () => {
    const prefixes = packs.map((p) => p.sheets[0]!.idPrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
