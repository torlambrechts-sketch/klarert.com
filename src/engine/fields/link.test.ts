import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { link, readValue, type LinkConfig } from './link';
import { installFieldTypes } from './resolve';
import { number } from './number';
import { status } from './status';

const cfg: LinkConfig = { targetSheetId: 's-ctl', multiple: true, inverseFieldId: null };
const field = makeField<LinkConfig>('link', cfg, { key: 'controls' });
const c1 = makeItem({}, { id: 'i-c1', sheetId: 's-ctl', displayId: 'CTL-001' });
const c2 = makeItem({}, { id: 'i-c2', sheetId: 's-ctl', displayId: 'CTL-002' });
const other = makeItem({}, { id: 'i-x', sheetId: 's-ca', displayId: 'CA-099' });
const a = makeItem({}, { id: 'i-a' });
const ctx = makeCtx({
  fields: [field],
  items: [c1, c2, other, a],
  links: { 'i-a:f-controls': ['i-c1', 'i-c2'] },
});

describe('link', () => {
  contract(link, {
    config: cfg,
    ctx,
    valid: [
      ['i-c1', ['i-c1']],
      [
        ['i-c1', 'i-c2', 'i-c1'],
        ['i-c1', 'i-c2'],
      ],
      ['i-c1, i-c2', ['i-c1', 'i-c2']],
    ],
    invalid: [[], '', null, 42, [1, 2]],
    parse: [
      ['i-c1', ['i-c1']],
      ['i-c1\ni-c2', ['i-c1', 'i-c2']],
      ['["i-c2","i-c1"]', ['i-c2', 'i-c1']],
    ],
    text: [
      [['i-c1', 'i-c2'], 'CTL-001, CTL-002'],
      [['i-gone'], ''],
    ],
    number: [
      [['i-c1', 'i-c2'], 2],
      [null, null],
    ],
    date: [[['i-c1'], null]],
    order: [['i-c1'], ['i-c2']],
    empty: [
      [[], true],
      [['i-c1'], false],
    ],
  });

  it('reads its value from item_links, in order', () => {
    expect(link.compute!(a, field, ctx)).toEqual(['i-c1', 'i-c2']);
    expect(link.compute!(c1, field, ctx)).toBeNull();
  });

  it('refuses items from another sheet and a second item when single', () => {
    expect(link.validate(['i-c1', 'i-c2'], field, a, ctx)).toEqual([]);
    expect(link.validate(['i-c1', 'i-x'], field, a, ctx).map((i) => i.code)).toEqual([
      'wrong_sheet',
    ]);
    const single = { ...field, config: { ...cfg, multiple: false } };
    expect(link.validate(['i-c1', 'i-c2'], single, a, ctx).map((i) => i.code)).toEqual([
      'single_only',
    ]);
    expect(link.validate(['i-c1'], single, a, ctx)).toEqual([]);
  });

  it('reads any field wherever its type stores it', () => {
    installFieldTypes([link, number, status]);
    const n = makeField('number', number.defaultConfig(), { key: 'n' });
    const item = makeItem({ [n.id]: 4 }, { id: 'i-a' });
    expect(readValue(item, n, ctx)).toBe(4);
    expect(readValue(item, field, ctx)).toEqual(['i-c1', 'i-c2']);
  });
});
