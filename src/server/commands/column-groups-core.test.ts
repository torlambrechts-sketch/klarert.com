import { describe, expect, it, vi } from 'vitest';
import type { Json } from '@/engine/types';
import { ok } from '@/server/result';
import {
  ONLY_ADMINS_GROUPS,
  setColumnGroupsWith,
  type ColumnGroupsDeps,
} from './column-groups-core';

const FIELDS = [
  { id: 'f1', key: 'owner', position: 'a0' },
  { id: 'f2', key: 'status', position: 'a1' },
  { id: 'f3', key: 'score', position: 'a2' },
  { id: 'f4', key: 'review', position: 'a3' },
];

function deps(role: string, settings: Record<string, Json> = { holdAutomations: true }) {
  const saveSettings = vi.fn<ColumnGroupsDeps['saveSettings']>(async () => ok(null));
  const moveFields = vi.fn<ColumnGroupsDeps['moveFields']>(async () => ok(null));
  const d: ColumnGroupsDeps = {
    role,
    loadSheet: vi.fn(async () => ({ settings, fields: FIELDS })),
    saveSettings,
    moveFields,
  };
  return { d, saveSettings, moveFields };
}

const groups = [{ id: 'assess', name: 'Assess', fieldKeys: ['owner', 'score'] }];

describe('setColumnGroups', () => {
  it.each(['editor', 'viewer'])('refuses a %s and changes nothing', async (role) => {
    const { d, saveSettings, moveFields } = deps(role);
    expect(await setColumnGroupsWith(d, { groups })).toEqual({
      ok: false,
      error: { code: 'forbidden', message: ONLY_ADMINS_GROUPS },
    });
    expect(saveSettings).not.toHaveBeenCalled();
    expect(moveFields).not.toHaveBeenCalled();
  });

  it('an owner or admin saves the groups into the settings (the logged sheet write) and moves fields together', async () => {
    for (const role of ['owner', 'admin']) {
      const { d, saveSettings, moveFields } = deps(role);
      const r = await setColumnGroupsWith(d, { groups });
      expect(r).toMatchObject({
        ok: true,
        data: { moved: 1, summary: 'Added Assess, 2 fields regrouped.' },
      });
      expect(saveSettings).toHaveBeenCalledWith({ holdAutomations: true, columnGroups: groups });
      const moves = moveFields.mock.calls[0]![0];
      expect(moves.map((m) => m.fieldId)).toEqual(['f3']);
      expect(moves[0]!.position > 'a0' && moves[0]!.position < 'a1').toBe(true);
    }
  });

  it('no groups removes the setting', async () => {
    const { d, saveSettings } = deps('admin', { columnGroups: groups as unknown as Json, x: 1 });
    await setColumnGroupsWith(d, { groups: [] });
    expect(saveSettings).toHaveBeenCalledWith({ x: 1 });
  });

  it('refuses unknown fields, a field in two groups and duplicate names', async () => {
    const { d, saveSettings } = deps('admin');
    const bad = async (g: unknown) => setColumnGroupsWith(d, { groups: g as typeof groups });
    expect(await bad([{ id: 'a', name: 'A', fieldKeys: ['gone'] }])).toMatchObject({ ok: false });
    expect(
      await bad([
        { id: 'a', name: 'A', fieldKeys: ['owner'] },
        { id: 'b', name: 'B', fieldKeys: ['owner'] },
      ]),
    ).toMatchObject({ ok: false, error: { message: 'A field can be in one group only.' } });
    expect(
      await bad([
        { id: 'a', name: 'Assess', fieldKeys: [] },
        { id: 'b', name: 'assess', fieldKeys: [] },
      ]),
    ).toMatchObject({ ok: false });
    expect(await bad([{ id: 'a', name: '', fieldKeys: [] }])).toMatchObject({ ok: false });
    expect(saveSettings).not.toHaveBeenCalled();
  });
});
