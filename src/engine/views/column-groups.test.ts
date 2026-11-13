import { describe, expect, it } from 'vitest';
import '../fields/registry';
import { makeCtx, makeField } from '../testing/fixtures';
import {
  arrangeFields,
  describeGroupsChange,
  hiddenWithCollapsed,
  keyColumns,
  liveCollapsed,
  parseColumnGroups,
  planGroupPositions,
  stubField,
  type ColumnGroup,
} from './column-groups';
import { emptyConfig, parseViewConfig, sameConfig, sameLayout } from './config';

const f = (key: string, position: string) => ({ id: `f-${key}`, key, position });

describe('parseColumnGroups', () => {
  it('reads valid groups and falls back per group: broken ones dropped, unknown keys dropped', () => {
    const raw = [
      { id: 'g1', name: 'Identify', fieldKeys: ['owner', 'gone', 'status'] },
      { id: 'bad id!', name: 'Broken', fieldKeys: [] },
      { id: 'g2', name: '', fieldKeys: ['x'] },
      { id: 'g3', name: 'Assess', fieldKeys: ['status', 'score'] },
      { id: 'g1', name: 'Again', fieldKeys: [] },
      'nonsense',
    ];
    expect(parseColumnGroups(raw, ['owner', 'status', 'score'])).toEqual([
      { id: 'g1', name: 'Identify', fieldKeys: ['owner', 'status'] },
      // status is already in Identify
      { id: 'g3', name: 'Assess', fieldKeys: ['score'] },
    ]);
    expect(parseColumnGroups(null)).toEqual([]);
    expect(parseColumnGroups({ not: 'a list' })).toEqual([]);
  });
});

describe('contiguity', () => {
  const fields = [f('a', 'a0'), f('b', 'a1'), f('c', 'a2'), f('d', 'a3'), f('e', 'a4')];

  it('arranges a group at its first field with its members together', () => {
    const groups: ColumnGroup[] = [{ id: 'g', name: 'G', fieldKeys: ['b', 'e'] }];
    expect(arrangeFields(fields, groups).map((x) => x.key)).toEqual(['a', 'b', 'e', 'c', 'd']);
  });

  it('assigning a field moves it to the end of its group, and only it moves', () => {
    const before: ColumnGroup[] = [{ id: 'g', name: 'G', fieldKeys: ['c', 'd'] }];
    const after: ColumnGroup[] = [{ id: 'g', name: 'G', fieldKeys: ['c', 'd', 'a'] }];
    const moves = planGroupPositions(fields, after, before);
    expect(moves.map((m) => m.fieldId)).toEqual(['f-a']);
    const moved = fields.map((x) => (x.id === 'f-a' ? { ...x, position: moves[0]!.position } : x));
    const order = [...moved].sort((x, y) => (x.position < y.position ? -1 : 1)).map((x) => x.key);
    expect(order).toEqual(['b', 'c', 'd', 'a', 'e']);
  });

  it('fields already together need no moves', () => {
    const groups: ColumnGroup[] = [{ id: 'g', name: 'G', fieldKeys: ['b', 'c'] }];
    expect(planGroupPositions(fields, groups)).toEqual([]);
  });

  it('several scattered groups end up as adjacent blocks', () => {
    const groups: ColumnGroup[] = [
      { id: 'x', name: 'X', fieldKeys: ['a', 'd'] },
      { id: 'y', name: 'Y', fieldKeys: ['b', 'e'] },
    ];
    const moves = new Map(planGroupPositions(fields, groups).map((m) => [m.fieldId, m.position]));
    const order = fields
      .map((x) => ({ ...x, position: moves.get(x.id) ?? x.position }))
      .sort((p, q) => (p.position < q.position ? -1 : 1))
      .map((x) => x.key);
    expect(order).toEqual(['a', 'd', 'b', 'e', 'c']);
  });
});

describe('collapsed groups', () => {
  const owner = makeField('people', {}, { key: 'owner' });
  const score = makeField('number', {}, { key: 'score' });
  const notes = makeField('text', {}, { key: 'notes' });
  const groups: ColumnGroup[] = [
    { id: 'g1', name: 'Assess', fieldKeys: ['score', 'notes'] },
    { id: 'g2', name: 'Who', fieldKeys: ['owner'] },
  ];

  it('hidden columns are the view hidden ones plus the members of collapsed groups', () => {
    const hidden = hiddenWithCollapsed([owner, score, notes], new Set([owner.id]), groups, ['g1']);
    expect([...hidden].sort()).toEqual([notes.id, owner.id, score.id].sort());
    expect([...hiddenWithCollapsed([owner, score], new Set(), groups, undefined)]).toEqual([]);
  });

  it('drops collapsed ids of groups that no longer exist', () => {
    expect(liveCollapsed(groups, ['g2', 'gone'])).toEqual(['g2']);
  });

  it('viewConfig keeps collapsedGroups, falls back when broken and compares them', () => {
    expect(parseViewConfig({ hidden: [], collapsedGroups: ['g1'] }).collapsedGroups).toEqual([
      'g1',
    ]);
    expect(parseViewConfig({ hidden: 'x', collapsedGroups: [3] }).collapsedGroups).toBeUndefined();
    const a = { ...emptyConfig(), collapsedGroups: ['g1', 'g2'] };
    const b = { ...emptyConfig(), collapsedGroups: ['g2', 'g1'] };
    expect(sameConfig(a, b)).toBe(true);
    expect(sameConfig(a, emptyConfig())).toBe(false);
    expect(sameLayout(a, { ...emptyConfig(), collapsedGroups: ['g1'] })).toBe(false);
    expect(sameLayout(emptyConfig(), { ...emptyConfig(), collapsedGroups: [] })).toBe(true);
  });
});

describe('key columns', () => {
  const notes = makeField('text', {}, { key: 'notes', position: 'a0' });
  const owner = makeField('people', {}, { key: 'owner', position: 'a1' });
  const status = makeField(
    'status',
    { options: [{ id: 'o-done', label: 'Done', color: 'green', done: true }] },
    { key: 'status', position: 'a2' },
  );
  const found = makeField('date', { relative: false }, { key: 'found', position: 'a3' });
  const due = makeField('date', { relative: true }, { key: 'due', position: 'a4' });
  const ctx = makeCtx({ fields: [notes, owner, status, found, due] });

  it('derives owner, status and main date from the fields, not their names', () => {
    expect(Object.fromEntries(keyColumns(ctx))).toEqual({
      [owner.id]: 'owner',
      [status.id]: 'status',
      [due.id]: 'date',
    });
  });

  it('a stub shows its key column first, then an option, date or number', () => {
    expect(stubField([notes, due, owner], ctx)?.id).toBe(due.id);
    expect(stubField([notes, found], ctx)?.id).toBe(found.id);
    expect(stubField([notes], ctx)?.id).toBe(notes.id);
    expect(stubField([], ctx)).toBeNull();
  });
});

describe('describeGroupsChange', () => {
  it('says what changed', () => {
    const before: ColumnGroup[] = [{ id: 'g1', name: 'Treat', fieldKeys: ['a'] }];
    const after: ColumnGroup[] = [
      { id: 'g1', name: 'Treatment', fieldKeys: ['a', 'b'] },
      { id: 'g2', name: 'Review', fieldKeys: [] },
    ];
    expect(describeGroupsChange(before, after)).toBe(
      'Renamed Treat to Treatment, added Review, 1 field regrouped.',
    );
    expect(describeGroupsChange(after, after)).toBeNull();
  });
});
