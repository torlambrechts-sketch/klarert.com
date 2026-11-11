import { describe, expect, it } from 'vitest';
import { fieldKeyFromName, keyBetween, keysBetween, needsRekey, suggestIdPrefix } from './ordering';

describe('ordering keys', () => {
  it('generates keys that sort between their neighbours', () => {
    const a = keyBetween(null, null);
    const c = keyBetween(a, null);
    const b = keyBetween(a, c);
    expect([c, a, b].sort()).toEqual([a, b, c]);
    const first = keyBetween(null, a);
    expect(first < a).toBe(true);
  });

  it('generates n ordered keys', () => {
    const keys = keysBetween(null, null, 5);
    expect(keys).toHaveLength(5);
    expect([...keys].sort()).toEqual(keys);
  });

  it('asks for a re-key only past 50 characters', () => {
    expect(needsRekey('a'.repeat(50))).toBe(false);
    expect(needsRekey('a'.repeat(51))).toBe(true);
  });
});

describe('fieldKeyFromName', () => {
  it.each([
    ['Due date', [], 'due_date'],
    ['Due date', ['due_date'], 'due_date_2'],
    ['Due date', ['due_date', 'due_date_2'], 'due_date_3'],
    ['Ansvarlig (ø/æ)', [], 'ansvarlig_o_ae'],
    ['2nd reviewer', [], 'f_2nd_reviewer'],
    ['!!!', [], 'field'],
    [
      'A very long field name that goes on and on and on',
      [],
      'a_very_long_field_name_that_goes_on',
    ],
  ])('%s with %j → %s', (name, taken, key) => {
    const k = fieldKeyFromName(name, taken);
    expect(k).toBe(key);
    expect(k).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
  });
});

describe('suggestIdPrefix', () => {
  it.each([
    ['Corrective actions', [], 'CA-'],
    ['Risks', [], 'R-'],
    ['Risks', ['R-'], 'R2-'],
    ['Supplier risk review board', [], 'SRR-'],
    ['Øvelser og tiltak', [], 'OOT-'],
    ['2026 audits', [], '2A-'],
    ['Hazards (HIRA) register', [], 'HHR-'],
    ['Corrective actions', ['CA-'], 'CA2-'],
    ['Corrective actions', ['CA-', 'CA2-'], 'CA3-'],
    ['', [], 'IT-'],
  ])('%s with %j → %s', (name, taken, prefix) => {
    const p = suggestIdPrefix(name, taken);
    expect(p).toBe(prefix);
    expect(p).toMatch(/^[A-Z0-9]{1,6}-$/);
  });
});
