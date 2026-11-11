import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { makeCtx, makeField, makeFile, makeItem } from '../testing/fixtures';
import type { Condition, Field, Item, Json } from '../types';
import { conditionProblem, matches, matchesAll, OPERATORS } from '.';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const f = {
  title: makeField('text', {}, { key: 'title', position: 'a0' }),
  status: makeField('status', FIELD_TYPES.status.defaultConfig(), { key: 'status', position: 'a1' }),
  cost: makeField('number', { unit: '', decimals: 2 }, { key: 'cost', position: 'a2' }),
  due: makeField('date', { relative: true }, { key: 'due', position: 'a3' }),
  severity: makeField('severity', FIELD_TYPES.severity.defaultConfig(), { key: 'severity', position: 'a4' }),
  tags: makeField(
    'multiselect',
    { options: [{ id: 'opt_a', label: 'Safety', color: 'red' }, { id: 'opt_b', label: 'Quality', color: 'blue' }, { id: 'opt_c', label: 'IT', color: 'teal' }] },
    { key: 'tags', position: 'a5' },
  ),
  owner: makeField('people', { multiple: true }, { key: 'owner', position: 'a6' }),
  approved: makeField('check', {}, { key: 'approved', position: 'a7' }),
  related: makeField('link', { targetSheetId: 's-ca', multiple: true, inverseFieldId: null }, { key: 'related', position: 'a8' }),
  evidence: makeField('evidence', { validDays: 365, multiple: true, accept: [] }, { key: 'evidence', position: 'a9' }),
  signoff: makeField('signature', { meaning: 'Approved', clearOnChange: true }, { key: 'signoff', position: 'b0' }),
};
const fields: Field[] = Object.values(f);

function world(values: Record<string, Json>, over: Partial<Item> = {}, extra: Parameters<typeof makeCtx>[0] = {}) {
  const item = makeItem(Object.fromEntries(Object.entries(values).map(([k, v]) => [f[k as keyof typeof f].id, v])), {
    id: 'i-x',
    name: 'Fix guard on press 3',
    displayId: 'CA-014',
    ...over,
  });
  const ctx = makeCtx({ fields, items: [item, makeItem({}, { id: 'i-y' })], ...extra });
  return { item, ctx };
}

const is = (cond: Condition, values: Record<string, Json>, expected: boolean, extra?: Parameters<typeof makeCtx>[0]) => {
  const { item, ctx } = world(values, {}, extra);
  expect(matches(cond, item, ctx)).toBe(expected);
};

describe('operators table', () => {
  it('lists the operators of docs/03 §4 for every kind', () => {
    expect(OPERATORS.date).toContain('overdue');
    expect(OPERATORS.ordered).toEqual(expect.arrayContaining(['at_least', 'at_most', 'is_any_of']));
    expect(OPERATORS.people).toContain('includes_me');
    expect(OPERATORS.file).toContain('expires_within');
  });
});

describe('text', () => {
  it.each<[string, Json, boolean]>([
    ['is', 'press guard', false],
    ['contains', 'GUARD', true],
    ['not_contains', 'valve', true],
    ['starts_with', 'Check', false],
    ['is_not', 'x', true],
  ])('%s %j', (op, value, expected) => is({ fieldKey: 'title', op, value }, { title: 'Press guard check' }, expected));

  it('empties', () => {
    is({ fieldKey: 'title', op: 'is_empty' }, {}, true);
    is({ fieldKey: 'title', op: 'is_not_empty' }, { title: 'x' }, true);
  });

  it('special keys __name, __id and __group', () => {
    const { item, ctx } = world({});
    expect(matches({ fieldKey: '__name', op: 'contains', value: 'press 3' }, item, ctx)).toBe(true);
    expect(matches({ fieldKey: '__id', op: 'is', value: 'CA-014' }, item, ctx)).toBe(true);
    expect(matches({ fieldKey: '__group', op: 'is_any_of', value: ['g-open'] }, item, ctx)).toBe(true);
    expect(matches({ fieldKey: '__group', op: 'is_none_of', value: ['g-open'] }, item, ctx)).toBe(false);
  });
});

