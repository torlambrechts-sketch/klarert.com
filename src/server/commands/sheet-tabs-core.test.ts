import { describe, expect, it, vi } from 'vitest';
import type { Json } from '@/engine/types';
import { dropTab } from '@/engine/views/tabs';
import { ok } from '@/server/result';
import {
  ONLY_ADMINS_TABS,
  setSheetTabsWith,
  type SheetTabsDeps,
  type TabView,
} from './sheet-tabs-core';

const SHARED = '8b1c2d3e-0000-4000-8000-000000000001';
const BOARD = '8b1c2d3e-0000-4000-8000-000000000002';
const MINE = '8b1c2d3e-0000-4000-8000-000000000003';

const VIEWS: TabView[] = [
  { id: BOARD, name: 'By status', type: 'kanban', ownerId: null, position: 'a0' },
  { id: SHARED, name: 'Overdue', type: 'list', ownerId: null, position: 'a1' },
  { id: MINE, name: 'My open', type: 'list', ownerId: 'u1', position: 'a2' },
];

function deps(role: string, settings: Record<string, Json> | null = { holdAutomations: true }) {
  const saveSettings = vi.fn<SheetTabsDeps['saveSettings']>(async () => ok(null));
  const d: SheetTabsDeps = {
    role,
    loadSettings: vi.fn(async () => settings),
    views: vi.fn(async () => VIEWS),
    saveSettings,
  };
  return { d, saveSettings };
}

const tabs = [
  { id: 'kanban' },
  { id: 'table' },
  { id: 'insights', label: 'Dashboard' },
  { id: 'calendar', hidden: true },
  { id: SHARED },
];

describe('setSheetTabs', () => {
  it.each(['editor', 'viewer'])('refuses a %s and saves nothing', async (role) => {
    const { d, saveSettings } = deps(role);
    expect(await setSheetTabsWith(d, { tabs })).toEqual({
      ok: false,
      error: { code: 'forbidden', message: ONLY_ADMINS_TABS },
    });
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("saves an owner's or admin's tab set into the settings it had", async () => {
    for (const role of ['owner', 'admin']) {
      const { d, saveSettings } = deps(role);
      const r = await setSheetTabsWith(d, { tabs, defaultViewId: 'kanban' });
      expect(r).toMatchObject({ ok: true, data: { defaultViewId: 'kanban', notice: null } });
      expect(saveSettings).toHaveBeenCalledWith({
        holdAutomations: true,
        tabs,
        defaultViewId: 'kanban',
      });
      expect(r.ok && r.data.summary).toBe(
        'Tabs changed: renamed Insights to Dashboard, hid Calendar, changed the order, By status opens first',
      );
    }
  });

  it('refuses a personal view and a view that is not on the sheet', async () => {
    const { d, saveSettings } = deps('admin');
    const personal = await setSheetTabsWith(d, { tabs: [{ id: 'table' }, { id: MINE }] });
    expect(personal).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(!personal.ok && personal.error.message).toMatch(/personal view/);
    const gone = await setSheetTabsWith(d, {
      tabs: [{ id: 'table' }, { id: '8b1c2d3e-0000-4000-8000-0000000000ff' }],
    });
    expect(gone).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('refuses a hidden Table and a hidden default given explicitly', async () => {
    const { d } = deps('owner');
    expect(await setSheetTabsWith(d, { tabs: [{ id: 'table', hidden: true }] })).toMatchObject({
      ok: false,
      error: { message: 'Table is always shown.' },
    });
    expect(
      await setSheetTabsWith(d, {
        tabs: [{ id: 'table' }, { id: 'form', hidden: true }],
        defaultViewId: 'form',
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid' } });
  });

  it('falls back to the Table when the new set hides the view that opened first, and says so', async () => {
    // the default is the shared view behind the Board tab: hiding Board hides it
    const { d, saveSettings } = deps('owner', { defaultViewId: BOARD });
    const r = await setSheetTabsWith(d, {
      tabs: [{ id: 'table' }, { id: 'kanban', hidden: true }],
    });
    expect(r).toMatchObject({
      ok: true,
      data: { defaultViewId: 'table', notice: 'By status is hidden, so Table opens first now.' },
    });
    expect(saveSettings.mock.calls[0]![0]).toMatchObject({ defaultViewId: 'table' });
  });

  it('keeps a default that stays shown', async () => {
    const { d } = deps('owner', { defaultViewId: 'calendar' });
    const r = await setSheetTabsWith(d, { tabs: [{ id: 'table' }, { id: 'calendar' }] });
    expect(r).toMatchObject({ ok: true, data: { defaultViewId: 'calendar', notice: null } });
  });

  it('reports a sheet that is gone', async () => {
    const { d } = deps('owner', null);
    expect(await setSheetTabsWith(d, { tabs })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });
});

describe('deleteView', () => {
  it("drops the deleted view's tab (dropTab, used by the command)", () => {
    expect(dropTab({ tabs: [{ id: 'table' }, { id: SHARED, label: 'Late' }] }, SHARED)).toEqual({
      tabs: [{ id: 'table' }],
    });
  });
});
