import { beforeAll, describe, expect, it } from 'vitest';
import type { AutomationEvent, Effect } from '@/engine/automations';
import { FIELD_TYPES } from '@/engine/fields/registry';
import { installFieldTypes } from '@/engine/fields/resolve';
import { makeItem, sheet } from '@/engine/testing/fixtures';
import {
  CHILD,
  childCtx,
  cStatus,
  makeSubitem,
  pStatus,
  subitemCtx,
} from '@/engine/testing/subitems-world';
import type { Item, Json } from '@/engine/types';
import {
  runChain,
  type AutomationRow,
  type EffectResult,
  type RunRecord,
  type RunnerStore,
} from './runner';

// The runner with sub-items (docs/04 §7): a sub-item's events are projected onto its parent at the same depth, actions
// go one level deeper, and the loop guard stops a chain that goes child → parent → children → … past depth 3.

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const user = { kind: 'user' as const, id: 'u-maria' };
let seq = 0;
const automation = (over: Partial<AutomationRow>): AutomationRow => ({
  id: `a-${++seq}`,
  sheetId: sheet.id,
  name: `Automation ${seq}`,
  trigger: { type: 'item_created' },
  conditions: [],
  actions: [],
  createdBy: 'u-maria',
  ...over,
});

function store(
  autos: AutomationRow[],
  items: Item[],
  onEffect: (e: Effect, items: Map<string, Item>) => Partial<EffectResult>,
) {
  const state = new Map(items.map((i) => [i.id, i]));
  const saved: RunRecord[] = [];
  const s: RunnerStore = {
    automations: async (sheetId) => autos.filter((a) => a.sheetId === sheetId),
    paused: async () => new Set(),
    world: async (sheetId, itemId) => {
      const item = state.get(itemId);
      if (!item || item.sheetId !== sheetId) return null;
      const all = [...state.values()];
      return {
        item,
        ctx: sheetId === CHILD ? childCtx({ items: all }) : subitemCtx({ items: all }),
        roleHolders: () => [],
      };
    },
    parentSheetOf: async (sheetId) => (sheetId === CHILD ? sheet.id : null),
    execute: async (effect) => ({
      outcome: 'done',
      message: '',
      events: [],
      touched: [],
      ...onEffect(effect, state),
    }),
    saveRun: async (r) => {
      saved.push(r);
    },
    reportFailure: async () => undefined,
  };
  return { store: s, saved, state };
}

const opts = {
  starter: user,
  chainId: 'c',
  clock: () => 0,
  appUrl: 'https://a.test',
  workspace: 'w',
};

const valueChanged = (item: Item, fieldId: string, before: Json, after: Json): AutomationEvent => ({
  type: 'value.changed',
  sheetId: item.sheetId,
  itemId: item.id,
  fieldId,
  before,
  after,
  actor: { kind: 'automation', id: 'x' },
});