describe('number', () => {
  it.each<[string, Json, boolean]>([
    ['eq', 100, true],
    ['neq', 100, false],
    ['gt', 99, true],
    ['gte', 100, true],
    ['lt', 100, false],
    ['lte', '100', true],
    ['between', [50, 150], true],
    ['between', [150, 50], true],
    ['between', [101, 150], false],
  ])('%s %j', (op, value, expected) => is({ fieldKey: 'cost', op, value }, { cost: 100 }, expected));

  it('an empty number matches only emptiness', () => {
    is({ fieldKey: 'cost', op: 'gt', value: 0 }, {}, false);
    is({ fieldKey: 'cost', op: 'is_empty' }, {}, true);
  });
});

describe('date (today = 2026-11-11)', () => {
  it.each<[string, Json, string, boolean]>([
    ['is', '2026-11-11', '2026-11-11', true],
    ['is', 'today', '2026-11-11', true],
    ['before', '2026-11-12', '2026-11-11', true],
    ['after', '2026-11-12', '2026-11-11', false],
    ['on_or_before', '2026-11-11', '2026-11-11', true],
    ['on_or_after', '2026-11-12', '2026-11-11', false],
    ['between', ['2026-11-01', '2026-11-30'], '2026-11-11', true],
    ['is_today', null, '2026-11-11', true],
    ['next_days', 7, '2026-11-18', true],
    ['next_days', 7, '2026-11-19', false],
    ['next_days', 7, '2026-11-10', false],
    ['last_days', 7, '2026-11-04', true],
    ['last_days', 7, '2026-11-03', false],
  ])('%s %j on %s', (op, value, due, expected) => is({ fieldKey: 'due', op, value }, { due }, expected));

  it('overdue: before today and the item is not done', () => {
    is({ fieldKey: 'due', op: 'overdue' }, { due: '2026-11-10', status: 'opt_wip' }, true);
    is({ fieldKey: 'due', op: 'overdue' }, { due: '2026-11-10', status: 'opt_done' }, false);
    is({ fieldKey: 'due', op: 'overdue' }, { due: '2026-11-11', status: 'opt_wip' }, false);
    is({ fieldKey: 'due', op: 'overdue' }, { status: 'opt_wip' }, false);
  });
});

describe('option and ordered', () => {
  it('is_any_of / is_none_of / is_done', () => {
    is({ fieldKey: 'status', op: 'is_any_of', value: ['opt_wip', 'opt_stuck'] }, { status: 'opt_wip' }, true);
    is({ fieldKey: 'status', op: 'is_none_of', value: ['opt_wip'] }, { status: 'opt_wip' }, false);
    is({ fieldKey: 'status', op: 'is_done' }, { status: 'opt_done' }, true);
    is({ fieldKey: 'status', op: 'is_not_done' }, {}, true);
  });

  it('at_least / at_most use the option order', () => {
    const [low, medium, high, critical] = FIELD_TYPES.severity.defaultConfig().options.map((o) => o.id);
    is({ fieldKey: 'severity', op: 'at_least', value: high! }, { severity: critical! }, true);
    is({ fieldKey: 'severity', op: 'at_least', value: high! }, { severity: medium! }, false);
    is({ fieldKey: 'severity', op: 'at_most', value: medium! }, { severity: low! }, true);
    is({ fieldKey: 'severity', op: 'at_least', value: high! }, {}, false);
  });
});

describe('multi', () => {
  it.each<[string, Json, boolean]>([
    ['has_any_of', ['opt_a', 'opt_c'], true],
    ['has_all_of', ['opt_a', 'opt_b'], true],
    ['has_all_of', ['opt_a', 'opt_c'], false],
    ['has_none_of', ['opt_c'], true],
    ['has_none_of', ['opt_a'], false],
  ])('%s %j', (op, value, expected) => is({ fieldKey: 'tags', op, value }, { tags: ['opt_a', 'opt_b'] }, expected));
});

describe('people', () => {
  it('includes_me uses the current user', () => {
    is({ fieldKey: 'owner', op: 'includes_me' }, { owner: ['u-maria'] }, true);
    is({ fieldKey: 'owner', op: 'includes_me' }, { owner: ['u-james'] }, false);
  });
  it('includes_any_of and excludes accept "me"', () => {
    is({ fieldKey: 'owner', op: 'includes_any_of', value: ['u-vic', 'me'] }, { owner: ['u-maria'] }, true);
    is({ fieldKey: 'owner', op: 'excludes', value: ['u-james'] }, { owner: ['u-maria'] }, true);
    is({ fieldKey: 'owner', op: 'is_empty' }, { owner: [] }, true);
  });
});

