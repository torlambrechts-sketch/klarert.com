import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { makeCtx, makeField, makeItem, people } from '../testing/fixtures';
import { isOverdueOf } from '../values';
import { donePercent, GROUP_BY_NONE, groupableFields, virtualGroups } from './group-by';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const cfg = FIELD_TYPES.status.defaultConfig() as { options: { id: string; done?: boolean }[] };
const status = makeField('status', cfg, { key: 'status', name: 'Status', position: 'a1' });
const due = makeField('date', { relative: true }, { key: 'due', name: 'Due', position: 'a2' });
const owner = makeField(
  'people',
  { multiple: true },
  { key: 'owner', name: 'Owner', position: 'a3' },
);
const doneId = cfg.options.find((o) => o.done)!.id;
const openId = cfg.options.find((o) => !o.done)!.id;

const a = makeItem({ [status.id]: doneId, [owner.id]: [people[0]!.id], [due.id]: '2026-11-01' });
const b = makeItem({ [status.id]: openId, [owner.id]: [people[1]!.id], [due.id]: '2026-11-01' });
const c = makeItem({});
const ctx = makeCtx({ fields: [status, due, owner], items: [a, b, c] });

describe('group by', () => {
  it('lists label and people fields as groupable', () => {
    expect(groupableFields(ctx).map((f) => f.key)).toEqual(['status', 'owner']);
  });

  it('makes one virtual group per used option plus No value', () => {
    const v = virtualGroups(status, [a, b, c], ctx, 's');
    expect(v.groups).toHaveLength(3);
    expect(v.groups.at(-1)).toMatchObject({ id: GROUP_BY_NONE, name: 'No value' });
    expect(v.groupOf(a)).toBe(`v:${doneId}`);
    expect(v.groupOf(c)).toBe(GROUP_BY_NONE);
  });

  it('groups by person', () => {
    const v = virtualGroups(owner, [a, b, c], ctx, 's');
    expect(v.groups.map((g) => g.name)).toContain('No value');
    expect(v.groupOf(a)).toBe(`v:${people[0]!.id}`);
  });

  it('computes the done share, null without a done-capable field', () => {
    expect(donePercent([a, b], ctx)).toBe(50);
    expect(donePercent([], ctx)).toBeNull();
    expect(donePercent([a], makeCtx({ fields: [due], items: [a] }))).toBeNull();
  });

  it('marks an open item with a past deadline overdue, a done one not', () => {
    expect(isOverdueOf(b, due, ctx)).toBe(true);
    expect(isOverdueOf(a, due, ctx)).toBe(false);
    expect(isOverdueOf(c, due, ctx)).toBe(false);
  });
});