describe('runChain with sub-items', () => {
  it('a sub-item change runs the parent’s trigger at the same depth; its write goes one deeper', async () => {
    const parent = makeItem({ [pStatus.id]: 'p_open' }, { id: 'p1', displayId: 'CA-001' });
    const a = makeSubitem(parent, { [cStatus.id]: 'c_done' }, { id: 'a' });
    const b = makeSubitem(parent, { [cStatus.id]: 'c_done' }, { id: 'b' });
    const close = automation({
      name: 'Close',
      trigger: { type: 'all_subitems_done' },
      actions: [{ type: 'set_field', fieldKey: 'status', value: 'p_done' }],
    });
    const { store: s, saved } = store([close], [parent, a, b], (e, items) => {
      if (e.kind !== 'set_values') return {};
      const before = items.get(e.itemId)!;
      const after = {
        ...before,
        values: { ...before.values, ...(e.values as Record<string, Json>) },
      };
      items.set(e.itemId, after);
      return { touched: [e.itemId], events: [valueChanged(after, pStatus.id, 'p_open', 'p_done')] };
    });
    // b was the last open one; the person's change is depth 0
    const out = await runChain([valueChanged(b, cStatus.id, 'c_todo', 'c_done')], s, opts);
    expect(saved.map((r) => [r.automationId, r.itemId, r.depth, r.status])).toEqual([
      [close.id, 'p1', 0, 'done'],
    ]);
    expect(saved[0]!.event.type).toBe('subitem.event');
    expect(out.messages[0]).toContain('Set Status to Done');
  });

  it('child → parent → children chains stop at depth 3 with a stopped run (loop guard)', async () => {
    let n = 0;
    const p0 = makeItem({}, { id: 'p0', displayId: 'CA-100' });
    // every new sub-item makes the parent's automation add a sub-item under a new parent: each hop is one deeper
    const grow = automation({
      name: 'Grow',
      trigger: { type: 'subitem_created' },
      actions: [{ type: 'create_subitems', items: [{ name: 'Next' }] }],
    });
    const first = makeSubitem(p0, {}, { id: 'c0' });
    const { store: s2, saved: saved2 } = store([grow], [p0, first], (e, items) => {
      if (e.kind !== 'create_subitems') return {};
      n += 1;
      const parent = makeItem({}, { id: `q${n}`, displayId: `CA-2${n}` });
      const child = makeSubitem(parent, {}, { id: `d${n}` });
      items.set(parent.id, parent);
      items.set(child.id, child);
      return {
        touched: [parent.id, child.id],
        events: [{ type: 'item.created', sheetId: CHILD, itemId: child.id, actor: user }],
      };
    });
    const out = await runChain(
      [{ type: 'item.created', sheetId: CHILD, itemId: 'c0', actor: user }],
      s2,
      opts,
    );
    expect(saved2.map((r) => [r.depth, r.status])).toEqual([
      [0, 'done'],
      [1, 'done'],
      [2, 'done'],
      [3, 'done'],
      [4, 'stopped'],
    ]);
    expect(out.messages.at(-1)).toBe('Grow stopped. Loop guard: chain deeper than 3.');
  });

  it('the parent’s world is read again after a sub-item changes (no stale roll-up)', async () => {
    const parent = makeItem({}, { id: 'p1', displayId: 'CA-001' });
    const a = makeSubitem(parent, { [cStatus.id]: 'c_todo' }, { id: 'a' });
    const watch = automation({
      name: 'Watch',
      trigger: { type: 'all_subitems_done' },
      actions: [{ type: 'post_update', message: 'All done' }],
    });
    const { store: s, saved, state } = store([watch], [parent, a], () => ({}));
    // warm the parent's world, then close the sub-item
    await s.world(sheet.id, 'p1');
    state.set('a', { ...a, values: { [cStatus.id]: 'c_done' } });
    await runChain([valueChanged(state.get('a')!, cStatus.id, 'c_todo', 'c_done')], s, opts);
    expect(saved.map((r) => r.status)).toEqual(['done']);
  });

  it('a released sub-item hold runs the sub-item’s automations, then the parent’s (child events first)', async () => {
    const parent = makeItem({}, { id: 'p1', displayId: 'CA-001' });
    const a = makeSubitem(parent, { [cStatus.id]: 'c_done' }, { id: 'a' });
    const childAuto = automation({
      sheetId: CHILD,
      name: 'Child',
      trigger: { type: 'item_created' },
      actions: [{ type: 'post_update', message: 'Added' }],
    });
    const parentAuto = automation({
      name: 'Parent',
      trigger: { type: 'subitem_created' },
      actions: [{ type: 'post_update', message: 'A step was added' }],
    });
    const { store: s, saved } = store([childAuto, parentAuto], [parent, a], () => ({}));
    // what releaseHold emits for a new row: item_created, then the values set while it was held
    await runChain(
      [
        { type: 'item.created', sheetId: CHILD, itemId: 'a', actor: user },
        valueChanged(a, cStatus.id, null, 'c_done'),
      ],
      s,
      opts,
    );
    expect(saved.map((r) => [r.automationId, r.itemId, r.depth])).toEqual([
      [childAuto.id, 'a', 0],
      [parentAuto.id, 'p1', 0],
    ]);
  });
});
