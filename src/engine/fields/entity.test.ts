import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { entity } from './entity';

const ctx = () => {
  const c = makeCtx();
  c.entities.set('e-2', { id: 'e-2', name: 'Meridian Nordic AS', country: 'NO' });
  c.sites.set('site-oslo', { id: 'site-oslo', entityId: 'e-2', name: 'Oslo' });
  return c;
};

describe('entity', () => {
  contract(entity, {
    ctx: ctx(),
    valid: [
      [
        { entityId: 'e-1', siteId: 'site-leeds' },
        { entityId: 'e-1', siteId: 'site-leeds' },
      ],
      [
        { entityId: 'e-1', siteId: null },
        { entityId: 'e-1', siteId: null },
      ],
      ['Meridian Components Ltd · Leeds', { entityId: 'e-1', siteId: 'site-leeds' }],
      ['meridian nordic as', { entityId: 'e-2', siteId: null }],
    ],
    invalid: [
      { entityId: 'e-1', siteId: 'site-oslo' },
      'Meridian Components Ltd · Oslo',
      { entityId: 'e-9', siteId: null },
      'Acme',
      '',
      null,
      ['e-1'],
    ],
    parse: [
      ['Meridian Components Ltd · Bradford', { entityId: 'e-1', siteId: 'site-bradford' }],
      ['Meridian Nordic AS - Oslo', { entityId: 'e-2', siteId: 'site-oslo' }],
      ['Meridian Components Ltd', { entityId: 'e-1', siteId: null }],
      ['', null],
    ],
    text: [
      [{ entityId: 'e-1', siteId: 'site-leeds' }, 'Meridian Components Ltd · Leeds'],
      [{ entityId: 'e-2', siteId: null }, 'Meridian Nordic AS'],
      [{ entityId: 'e-gone', siteId: null }, ''],
    ],
    number: [[{ entityId: 'e-1', siteId: null }, null]],
    date: [[{ entityId: 'e-1', siteId: null }, null]],
    order: [
      { entityId: 'e-1', siteId: 'site-bradford' },
      { entityId: 'e-1', siteId: 'site-leeds' },
    ],
    empty: [
      [{ entityId: '', siteId: null }, true],
      [{ entityId: 'e-1', siteId: null }, false],
    ],
  });

  it('flags a stored site that does not belong to the entity', () => {
    const c = ctx();
    const field = makeField('entity', {});
    expect(
      entity
        .validate({ entityId: 'e-2', siteId: 'site-leeds' }, field, makeItem(), c)
        .map((i) => i.code),
    ).toEqual(['site_mismatch']);
    expect(entity.validate({ entityId: 'e-2', siteId: 'site-oslo' }, field, makeItem(), c)).toEqual(
      [],
    );
  });

  it('accepts entity and site names in an object and offers entities with their sites', () => {
    const c = ctx();
    expect(entity.normalize({ entityId: 'Meridian Nordic AS', siteId: 'Oslo' }, {}, c)).toEqual({
      entityId: 'e-2',
      siteId: 'site-oslo',
    });
    expect(entity.options?.({}, c).map((o) => o.label)).toEqual([
      'Meridian Components Ltd',
      'Meridian Components Ltd · Leeds',
      'Meridian Components Ltd · Bradford',
      'Meridian Nordic AS',
      'Meridian Nordic AS · Oslo',
    ]);
  });
});
