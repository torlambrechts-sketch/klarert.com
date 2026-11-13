import { describe, expect, it } from 'vitest';
import '../fields/registry';
import { cStatus, makeSubitem, pSubitems, subitemCtx } from '../testing/subitems-world';
import { makeItem } from '../testing/fixtures';
import { subitems } from './subitems';

// The sub-items column (docs/03 §3.4): a computed, link-like column. It stores nothing; the shared contract needs
// values that normalise, so its checks are spelt out like the button's.
describe('subitems field type', () => {
  const parent = makeItem({}, { id: 'p1', displayId: 'CA-001' });
  const done = makeSubitem(parent, { [cStatus.id]: 'c_done' }, { id: 's1', position: 'a1' });
  const open = makeSubitem(parent, { [cStatus.id]: 'c_todo' }, { id: 's2', position: 'a2' });
  const na = makeSubitem(parent, { [cStatus.id]: 'c_na' }, { id: 's3', position: 'a3' });
  const gone = makeSubitem(
    parent,
    {},
    { id: 's4', position: 'a4', archivedAt: '2026-11-01T00:00:00Z' },
  );
  const ctx = subitemCtx({ items: [parent, done, open, na, gone] });
  const cfg = subitems.defaultConfig();

  it('has a valid default config and is not offered by the add-field picker', () => {
    expect(subitems.configSchema.safeParse(cfg).success).toBe(true);
    expect(subitems.addable).toBe(false);
    expect(subitems.formAllowed).toBe(false);
    expect(subitems.storage).toBe('computed');
    expect(subitems.kind).toBe('link');
  });

  it.each([['Root cause'], [['s1']], [3], [null]])('stores nothing typed or pasted: %j', (x) => {
    expect(subitems.normalize(x, cfg, ctx)).toBeNull();
    expect(subitems.parseText(String(x), cfg, ctx)).toBeNull();
  });

  it('computes the live sub-items in position order, leaving archived ones out', () => {
    expect(subitems.compute!(parent, pSubitems as never, ctx)).toEqual(['s1', 's2', 's3']);
    expect(subitems.relatedIds!(parent, pSubitems as never, ctx)).toEqual(['s1', 's2', 's3']);
    expect(subitems.compute!(makeItem({}, { id: 'lonely' }), pSubitems as never, ctx)).toBeNull();
  });

  it('reads as done/total: N/A counts as done', () => {
    expect(subitems.toText(['s1', 's2', 's3'], cfg, ctx)).toBe('2/3');
    expect(subitems.toText(null, cfg, ctx)).toBe('');
    expect(subitems.toNumber(['s1', 's2', 's3'], cfg, ctx)).toBe(3);
    expect(subitems.toDate(['s1'], cfg, ctx)).toBeNull();
  });

  it('sorts by share done, empties last', () => {
    expect(subitems.compare(['s2'], ['s1'], cfg, ctx)).toBeLessThan(0);
    expect(subitems.compare(null, ['s1'], cfg, ctx)).toBe(1);
    expect(subitems.isEmpty(null)).toBe(true);
    expect(subitems.isEmpty(['s1'])).toBe(false);
  });
});
