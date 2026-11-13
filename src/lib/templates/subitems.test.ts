import { describe, expect, it } from 'vitest';
import '@/engine/fields/registry';
import { subitemSetSchema } from './schema';
import { DEFAULT_SUBITEM_FIELDS, planSubitems } from './subitems';

const env = (newId = (() => {
  let n = 0;
  return () => `id-${++n}`;
})()) => ({
  orgId: 'o-1',
  parent: { id: 'p', name: 'CAPA', folderId: 'f', position: 'a0', holdAutomations: true },
  parentFields: [
    { key: 'owner', position: 'a0' },
    { key: 'actions', position: 'a5' },
  ],
  newId,
});

describe('sub-item sets in templates (Zod)', () => {
  const set = {
    label: 'Actions',
    blockClose: true,
    fields: [
      { key: 'owner', name: 'Owner', type: 'people' },
      { key: 'status', name: 'Status', type: 'status' },
      { key: 'due_date', name: 'Due date', type: 'date' },
    ],
    items: [{ name: 'Effectiveness check', values: { due_date: '$in:90' } }],
  };

  it('accepts a set and fills the defaults', () => {
    const r = subitemSetSchema.parse({ fields: set.fields });
    expect(r).toMatchObject({ label: 'Sub-items', blockClose: false, lockCascade: false, items: [] });
    expect(subitemSetSchema.parse(set).items[0]!.values).toEqual({ due_date: '$in:90' });
  });

  it('refuses unknown types, unknown keys in items and rules, and duplicate keys', () => {
    expect(subitemSetSchema.safeParse({ ...set, fields: [{ key: 'x', name: 'X', type: 'nope' }] }).success).toBe(
      false,
    );
    expect(
      subitemSetSchema.safeParse({ ...set, items: [{ name: 'A', values: { missing: 1 } }] }).success,
    ).toBe(false);
    expect(
      subitemSetSchema.safeParse({
        ...set,
        fields: [
          ...set.fields,
          {
            key: 'notes',
            name: 'Notes',
            type: 'text',
            rules: [{ id: 'r', whenFieldKey: 'ghost', whenValues: ['x'], requireComment: true }],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      subitemSetSchema.safeParse({ ...set, fields: [...set.fields, { key: 'owner', name: 'Owner 2', type: 'people' }] })
        .success,
    ).toBe(false);
    expect(subitemSetSchema.safeParse({ ...set, fields: [] }).success).toBe(false);
  });
});

describe('planSubitems', () => {
  it('plans a child sheet without a prefix, one group, the fields, the column and the settings', () => {
    const rows = planSubitems(
      { label: 'Actions', blockClose: true, fields: [{ key: 'owner', name: 'Owner', type: 'people' }], items: [{ name: 'A', values: {} }] },
      env(),
    );
    expect(rows.sheet).toMatchObject({
      name: 'CAPA · Actions',
      item_label: 'Action',
      id_prefix: null,
      parent_sheet_id: 'p',
      settings: { holdAutomations: true },
    });
    expect(rows.group.name).toBe('Actions');
    expect(rows.fields.map((f) => f.key)).toEqual(['owner']);
    // the column comes after the parent's fields, with a key that does not clash
    expect(rows.parentField).toMatchObject({ type: 'subitems', name: 'Actions', key: 'actions_2' });
    expect(rows.parentField.position > 'a5').toBe(true);
    expect(rows.settings).toEqual({
      label: 'Actions',
      blockClose: true,
      lockCascade: false,
      template: [{ name: 'A', values: {} }],
    });
  });

  it('defaults to Owner, Status and Due date called Sub-items', () => {
    const rows = planSubitems({}, env());
    expect(rows.label).toBe('Sub-items');
    expect(rows.fields.map((f) => f.type)).toEqual(DEFAULT_SUBITEM_FIELDS.map((f) => f.type));
    expect(rows.sheet.item_label).toBe('Sub-item');
  });
});
