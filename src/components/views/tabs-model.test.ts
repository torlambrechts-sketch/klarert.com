import { describe, expect, it } from 'vitest';
import { emptyConfig, type SavedView } from '@/engine/views/config';
import { toView } from '@/lib/sheet-rows';
import { applyTabLayout, buildTabs, layoutEntries, resolveActive } from './tabs-model';

// Rows as the database stores them: a Table view is stored as 'list', the former Grid as 'grid'.
const row = (
  id: string,
  name: string,
  type: string,
  position: string,
  owner: string | null = null,
) =>
  toView({
    id,
    sheet_id: 's1',
    org_id: 'o1',
    name,
    type,
    config: {},
    owner_id: owner,
    position,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
  } as Parameters<typeof toView>[0]);

describe('view tabs', () => {
  it('reads stored list and grid views as table views', () => {
    const list = row('v-list', 'List', 'list', 'a0');
    const grid = row('v-grid', 'Grid', 'grid', 'a1');
    expect(list.type).toBe('table');
    expect(grid.type).toBe('table');
    expect(grid.legacyType).toBe('grid');
    expect(row('v-k', 'Board', 'kanban', 'a2')).not.toHaveProperty('legacyType');
  });

  it('shows one Table tab for a sheet that had List and Grid tabs', () => {
    const views: SavedView[] = [
      row('v-list', 'List', 'list', 'a0'),
      row('v-grid', 'Grid', 'grid', 'a1'),
      row('v-board', 'By status', 'kanban', 'a2'),
      row('v-mine', 'My open', 'list', 'a3', 'u1'),
    ];
    const tabs = buildTabs(views, 'u1', true);
    expect(tabs.table).toMatchObject({ id: 'v-list', name: 'Table', type: 'table' });
    expect(tabs.more.kanban.id).toBe('v-board');
    expect(tabs.others.map((v) => v.id)).toEqual(['v-board', 'v-mine']);
    // the former Grid view has no tab but still opens by its id
    expect(tabs.merged.map((v) => v.id)).toEqual(['v-grid']);
    expect(resolveActive(tabs, 'v-grid')?.id).toBe('v-grid');
  });

  it('opens the Table for table, list and grid ids, and the built-in one without saved views', () => {
    const tabs = buildTabs([], 'u1', true);
    expect(tabs.table).toMatchObject({ id: 'table', saved: null, name: 'Table' });
    for (const id of ['table', 'list', 'grid']) expect(resolveActive(tabs, id)).toBe(tabs.table);
    expect(resolveActive(tabs, 'calendar')).toBe(tabs.more.calendar);
    expect(resolveActive(tabs, 'insights')).toMatchObject({
      id: 'insights',
      name: 'Insights',
      saved: null,
    });
    expect(resolveActive(tabs, '8b1c2d3e-0000-4000-8000-000000000000')).toBeNull();
  });

  it('keeps a shared table view made later as its own tab', () => {
    const tabs = buildTabs(
      [row('v-grid', 'Grid', 'grid', 'a0'), row('v-new', 'Audit table', 'list', 'a1')],
      'u1',
      false,
    );
    expect(tabs.table.id).toBe('v-grid');
    expect(tabs.merged).toEqual([]);
    expect(tabs.others.map((v) => v.name)).toEqual(['Audit table']);
    expect(tabs.table.canWrite).toBe(false);
  });

  it('keeps the config of the view behind the tab', () => {
    const v = {
      ...row('v-list', 'List', 'list', 'a0'),
      config: { ...emptyConfig(), hidden: ['x'] },
    };
    expect(buildTabs([v], 'u1', true).table.saved?.config.hidden).toEqual(['x']);
  });

  it('backs the Insights tab with the first shared insights view; personal ones get their own tab', () => {
    const tabs = buildTabs(
      [
        row('v-mine', 'My insights', 'insights', 'a0', 'u1'),
        row('v-ins', 'Insights', 'insights', 'a1'),
      ],
      'u1',
      false,
    );
    expect(tabs.more.insights).toMatchObject({ id: 'v-ins', type: 'insights', canWrite: false });
    expect(resolveActive(tabs, 'insights')?.id).toBe('v-ins');
    expect(resolveActive(tabs, 'v-mine')).toMatchObject({ canWrite: true });
  });
});

