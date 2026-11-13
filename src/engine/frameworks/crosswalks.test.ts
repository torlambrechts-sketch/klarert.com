import { describe, expect, it } from 'vitest';
import {
  alsoSatisfies,
  crosswalkIndex,
  expandCrosswalks,
  suggestEquivalents,
  type AdoptedRequirement,
} from './crosswalks';
import { parseRequirementKey, requirementKey, requirementLabel } from './refs';

const file = {
  source: 'Test mapping v1',
  sets: [
    {
      relation: 'equivalent' as const,
      note: 'Context',
      members: ['a@1#4.1', 'b@1#4.1', 'c@1#4.1'],
      partial: ['c@1#4.1'],
    },
  ],
  pairs: [
    { from: 'a@1#X.1', to: 'b@1#7.5', relation: 'related' as const, note: 'Loose' },
    { from: 'a@1#X.1', to: 'b@1#8.1', relation: 'partial' as const },
    { from: 'b@1#8.1', to: 'a@1#X.1', relation: 'equivalent' as const },
  ],
};

const adopted = (keys: string[]): Map<string, AdoptedRequirement> =>
  new Map(
    keys.map((key, order) => {
      const id = parseRequirementKey(key)!;
      return [
        key,
        {
          key,
          itemId: `item-${key}`,
          sheetId: `sheet-${id.framework}`,
          displayId: `${id.framework.toUpperCase()}-${order + 1}`,
          name: `Requirement ${id.ref}`,
          label: requirementLabel(id.framework.toUpperCase(), id.ref),
          order,
        },
      ];
    }),
  );

describe('requirement keys', () => {
  it('round-trips framework, version and ref, refs with spaces and brackets too', () => {
    const id = { framework: 'nis2', version: '2022', ref: 'Art. 21(2)(a)' };
    expect(requirementKey(id)).toBe('nis2@2022#Art. 21(2)(a)');
    expect(parseRequirementKey(requirementKey(id))).toEqual(id);
    expect(parseRequirementKey('nonsense')).toBeNull();
    expect(parseRequirementKey('Iso@2022#A.1')).toBeNull();
  });
});

describe('expandCrosswalks', () => {
  it('makes one cross-walk per pair of a set; a partial member makes its pairs partial', () => {
    const list = expandCrosswalks(file);
    const sets = list.filter((c) => c.note === 'Context');
    expect(sets).toHaveLength(3);
    const rel = (a: string, b: string) =>
      sets.find((c) => requirementKey(c.from) === a && requirementKey(c.to) === b)?.relation;
    expect(rel('a@1#4.1', 'b@1#4.1')).toBe('equivalent');
    expect(rel('a@1#4.1', 'c@1#4.1')).toBe('partial');
    expect(rel('b@1#4.1', 'c@1#4.1')).toBe('partial');
    expect(list.every((c) => c.source === 'Test mapping v1')).toBe(true);
  });

  it('refuses a malformed key', () => {
    expect(() =>
      expandCrosswalks({ ...file, pairs: [{ from: 'x', to: 'b@1#1', relation: 'related' }] }),
    ).toThrow(/not a requirement key/);
  });
});

describe('crosswalkIndex and alsoSatisfies', () => {
  const index = crosswalkIndex(expandCrosswalks(file));

  it('works both ways and keeps the stronger relation of a pair named twice', () => {
    expect(
      index
        .get('b@1#4.1')!
        .map((l) => l.key)
        .sort(),
    ).toEqual(['a@1#4.1', 'c@1#4.1']);
    expect(index.get('a@1#X.1')!.find((l) => l.key === 'b@1#8.1')!.relation).toBe('equivalent');
    expect(index.get('b@1#8.1')!.find((l) => l.key === 'a@1#X.1')!.relation).toBe('equivalent');
  });

  it('lists only requirements of adopted frameworks, strongest first', () => {
    const lib = adopted(['b@1#7.5', 'b@1#8.1', 'b@1#4.1']);
    const out = alsoSatisfies('a@1#X.1', index, lib);
    expect(out.map((o) => [o.requirement.key, o.relation])).toEqual([
      ['b@1#8.1', 'equivalent'],
      ['b@1#7.5', 'related'],
    ]);
    expect(alsoSatisfies('a@1#4.1', index, adopted(['b@1#4.1']))).toHaveLength(1);
    expect(alsoSatisfies('a@1#4.1', index, new Map())).toEqual([]);
    expect(alsoSatisfies('unknown@1#1', index, lib)).toEqual([]);
  });
});

describe('suggestEquivalents', () => {
  const index = crosswalkIndex(expandCrosswalks(file));
  const lib = adopted(['a@1#4.1', 'a@1#X.1', 'b@1#4.1', 'b@1#7.5', 'b@1#8.1', 'c@1#4.1']);

  it('suggests equivalent and partial requirements the control is not linked to yet', () => {
    const out = suggestEquivalents(['a@1#4.1', 'a@1#X.1'], index, lib);
    expect(out.map((s) => [s.requirement.key, s.relation])).toEqual([
      ['b@1#4.1', 'equivalent'],
      ['b@1#8.1', 'equivalent'],
      ['c@1#4.1', 'partial'],
    ]);
  });

  it('leaves out what is linked already and related ones unless asked', () => {
    expect(suggestEquivalents(['a@1#4.1', 'b@1#4.1', 'c@1#4.1'], index, lib)).toEqual([]);
    const loose = suggestEquivalents(['a@1#X.1'], index, lib, ['related']);
    expect(loose.map((s) => s.requirement.key)).toEqual(['b@1#7.5']);
  });

  it('a requirement reached twice lists both and keeps the stronger relation', () => {
    const out = suggestEquivalents(['b@1#4.1', 'a@1#4.1'], index, lib);
    expect(out).toHaveLength(1);
    expect(out[0]!.requirement.key).toBe('c@1#4.1');
    expect(out[0]!.via.sort()).toEqual(['a@1#4.1', 'b@1#4.1']);
  });
});
