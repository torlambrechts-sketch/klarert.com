import { describe, expect, it } from 'vitest';
import { emptyConfig, type SavedView } from '@/engine/views/config';
import { toView } from '@/lib/sheet-rows';
import { buildTabs, resolveActive } from './tabs-model';

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
    expect(resolveActive(tabs, 'insights')).toMatchObject({ id: 'insights', name: 'Insights', saved: null });
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
      [row('v-mine', 'My insights', 'insights', 'a0', 'u1'), row('v-ins', 'Insights', 'insights', 'a1')],
      'u1',
      false,
    );
    expect(tabs.more.insights).toMatchObject({ id: 'v-ins', type: 'insights', canWrite: false });
    expect(resolveActive(tabs, 'insights')?.id).toBe('v-ins');
    expect(resolveActive(tabs, 'v-mine')).toMatchObject({ canWrite: true });
  });
});
