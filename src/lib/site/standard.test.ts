import { describe, expect, it } from 'vitest';
import { readStandardPage } from './standard';

describe('the ISO 9001 page’s facts, read from the catalogue', () => {
  const page = readStandardPage('iso-9001');

  it('leads with the edition the standard installs, then the one it replaces, with its status words', () => {
    expect(page.editions.map((e) => e.title)).toEqual(['ISO 9001:2026', 'ISO 9001:2015']);
    expect(page.editions[0]!.badge).toBeNull();
    expect(page.editions[1]!.badge).toBe(
      'Withdrawn · replaced by ISO 9001:2026 · transition ends Sep 2029',
    );
    expect(page.editions[1]!.note).toMatch(/30 September 2029/);
    expect(page.editions[1]!.checkedOn).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
  });

  it('counts requirements per clause and the one-to-one edition mapping', () => {
    const total = Object.values(page.editions[1]!.byClause).reduce((a, b) => a + b, 0);
    expect(total).toBe(page.editions[1]!.requirements);
    expect(Object.keys(page.editions[0]!.byClause).sort((a, b) => Number(a) - Number(b))).toEqual([
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
    expect(page.move).toMatchObject({ from: 'ISO 9001:2015', to: 'ISO 9001:2026' });
    expect(page.move!.equivalent).toBeGreaterThan(0);
    expect(page.move!.equivalent).toBeLessThanOrEqual(page.move!.of);
  });

  it('names the shared registers with the other standards that use them', () => {
    const nc = page.shared.find((s) => s.name === 'Nonconformities and CAPA');
    expect(nc?.usedBy).toEqual(expect.arrayContaining(['ISO 14001', 'ISO 45001']));
    for (const s of page.shared) expect(s.usedBy).not.toContain('ISO 9001');
  });

  it('refuses a standard the catalogue does not ship', () => {
    expect(() => readStandardPage('soc-2')).toThrow(/No standard/);
  });
});
