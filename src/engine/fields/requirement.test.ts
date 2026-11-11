import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem, sheet } from '../testing/fixtures';
import { requirement } from './requirement';

const lib = { ...sheet, id: 's-lib', name: 'ISO 27001 Annex A', isLibrary: true };
const items = [
  makeItem({}, { id: 'lib-1', sheetId: 's-lib', displayId: 'A.5.1' }),
  makeItem({}, { id: 'lib-2', sheetId: 's-lib', displayId: 'A.5.2' }),
  makeItem({}, { id: 'ca-1', displayId: 'CA-001' }),
];
const ctx = makeCtx({ items, sheets: { 's-lib': lib } });

describe('requirement', () => {
  contract(requirement, {
    ctx,
    valid: [
      [
        ['lib-1', 'lib-2'],
        ['lib-1', 'lib-2'],
      ],
      ['lib-1, lib-2', ['lib-1', 'lib-2']],
      [['lib-1', ' lib-1 '], ['lib-1']],
    ],
    invalid: [[], '', null, 42],
    parse: [
      ['lib-1', ['lib-1']],
      ['lib-1\nlib-2', ['lib-1', 'lib-2']],
      ['["lib-2"]', ['lib-2']],
    ],
    text: [
      [['lib-1', 'lib-2'], 'A.5.1, A.5.2'],
      [['missing'], ''],
    ],
    number: [[['lib-1', 'lib-2'], 2]],
    order: [['lib-1'], ['lib-2']],
    empty: [
      [[], true],
      [['lib-1'], false],
    ],
  });

  it('reads its value from item_links', () => {
    const field = makeField('requirement', requirement.defaultConfig(), { id: 'f-req' });
    const item = makeItem({}, { id: 'risk-1' });
    const c = makeCtx({
      items,
      sheets: { 's-lib': lib },
      links: { 'risk-1:f-req': ['lib-2', 'lib-1'] },
    });
    expect(requirement.compute!(item, field, c)).toEqual(['lib-2', 'lib-1']);
    expect(requirement.compute!(makeItem(), field, c)).toBeNull();
  });

  it('only links to library sheets', () => {
    const field = makeField('requirement', requirement.defaultConfig());
    expect(requirement.validate(['lib-1'], field, makeItem(), ctx)).toEqual([]);
    expect(
      requirement.validate(['lib-1', 'ca-1'], field, makeItem(), ctx).map((i) => i.code),
    ).toEqual(['not_library']);
  });

  it('keeps one link when multiple is off', () => {
    const cfg = { ...requirement.defaultConfig(), multiple: false };
    expect(requirement.normalize(['lib-1', 'lib-2'], cfg, ctx)).toEqual(['lib-1']);
  });
});
