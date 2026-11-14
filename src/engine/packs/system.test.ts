import { describe, expect, it } from 'vitest';
import { standardsOf, systemColumnText, usedByText } from './system';

const standards = (options: unknown[]) => [
  { key: 'owner', config: {} },
  { key: 'standards', config: { options } },
];

describe('system boards and columns', () => {
  it('reads the standards a shared register serves from its Standards options, All standards left out', () => {
    const fields = standards([
      { id: 'all', label: 'All standards' },
      { id: 'iso14001', label: 'ISO 14001' },
      { id: 'iso9001', label: 'ISO 9001' },
    ]);
    expect(standardsOf(fields)).toEqual(['ISO 14001', 'ISO 9001']);
    expect(usedByText(fields)).toBe('Used by ISO 14001 and ISO 9001');
  });

  it('says what a register without standards is for, and what people may do with a system column', () => {
    expect(usedByText(standards([{ id: 'all', label: 'All standards' }]))).toBe(
      'Used by every standard you add',
    );
    expect(usedByText([])).toBe('Used by every standard you add');
    expect(systemColumnText(standards([{ id: 'iso14001', label: 'ISO 14001' }]))).toBe(
      'System column. Used by ISO 14001. You can hide or rename it, not delete it or change its type.',
    );
  });
});
