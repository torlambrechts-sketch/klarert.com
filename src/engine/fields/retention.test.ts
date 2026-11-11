import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { date } from './date';
import { installFieldTypes } from './resolve';
import { retention, retentionDate, retentionText } from './retention';

const noHold = { hold: false, holdReason: '' };
const hold = { hold: true, holdReason: 'Litigation' };

describe('retention', () => {
  contract(retention, {
    valid: [
      [noHold, noHold],
      [hold, hold],
      [true, { hold: true, holdReason: '' }],
      ['Legal hold: Litigation', hold],
    ],
    invalid: [null, '', 'forever', { holdReason: 'x' }, 6],
    parse: [
      ['Legal hold', { hold: true, holdReason: '' }],
      ['Delete after 3 Jan 2032', noHold],
      ['{"hold":true,"holdReason":"Litigation"}', hold],
    ],
    text: [
      [hold, 'Legal hold — Litigation'],
      [{ hold: true, holdReason: '' }, 'Legal hold'],
    ],
    number: [[hold, null]],
    date: [[noHold, null]],
    order: [noHold, hold],
  });

  installFieldTypes([date]);
  const closed = makeField('date', { relative: false }, { key: 'closed_on', id: 'f-closed' });
  const ctx = makeCtx({ fields: [closed] });

  it('deletes after from + years, using the from field', () => {
    const field = makeField('retention', { years: 6, fromFieldKey: 'closed_on' }, { id: 'f-ret' });
    const item = makeItem({ 'f-closed': '2026-01-03', 'f-ret': noHold });
    expect(retentionDate(item, field, ctx)).toBe('2032-01-03');
    expect(retentionText(item, field, ctx)).toBe('Delete after 3 Jan 2032');
    expect(retentionDate(makeItem({}), field, ctx)).toBeNull();
    expect(retentionText(makeItem({}), field, ctx)).toBe('');
  });

  it('falls back to the created date', () => {
    const field = makeField('retention', { years: 1, fromFieldKey: null }, { id: 'f-ret' });
    expect(retentionDate(makeItem({}, { createdAt: '2024-02-29T10:00:00Z' }), field, ctx)).toBe(
      '2025-02-28',
    );
  });

  it('has no date while on legal hold', () => {
    const field = makeField('retention', { years: 6, fromFieldKey: 'closed_on' }, { id: 'f-ret' });
    const item = makeItem({ 'f-closed': '2026-01-03', 'f-ret': hold });
    expect(retentionDate(item, field, ctx)).toBeNull();
    expect(retentionText(item, field, ctx)).toBe('Legal hold');
  });
});
