import { describe, expect, it } from 'vitest';
import { sheetCodes } from './sheet-codes';

const at = (n: number) => `2026-11-${String(n).padStart(2, '0')}T10:00:00Z`;
const codesOf = (names: string[]) => [
  ...sheetCodes(names.map((name, i) => ({ id: `s${i}`, name, createdAt: at(i + 1) }))).values(),
];

describe('sheetCodes', () => {
  it('uses the initials of the first two words, letters and digits only', () => {
    expect(codesOf(['Hazards (HIRA)'])).toEqual(['HH']);
    expect(codesOf(['Corrective actions'])).toEqual(['CA']);
    expect(codesOf(['ISO 27001 controls'])).toEqual(['I2']);
  });

  it('uses the first two characters of a one-word name', () => {
    expect(codesOf(['Risks'])).toEqual(['RI']);
    expect(codesOf(['X'])).toEqual(['XX']);
  });

  it('makes codes unique: first letter plus the next consonant', () => {
    expect(codesOf(['Corrective actions', 'Customer audits'])).toEqual(['CA', 'CS']);
    expect(codesOf(['Risks', 'Rivers'])).toEqual(['RI', 'RV']);
  });

  it('keeps older codes stable when a newer sheet arrives', () => {
    const sheets = [
      { id: 'new', name: 'Customer audits', createdAt: at(5) },
      { id: 'old', name: 'Corrective actions', createdAt: at(1) },
    ];
    const codes = sheetCodes(sheets);
    expect(codes.get('old')).toBe('CA');
    expect(codes.get('new')).toBe('CS');
  });

  it('never returns punctuation and always two characters', () => {
    const names = ['!!!', 'Å ø', 'a-b', '—', 'Tasks', 'Tasks', 'Tasks', 'Tasks'];
    const codes = codesOf(names);
    for (const c of codes) expect(c).toMatch(/^[A-Z0-9]{2}$/);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('stays unique for many sheets with the same name', () => {
    const codes = codesOf(Array.from({ length: 60 }, () => 'Audit'));
    expect(new Set(codes).size).toBe(60);
  });
});
