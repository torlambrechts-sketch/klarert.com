import { describe, expect, it } from 'vitest';
import type { Framework } from '../frameworks/types';
import { siteCatalogue } from './site-catalogue';
import type { PackManifest } from './types';

const sheet = (ref: string, name: string, level?: string) =>
  ({ ref, name, level, isLibrary: false }) as unknown as PackManifest['sheets'][number];

const pack = (p: Partial<PackManifest> & Pick<PackManifest, 'key' | 'title'>): PackManifest =>
  ({
    version: '1.0.0',
    description: 'Fallback words: the rest. More.',
    requires: [],
    people: [],
    folders: [],
    sheets: [],
    automations: [],
    dashboards: [],
    ...p,
  }) as PackManifest;

const framework = (f: Partial<Framework> & Pick<Framework, 'key' | 'version' | 'title'>) =>
  ({
    status: 'current',
    supersededBy: null,
    transitionEnds: null,
    revisionStage: null,
    revisionExpected: null,
    statusNote: null,
    statusCheckedOn: '2026-11-14',
    revision: 1,
    shortTitle: f.title,
    publisher: 'ISO',
    kind: 'standard',
    source: '',
    licence: '',
    url: '',
    titles: 'official-short',
    library: { name: '', itemLabel: '', idPrefix: '', folder: '' },
    requirements: [
      { ref: '4', kind: 'theme', title: 'Context' },
      { ref: '4.1', kind: 'clause', title: 'One' },
      { ref: '4.2', kind: 'clause', title: 'Two' },
    ],
    ...f,
  }) as unknown as Framework;

const core = pack({
  key: 'core',
  title: 'Core registers',
  system: true,
  levels: [
    { key: 'foundations', name: 'Foundations', description: '' },
    { key: 'starter', name: 'Starter', description: '' },
  ],
  sheets: [
    sheet('risk', 'Risk register'),
    sheet('inc', 'Incidents', 'starter'),
    sheet('doc', 'Documents'),
  ],
});
const a = pack({
  key: 'a',
  title: 'A security (add-on)',
  extends: [
    { pack: 'core', sheet: 'inc' },
    { pack: 'core', sheet: 'risk' },
  ],
  frameworks: [{ key: 'x', version: '2015' }],
  sheets: [sheet('own', 'Own sheet')],
});
const b = pack({
  key: 'b',
  title: 'B quality (add-on)',
  extends: [{ pack: 'core', sheet: 'risk' }],
});
const c = pack({ key: 'c', title: 'C other (add-on)', extends: [{ pack: 'core', sheet: 'doc' }] });

const frameworks = [
  framework({
    key: 'x',
    version: '2015',
    title: 'X 2015',
    status: 'withdrawn',
    supersededBy: 'x@2026',
    transitionEnds: '2029-04-15',
  }),
  framework({ key: 'x', version: '2026', title: 'X 2026' }),
];

describe('siteCatalogue', () => {
  const site = siteCatalogue([core, a, b, c], frameworks, {
    core: { category: 'foundation', line: 'The base.' },
    a: { category: 'security-privacy', line: 'A, in our words.' },
    b: { category: 'quality-environment-safety', line: 'B, in our words.' },
  });
  const set = (key: string) =>
    [site.foundation, ...site.groups.flatMap((g) => g.sets)].find((s) => s?.key === key)!;

  it('puts the system pack first and every other pack in its site group', () => {
    expect(site.foundation?.key).toBe('core');
    expect(site.groups.map((g) => g.sets.map((s) => s.key))).toEqual([['a'], ['b'], ['c']]);
  });

  it('uses the plain words and the site line, falling back to the description’s first clause', () => {
    expect(set('core').title).toBe('Shared registers');
    expect(set('a').title).toBe('A security');
    expect(set('a').line).toBe('A, in our words.');
    expect(set('c').line).toBe('Fallback words.');
    expect(set('core').levels).toEqual(['Basic', 'Recommended']);
    expect(set('core').sheets).toEqual([
      { name: 'Risk register', level: null },
      { name: 'Incidents', level: 'Recommended' },
      { name: 'Documents', level: null },
    ]);
  });

  it('names the shared registers in the base’s order and who shares them', () => {
    expect(set('a').sharedRegisters).toEqual(['Risk register', 'Incidents']);
    expect(set('a').sharedWith).toEqual(['B quality']);
    expect(set('c').sharedWith).toEqual([]);
    expect(set('core').sharedWith).toEqual(['A security', 'B quality', 'C other']);
  });

  it('counts requirements without themes and shows the edition badge', () => {
    expect(set('a').libraries).toEqual([
      {
        title: 'X 2015',
        requirements: 2,
        badge: 'Withdrawn · replaced by X 2026 · transition ends Apr 2029',
        optional: false,
      },
    ]);
    expect(site.libraries.map((l) => [l.title, l.status, l.tone, l.usedBy])).toEqual([
      ['X 2015', 'Withdrawn', 'replaced', ['A security']],
      ['X 2026', 'Current edition', 'current', []],
    ]);
    expect(site.counts).toEqual({ sets: 4, frameworks: 1, editions: 2 });
  });
});