describe('tab layout (settings.tabs)', () => {
  const views: SavedView[] = [
    row('v-list', 'List', 'list', 'a0'),
    row('v-board', 'By status', 'kanban', 'a1'),
    row('v-overdue', 'Overdue', 'list', 'a2'),
    row('v-mine', 'My open', 'list', 'a3', 'u1'),
    row('v-audit', 'Audit table', 'list', 'a4'),
    row('v-theirs', 'Their view', 'list', 'a5', 'u2'),
  ];
  const tabs = buildTabs(views, 'u1', true);
  const words = (l: { label: string }[]) => l.map((t) => t.label);

  it("shows today's order without a tab set: built-ins, shared views, then my personal views", () => {
    const layout = applyTabLayout(tabs, null);
    expect(words(layout.shown)).toEqual([
      'Table',
      'Insights',
      'By status',
      'Calendar',
      'Forms',
      'Overdue',
      'Audit table',
    ]);
    // the Design tab starts under More until an owner or admin shows it (docs/05 §3.8)
    expect(words(layout.hidden)).toEqual(['Design']);
    // only my own personal views
    expect(words(layout.personal)).toEqual(['My open']);
    expect(applyTabLayout(buildTabs([], 'u1', false), null).shown.map((t) => t.label)).toEqual([
      'Table',
      'Insights',
      'Board',
      'Calendar',
      'Forms',
    ]);
  });

  it('follows the configured order, labels and hidden tabs', () => {
    const layout = applyTabLayout(tabs, [
      { id: 'kanban' },
      { id: 'table' },
      { id: 'insights', label: 'Dashboard' },
      { id: 'calendar', hidden: true },
      { id: 'v-overdue', label: 'Late' },
      { id: 'form', hidden: true },
      { id: 'v-audit' },
    ]);
    expect(words(layout.shown)).toEqual(['By status', 'Table', 'Dashboard', 'Late', 'Audit table']);
    expect(words(layout.hidden)).toEqual(['Calendar', 'Forms', 'Design']);
    // a hidden tab still resolves by its id (?view=calendar)
    expect(resolveActive(tabs, 'calendar')?.id).toBe('calendar');
    expect(layout.shown[0]).toMatchObject({ entryId: 'kanban', view: { id: 'v-board' } });
  });

  it('appends shared views and built-ins the set does not list, skips gone views, keeps personal last', () => {
    const layout = applyTabLayout(tabs, [
      { id: 'table' },
      { id: '8b1c2d3e-0000-4000-8000-000000000000' },
      { id: 'v-mine' },
      { id: 'v-audit', hidden: true },
    ]);
    expect(words(layout.shown)).toEqual([
      'Table',
      'Insights',
      'By status',
      'Calendar',
      'Forms',
      'Overdue',
    ]);
    expect(words(layout.hidden)).toEqual(['Audit table', 'Design']);
    expect(words(layout.personal)).toEqual(['My open']);
  });

  it('shows the Design tab once the tab set lists it as shown, and opens it by its id either way', () => {
    expect(resolveActive(tabs, 'design')).toMatchObject({
      id: 'design',
      type: 'design',
      saved: null,
    });
    const layout = applyTabLayout(tabs, [{ id: 'table' }, { id: 'design' }]);
    expect(words(layout.shown).slice(0, 2)).toEqual(['Table', 'Design']);
    expect(words(layout.hidden)).toEqual([]);
    // shown, it is stored; hidden and not renamed, it is the default and not stored
    expect(layoutEntries(layout.all).map((t) => t.id)).toContain('design');
    expect(layoutEntries(applyTabLayout(tabs, null).all).map((t) => t.id)).not.toContain('design');
  });

  it('never hides the Table, shows a view backing a built-in tab once, and round-trips the set', () => {
    const layout = applyTabLayout(tabs, [
      { id: 'table', hidden: true },
      { id: 'v-board', label: 'Board' },
      { id: 'kanban' },
    ]);
    expect(layout.shown.filter((t) => t.view.id === 'v-board')).toHaveLength(1);
    expect(layout.shown[0]).toMatchObject({ entryId: 'table', hidden: false });
    expect(layoutEntries(layout.all).slice(0, 2)).toEqual([
      { id: 'table' },
      { id: 'v-board', label: 'Board' },
    ]);
  });
});

describe('the Forms tab', () => {
  it('lists every form of the sheet under one tab, and a form id opens it', () => {
    const tabs = buildTabs(
      [
        row('v-list', 'List', 'list', 'a0'),
        row('v-f1', 'Report an incident', 'form', 'a1'),
        row('v-f2', 'Investigator intake', 'form', 'a2'),
      ],
      'u1',
      true,
    );
    expect(tabs.more.form).toMatchObject({ id: 'form', name: 'Forms (2)', saved: null });
    expect(tabs.forms.map((f) => f.name)).toEqual(['Report an incident', 'Investigator intake']);
    expect(tabs.others).toEqual([]);
    expect(resolveActive(tabs, 'v-f2')).toBe(tabs.more.form);
    expect(applyTabLayout(tabs, null).shown.map((t) => t.label)).toEqual([
      'Table',
      'Insights',
      'Board',
      'Calendar',
      'Forms (2)',
    ]);
    expect(buildTabs([row('v-f1', 'Only', 'form', 'a1')], 'u1', true).more.form.name).toBe('Forms');
  });
});