describe('boolean', () => {
  it('is_checked / is_not_checked', () => {
    is({ fieldKey: 'approved', op: 'is_checked' }, { approved: true }, true);
    is({ fieldKey: 'approved', op: 'is_not_checked' }, {}, true);
  });
});

describe('link', () => {
  const links = { 'i-x:f-related': ['i-y', 'i-z'] };
  it.each<[string, Json, boolean]>([
    ['has_any', null, true],
    ['has_none', null, false],
    ['includes_item', 'i-y', true],
    ['count_gt', 1, true],
    ['count_lt', 2, false],
  ])('%s %j', (op, value, expected) => is({ fieldKey: 'related', op, value }, {}, expected, { links }));
});

describe('file', () => {
  const files = (validUntil: string | null) => [makeFile({ itemId: 'i-x', fieldId: 'f-evidence', validUntil })];
  it('has_files / has_none', () => {
    is({ fieldKey: 'evidence', op: 'has_files' }, {}, true, { files: files('2027-06-01') });
    is({ fieldKey: 'evidence', op: 'has_none' }, {}, true);
  });
  it('freshness_is', () => {
    is({ fieldKey: 'evidence', op: 'freshness_is', value: 'current' }, {}, true, { files: files('2027-06-01') });
    is({ fieldKey: 'evidence', op: 'freshness_is', value: 'expiring' }, {}, true, { files: files('2026-12-01') });
    is({ fieldKey: 'evidence', op: 'freshness_is', value: 'expired' }, {}, true, { files: files('2026-11-01') });
  });
  it('expires_within N days', () => {
    is({ fieldKey: 'evidence', op: 'expires_within', value: 30 }, {}, true, { files: files('2026-12-01') });
    is({ fieldKey: 'evidence', op: 'expires_within', value: 10 }, {}, false, { files: files('2026-12-01') });
    is({ fieldKey: 'evidence', op: 'expires_within', value: 30 }, {}, false, { files: files('2026-11-01') });
  });
});

describe('signature', () => {
  const signed = { by: 'u-james', at: '2026-11-10T10:00:00Z', meaning: 'Approved', hash: 'a'.repeat(64) };
  it('is_signed / signed_by', () => {
    is({ fieldKey: 'signoff', op: 'is_signed' }, { signoff: signed }, true);
    is({ fieldKey: 'signoff', op: 'is_not_signed' }, {}, true);
    is({ fieldKey: 'signoff', op: 'signed_by', value: ['u-james'] }, { signoff: signed }, true);
    is({ fieldKey: 'signoff', op: 'signed_by', value: ['me'] }, { signoff: signed }, false);
  });
});

describe('validity', () => {
  it('reports deleted fields and unsupported operators, which never match', () => {
    const { item, ctx } = world({ cost: 5 });
    expect(conditionProblem({ fieldKey: 'gone', op: 'is' }, ctx)).toMatch(/no longer exists/);
    expect(conditionProblem({ fieldKey: 'cost', op: 'contains' }, ctx)).toMatch(/cannot be used/);
    expect(conditionProblem({ fieldKey: 'cost', op: 'gt', value: 1 }, ctx)).toBeNull();
    expect(matches({ fieldKey: 'cost', op: 'contains', value: '5' }, item, ctx)).toBe(false);
    expect(matches({ fieldKey: 'gone', op: 'is_empty' }, item, ctx)).toBe(false);
  });

  it('matchesAll is an AND; an empty list matches', () => {
    const { item, ctx } = world({ cost: 100, status: 'opt_wip' });
    expect(matchesAll([], item, ctx)).toBe(true);
    expect(
      matchesAll(
        [
          { fieldKey: 'cost', op: 'gt', value: 50 },
          { fieldKey: 'status', op: 'is_not_done' },
        ],
        item,
        ctx,
      ),
    ).toBe(true);
    expect(
      matchesAll(
        [
          { fieldKey: 'cost', op: 'gt', value: 50 },
          { fieldKey: 'status', op: 'is_done' },
        ],
        item,
        ctx,
      ),
    ).toBe(false);
  });
});
