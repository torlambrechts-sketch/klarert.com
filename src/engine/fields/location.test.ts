import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { location } from './location';

const leedsPress = { siteId: 'site-leeds', note: 'Press shop line 3' };

describe('location', () => {
  contract(location, {
    valid: [
      [leedsPress, leedsPress],
      ['Leeds', { siteId: 'site-leeds' }],
      [
        { site: 'bradford', note: ' Stores ' },
        { siteId: 'site-bradford', note: 'Stores' },
      ],
      ['site-bradford', { siteId: 'site-bradford' }],
    ],
    invalid: ['Atlantis', '', null, { note: 'Room 4' }, { siteId: 'site-gone' }],
    parse: [
      ['Leeds · Press shop line 3', leedsPress],
      ['Leeds - Press shop line 3', leedsPress],
      ['Bradford, Goods in', { siteId: 'site-bradford', note: 'Goods in' }],
    ],
    text: [
      [leedsPress, 'Leeds · Press shop line 3'],
      [{ siteId: 'site-bradford' }, 'Bradford'],
    ],
    order: [{ siteId: 'site-bradford' }, leedsPress],
    empty: [
      [{ siteId: '' }, true],
      [leedsPress, false],
    ],
  });

  it('shows site names, never ids, and offers workspace sites as options', () => {
    const ctx = makeCtx();
    expect(location.toText({ siteId: 'site-deleted', note: 'Lab' }, {}, ctx)).toBe('Lab');
    expect(location.options!({}, ctx).map((o) => o.label)).toEqual(['Leeds', 'Bradford']);
  });
});
