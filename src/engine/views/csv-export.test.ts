import { describe, expect, it } from 'vitest';
import '../fields/registry';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { csvFileName, itemsCsv } from './csv-export';

describe('Table CSV export', () => {
  const status = makeField(
    'status',
    { options: [{ id: 'o1', label: 'Working on it', color: 'orange' }] },
    { name: 'Status' },
  );
  const owner = makeField('people', { multiple: true }, { name: 'Owner' });
  const item = makeItem({ [status.id]: 'o1', [owner.id]: ['u-maria'] }, { name: 'Fire door' });
  const ctx = makeCtx({ fields: [status, owner], items: [item] });

  it('writes labels and names, not ids', () => {
    const csv = itemsCsv([status, owner], [item], ctx, 'Action');
    const [head, row] = csv.replace('﻿', '').trim().split('\r\n');
    expect(head).toBe('ID,Action,Status,Owner');
    expect(row).toBe(`${item.displayId},Fire door,Working on it,Maria Pereira`);
  });

  it('names the file after the sheet and the day', () => {
    expect(csvFileName('Risk register', '2026-11-18')).toBe('risk-register-2026-11-18.csv');
  });
});
