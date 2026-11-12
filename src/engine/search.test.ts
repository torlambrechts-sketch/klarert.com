import { describe, expect, it } from 'vitest';
import { itemScore, likePattern, rankSearch, textScore, type ItemHit } from './search';

const hit = (displayId: string, name: string, person?: string): ItemHit => ({
  id: displayId,
  sheetId: 's',
  sheetName: 'Corrective actions',
  displayId,
  name,
  ...(person ? { person } : {}),
});

describe('textScore', () => {
  it.each([
    ['Risk register', 'risk register', 0],
    ['Risk register', 'risk', 1],
    ['Supplier risk register', 'risk', 2],
    ['Cyber-risk', 'risk', 2],
    ['Asterisks', 'risk', 3],
    ['Ångström review', 'angstrom', 1],
    ['Risk register', 'audit', null],
    ['Risk register', '', null],
  ])('%j for %j = %j', (text, q, score) => {
    expect(textScore(text, q)).toBe(score);
  });
});

describe('rankSearch', () => {
  it('ranks sheets by how well the name matches', () => {
    const r = rankSearch(
      'risk',
      [
        { id: '1', name: 'Supplier risks' },
        { id: '2', name: 'Risk register' },
        { id: '3', name: 'Audits' },
        { id: '4', name: 'Asterisk log' },
      ],
      [],
    );
    expect(r.sheets.map((s) => s.name)).toEqual([
      'Risk register',
      'Supplier risks',
      'Asterisk log',
    ]);
  });

  it('a display id beats names; exact before prefix', () => {
    const r = rankSearch(
      'ca-014',
      [],
      [hit('CA-0145', 'Other'), hit('CA-014', 'Leaking valve'), hit('RI-001', 'See CA-014')],
    );
    expect(r.items.map((i) => i.displayId)).toEqual(['CA-014', 'CA-0145', 'RI-001']);
  });

  it('names: exact, starts with, word starts with, contains', () => {
    const r = rankSearch(
      'valve',
      [],
      [
        hit('CA-4', 'Replace the valves'),
        hit('CA-3', 'Valve'),
        hit('CA-2', 'Valve leak'),
        hit('CA-1', 'Bivalve audit'),
      ],
    );
    expect(r.items.map((i) => i.name)).toEqual([
      'Valve',
      'Valve leak',
      'Replace the valves',
      'Bivalve audit',
    ]);
  });

  it('items found through a person come after name matches', () => {
    const r = rankSearch(
      'maria',
      [],
      [hit('CA-2', 'Close audit', 'Maria Pereira'), hit('CA-1', 'Ask Maria')],
    );
    expect(r.items.map((i) => i.displayId)).toEqual(['CA-1', 'CA-2']);
    expect(itemScore(hit('CA-9', 'Unrelated', 'James Okafor'), 'maria')).toBeNull();
  });

  it('dedupes items and limits each group', () => {
    const many = Array.from({ length: 20 }, (_, i) => hit(`CA-${i}`, `Valve ${i}`));
    const r = rankSearch('valve', [], [...many, ...many]);
    expect(r.items).toHaveLength(8);
    expect(new Set(r.items.map((i) => i.id)).size).toBe(8);
  });

  it('an empty query finds nothing', () => {
    expect(rankSearch('   ', [{ id: '1', name: 'Risks' }], [hit('CA-1', 'x')])).toEqual({
      sheets: [],
      items: [],
    });
  });
});

describe('likePattern', () => {
  it('escapes LIKE wildcards', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
});
