import { describe, expect, it } from 'vitest';
import { emptySheetData } from '@/engine/sheet-data';
import { makeField, makeFile, makeItem, sheet } from '@/engine/testing/fixtures';
import { addFile, addRelated, missingItems } from './sheet-cache';

const own = makeItem({}, { id: 'a' });
const base = { ...emptySheetData(sheet), items: [own] };
const other = { ...sheet, id: 's-risks', name: 'Risks', idPrefix: 'R-' };
const riskField = makeField('text', {}, { id: 'rf', sheetId: 's-risks' });
const risk = makeItem({ rf: 'High' }, { id: 'r1', sheetId: 's-risks' });

describe('related items loaded on demand', () => {
  it('merges items, sheets and fields of other sheets', () => {
    const d = addRelated(base, { items: [risk, own], sheets: [other, sheet], fields: [riskField] });
    expect(d.related.items.map((i) => i.id)).toEqual(['r1']);
    expect(d.related.sheets.map((s) => s.id)).toEqual(['s-risks']);
    expect(d.related.fields.map((f) => f.id)).toEqual(['rf']);
    const newer = { ...risk, name: 'Renamed' };
    expect(addRelated(d, { items: [newer], sheets: [], fields: [] }).related.items).toEqual([
      newer,
    ]);
    expect(addRelated(d, { items: [], sheets: [], fields: [] })).toBe(d);
  });

  it('lists ids the cache cannot show', () => {
    const d = addRelated(base, { items: [risk], sheets: [other], fields: [] });
    expect(missingItems(d, ['a', 'r1', 'r2', 'r2'])).toEqual(['r2']);
  });
});

describe('addFile', () => {
  it('adds a version and drops the one it replaces', () => {
    const v1 = makeFile({ id: 'v1', itemId: 'a', fieldId: 'ev' });
    const v2 = makeFile({ id: 'v2', itemId: 'a', fieldId: 'ev' });
    const d = addFile({ ...base, files: [v1] }, v2, 'v1');
    expect(d.files).toEqual([v2]);
    expect(addFile(d, makeFile({ id: 'x', itemId: 'zzz', fieldId: 'ev' }))).toBe(d);
  });
});
