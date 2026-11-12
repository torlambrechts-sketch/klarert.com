import { describe, expect, it } from 'vitest';
import { searchOptions } from './option-search';

const options = [
  { id: 'opt_sw', label: 'Software', color: 'blue' },
  { id: 'opt_hw', label: 'Hardware', color: 'teal' },
  { id: 'opt_proc', label: 'Process', color: 'purple' },
];

describe('searchOptions', () => {
  it('shows every option for an empty search and offers nothing to add', () => {
    expect(searchOptions(options, '', true)).toEqual({ shown: options, add: null });
    expect(searchOptions(options, '   ', true).add).toBeNull();
  });

  it('filters by a case-insensitive substring of the label, in list order', () => {
    expect(searchOptions(options, 'WAR', false).shown.map((o) => o.id)).toEqual([
      'opt_sw',
      'opt_hw',
    ]);
    expect(searchOptions(options, ' proc ', false).shown.map((o) => o.id)).toEqual(['opt_proc']);
  });

  it('offers the trimmed text when no label matches it exactly', () => {
    expect(searchOptions(options, '  Supplier ', true)).toEqual({ shown: [], add: 'Supplier' });
    // a partial match still offers the new option
    expect(searchOptions(options, 'Soft', true).add).toBe('Soft');
  });

  it('does not offer an option that exists, ignoring case', () => {
    expect(searchOptions(options, 'hardware', true).add).toBeNull();
    expect(searchOptions(options, 'HARDWARE ', true).add).toBeNull();
  });

  it('offers nothing when the person may not add or the text is too long', () => {
    expect(searchOptions(options, 'Supplier', false).add).toBeNull();
    expect(searchOptions(options, 'x'.repeat(81), true).add).toBeNull();
    expect(searchOptions(options, 'x'.repeat(80), true).add).toBe('x'.repeat(80));
  });
});
