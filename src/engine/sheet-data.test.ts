import { describe, expect, it } from 'vitest';
import './fields/registry';
import { emptySheetData, sheetCtx, todayIn } from './sheet-data';
import { groups, makeField, makeFile, makeItem, people, sheet } from './testing/fixtures';

describe('sheetCtx', () => {
  const owner = makeField('people', { multiple: true }, { position: 'a1' });
  const status = makeField(
    'status',
    { options: [{ id: 'o', label: 'O', color: 'grey' }] },
    { position: 'a0' },
  );
  const secret = makeField('protected', { allowedUserIds: ['u-james'] });
  const ev = makeField('evidence', { validDays: 365, multiple: true, accept: [] });
  const a = makeItem({}, { id: 'a' });
  const target = makeItem({}, { id: 't', sheetId: 's-lib' });
  const data = {
    ...emptySheetData(sheet),
    fields: [owner, status, secret, ev],
    groups,
    items: [a],
    people,
    links: [
      { id: 'l2', fieldId: 'f-link', fromItem: 'a', toItem: 't2', position: 'a1' },
      { id: 'l1', fieldId: 'f-link', fromItem: 'a', toItem: 't', position: 'a0' },
    ],
    files: [
      makeFile({ itemId: 'a', fieldId: ev.id }),
      makeFile({ itemId: 'a', fieldId: ev.id, replacedBy: 'x' }),
    ],
    protectedValues: [],
    related: {
      sheets: [{ ...sheet, id: 's-lib', name: 'Library', isLibrary: true }],
      fields: [makeField('text', {}, { sheetId: 's-lib', key: 'clause' })],
      items: [target],
    },
  };
  const env = {
    now: new Date('2026-11-11T23:30:00Z'),
    timeZone: 'Europe/Oslo',
    userId: 'u-maria',
    newId: (p: string) => `${p}1`,
  };

  it('maps rows to lookups', () => {
    const ctx = sheetCtx(data, env);
    expect(ctx.today).toBe('2026-11-12');
    expect([...ctx.fieldsByKey.values()].map((f) => f.id)).toEqual([
      status.id,
      secret.id,
      ev.id,
      owner.id,
    ]);
    expect(ctx.links('a', 'f-link')).toEqual(['t', 't2']);
    expect(ctx.files('a', ev.id)).toHaveLength(1);
    expect(ctx.item('t')?.sheetId).toBe('s-lib');
    expect(ctx.sheetOf('t')?.name).toBe('Library');
    expect(ctx.fieldsOf('s-lib').map((f) => f.key)).toEqual(['clause']);
    expect(ctx.people.get('u-james')?.name).toBe('James Okafor');
    expect(ctx.groups.get('g-open')?.name).toBe('Open');
  });

  it('hides protected values from people the field does not list', () => {
    expect(sheetCtx(data, env).protectedValue('a', secret.id)).toBeUndefined();
    expect(sheetCtx(data, { ...env, isAdmin: true }).protectedValue('a', secret.id)).toBeNull();
    expect(sheetCtx(data, { ...env, userId: 'u-james' }).protectedValue('a', secret.id)).toBeNull();
    const withValue = {
      ...data,
      protectedValues: [{ itemId: 'a', fieldId: secret.id, value: 'PIN 1234' }],
    };
    expect(sheetCtx(withValue, { ...env, userId: 'u-james' }).protectedValue('a', secret.id)).toBe(
      'PIN 1234',
    );
  });

  it('todayIn uses the time zone', () => {
    expect(todayIn(new Date('2026-11-11T23:30:00Z'), 'Europe/London')).toBe('2026-11-11');
  });
});
