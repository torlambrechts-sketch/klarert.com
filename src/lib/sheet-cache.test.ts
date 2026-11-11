import { describe, expect, it } from 'vitest';
import { emptySheetData } from '@/engine/sheet-data';
import { makeField, makeItem, sheet } from '@/engine/testing/fixtures';
import {
  moveItem,
  patchItem,
  removeField,
  removeItems,
  setLinks,
  setProtected,
  shouldApplyRemote,
  upsertField,
  upsertGroup,
  upsertItem,
  upsertLink,
} from './sheet-cache';

const f1 = makeField('text', {}, { id: 'f1', position: 'a0' });
const lf = makeField('link', {}, { id: 'lf', position: 'a1' });
const a = makeItem({ f1: 'x' }, { id: 'a', position: 'a0' });
const b = makeItem({}, { id: 'b', position: 'a1' });
const base = { ...emptySheetData(sheet), fields: [f1, lf], items: [a, b] };

describe('sheet cache reducers', () => {
  it('patches values and names, clearing with null', () => {
    const d = patchItem(base, 'a', { values: { f1: null, f2: 3 }, name: 'New' });
    expect(d.items[0]).toMatchObject({ name: 'New', values: { f2: 3 } });
    expect(patchItem(base, 'zzz', { name: 'x' })).toBe(base);
  });

  it('upserts in position order and drops archived items', () => {
    const c = makeItem({}, { id: 'c', position: 'Zz' });
    expect(upsertItem(base, c).items.map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(
      upsertItem(base, { ...a, archivedAt: '2026-11-11T00:00:00Z' }).items.map((i) => i.id),
    ).toEqual(['b']);
    expect(upsertItem(base, { ...a, sheetId: 'other' }).items).toHaveLength(1);
  });

  it('moves and removes items with their links', () => {
    expect(moveItem(base, 'a', 'g-closed', 'a2').items.map((i) => [i.id, i.groupId])).toEqual([
      ['b', 'g-open'],
      ['a', 'g-closed'],
    ]);
    const linked = setLinks(base, 'lf', 'a', ['t1', 't2']);
    expect(removeItems(linked, ['a']).links).toEqual([]);
  });

  it('replaces links, keeping known rows', () => {
    const one = setLinks(base, 'lf', 'a', ['t1']);
    const real = upsertLink(one, {
      id: 'L1',
      fieldId: 'lf',
      fromItem: 'a',
      toItem: 't1',
      position: 'a0',
    });
    expect(real.links.map((l) => l.id)).toEqual(['L1']);
    const two = setLinks(real, 'lf', 'a', ['t1', 't2']);
    expect(two.links.map((l) => l.toItem)).toEqual(['t1', 't2']);
    expect(two.links[0]!.id).toBe('L1');
    expect(
      upsertLink(base, { id: 'X', fieldId: 'unknown', fromItem: 'a', toItem: 't', position: 'a0' }),
    ).toBe(base);
  });

  it('upserts and removes fields and groups', () => {
    const f0 = makeField('number', {}, { id: 'f0', position: 'Zz' });
    expect(upsertField(base, f0).fields.map((f) => f.id)).toEqual(['f0', 'f1', 'lf']);
    expect(upsertField(base, { ...f1, archivedAt: 'now' }).fields.map((f) => f.id)).toEqual(['lf']);
    expect(removeField(base, 'lf').fields.map((f) => f.id)).toEqual(['f1']);
    const g = upsertGroup(base, {
      id: 'g',
      sheetId: sheet.id,
      name: 'G',
      color: 'blue',
      position: 'a0',
    });
    expect(g.groups).toHaveLength(1);
  });

  it('sets and clears protected values', () => {
    const d = setProtected(base, { itemId: 'a', fieldId: 'p', value: 'PIN' });
    expect(d.protectedValues).toEqual([{ itemId: 'a', fieldId: 'p', value: 'PIN' }]);
    expect(setProtected(d, { itemId: 'a', fieldId: 'p', value: null }).protectedValues).toEqual([]);
  });

  it('ignores own echoes and stale rows', () => {
    const newer = { ...a, updatedAt: '2026-11-11T10:00:00Z' };
    expect(shouldApplyRemote(a, newer, new Set())).toBe(true);
    expect(shouldApplyRemote(a, newer, new Set(['a']))).toBe(false);
    expect(shouldApplyRemote(newer, a, new Set())).toBe(false);
    expect(shouldApplyRemote(newer, newer, new Set())).toBe(false);
    expect(shouldApplyRemote(undefined, a, new Set())).toBe(true);
  });
});
