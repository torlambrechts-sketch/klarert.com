import { describe, expect, it } from 'vitest';
import { COLUMN_STARTS, START_IDS, STARTS, startById } from './starts';

describe('wizard starts', () => {
  it('has the seven starts of docs/05 §4 in order', () => {
    expect(STARTS.map((s) => s.id)).toEqual([...START_IDS]);
  });

  it('gives the column starts a label, groups and known field types', () => {
    expect(COLUMN_STARTS.map((s) => s.id)).toEqual([
      'blank',
      'register',
      'tracker',
      'log',
      'inspection',
    ]);
    for (const s of COLUMN_STARTS) {
      expect(s.itemLabel).toBeTruthy();
      expect(s.groups?.length).toBeGreaterThan(0);
    }
    expect(startById('tracker')?.fields).toContainEqual(['Priority', 'severity']);
  });
});
