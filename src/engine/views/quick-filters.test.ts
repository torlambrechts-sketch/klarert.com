import { describe, expect, it } from 'vitest';
import '../fields/registry';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import {
  filterByKeys,
  ownersOf,
  quickFilter,
  statusChoices,
  statusFilterField,
} from './quick-filters';

const status = makeField('status', {
  options: [
    { id: 'todo', label: 'Not started', color: 'grey' },
    { id: 'doing', label: 'Working on it', color: 'orange' },
    { id: 'done', label: 'Done', color: 'green', done: true },
  ],
});
const owner = makeField('people', { multiple: true });
const items = [
  makeItem({ [status.id]: 'todo', [owner.id]: ['u-maria'] }),
  makeItem({ [status.id]: 'done', [owner.id]: ['u-maria', 'u-james'] }),
  makeItem({ [status.id]: 'todo' }),
];
const ctx = makeCtx({ fields: [status, owner], items });

describe('quick filters', () => {
  it('uses the item status field and counts its options', () => {
    expect(statusFilterField(ctx)?.id).toBe(status.id);
    expect(statusChoices(items, ctx).map((c) => [c.option.id, c.count])).toEqual([
      ['todo', 2],
      ['doing', 0],
      ['done', 1],
    ]);
  });

  it('lists owners by how many items they own', () => {
    expect(ownersOf(items, ctx)).toEqual(['u-maria', 'u-james']);
  });

  it('filters by status and owner together; nothing chosen keeps every item', () => {
    expect(quickFilter(items, new Set(), new Set(), ctx)).toHaveLength(3);
    expect(quickFilter(items, new Set(), new Set(['todo']), ctx)).toHaveLength(2);
    expect(quickFilter(items, new Set(['u-maria']), new Set(['todo']), ctx)).toEqual([items[0]]);
    expect(filterByKeys(items, null, new Set(['x']), ctx)).toHaveLength(3);
  });
});
