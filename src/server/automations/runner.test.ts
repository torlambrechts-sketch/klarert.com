import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AutomationEvent, Effect } from '@/engine/automations';
import { FIELD_TYPES } from '@/engine/fields/registry';
import { installFieldTypes } from '@/engine/fields/resolve';
import { makeCtx, makeField, makeItem } from '@/engine/testing/fixtures';
import type { Item, Json } from '@/engine/types';
import {
  runChain,
  type AutomationRow,
  type EffectResult,
  type RunRecord,
  type RunnerStore,
} from './runner';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const status = makeField('status', FIELD_TYPES.status.defaultConfig(), {
  key: 'status',
  name: 'Status',
});
const owner = makeField('people', { multiple: true }, { key: 'owner', name: 'Owner' });
const likelihood = makeField('number', { unit: '', decimals: 0 }, { key: 'likelihood' });
const impact = makeField('number', { unit: '', decimals: 0 }, { key: 'impact' });
const residual = makeField(
  'formula',
  { expr: '{likelihood} * {impact}', result: 'number' },
  { key: 'residual' },
);
const fields = [status, owner, likelihood, impact, residual];
const user = { kind: 'user' as const, id: 'u-maria' };

let autoSeq = 0;
const automation = (over: Partial<AutomationRow>): AutomationRow => ({
  id: `a-${++autoSeq}`,
  sheetId: 's-ca',
  name: `Automation ${autoSeq}`,
  trigger: { type: 'item_created' },
  conditions: [],
  actions: [],
  createdBy: 'u-maria',
  ...over,
});

/** An in-memory store: items by id, effects applied by `onEffect`. */
function fakeStore(
  autos: AutomationRow[],
  items: Item[],
  onEffect: (
    e: Effect,
    store: { items: Map<string, Item> },
  ) => Partial<EffectResult> | Promise<Partial<EffectResult>>,
  paused: Record<string, string[]> = {},
) {
  const state = { items: new Map(items.map((i) => [i.id, i])) };
  const saved: RunRecord[] = [];
  const failures: string[] = [];
  const store: RunnerStore = {
    automations: async (sheetId) => autos.filter((a) => a.sheetId === sheetId),
    paused: async (ids, itemId) => new Set(ids.filter((id) => paused[id]?.includes(itemId))),
    world: async (_sheetId, itemId) => {
      const item = state.items.get(itemId);
      if (!item) return null;
      return {
        item,
        ctx: makeCtx({ fields, items: [...state.items.values()] }),
        roleHolders: () => [],
      };
    },
    execute: vi.fn(async (effect) => ({
      outcome: 'done' as const,
      message: '',
      events: [],
      touched: [],
      ...(await onEffect(effect, state)),
    })),
    saveRun: async (r) => {
      saved.push(r);
    },
    reportFailure: async (_a, _i, message) => {
      failures.push(message);
    },
  };
  return { store, saved, failures, state };
}

const opts = (clock: () => number = () => 0) => ({
  starter: user,
  chainId: 'chain-1',
  clock,
  appUrl: 'https://app.example.com',
  workspace: 'meridian',
});

const created = (itemId: string): AutomationEvent => ({
  type: 'item.created',
  sheetId: 's-ca',
  itemId,
  actor: user,
});

describe('runChain', () => {
  it('a chain that keeps creating items stops at depth 3 with a stopped run', async () => {
    let n = 0;
    const a = automation({
      name: 'Ping',
      actions: [{ type: 'create_item', sheetId: 's-ca', name: 'Next {name}' }],
    });
    const { store, saved } = fakeStore([a], [makeItem({}, { id: 'i-0' })], (_e, s) => {
      const id = `i-${++n}`;
      s.items.set(id, makeItem({}, { id }));
      return { events: [created(id)], touched: [id] };
    });
    const out = await runChain([created('i-0')], store, opts());
    expect(saved.map((r) => [r.depth, r.status])).toEqual([
      [0, 'done'],
      [1, 'done'],
      [2, 'done'],
      [3, 'done'],
      [4, 'stopped'],
    ]);
    expect(saved[4]!.detail).toBe('Loop guard: chain deeper than 3');
    expect(out.messages.at(-1)).toBe('Ping stopped. Loop guard: chain deeper than 3.');
  });

  it('runs an automation at most once per item in a chain', async () => {
    const a = automation({
      trigger: { type: 'field_changed', fieldKey: 'owner' },
      actions: [{ type: 'assign', fieldKey: 'owner', who: 'user:u-james' }],
    });
    const item = makeItem({ [owner.id]: ['u-maria'] }, { id: 'i-1' });
    const { store, saved } = fakeStore([a], [item], (e, s) => {
      if (e.kind !== 'set_values') return {};
      const before = s.items.get('i-1')!;
      const after = {
        ...before,
        values: { ...before.values, ...(e.values as Record<string, Json>) },
      };
      s.items.set('i-1', after);
      return {
        events: [
          {
            type: 'value.changed',
            sheetId: 's-ca',
            itemId: 'i-1',
            fieldId: owner.id,
            before: before.values[owner.id],
            after: after.values[owner.id],
            actor: { kind: 'automation', id: a.id },
          },
        ],
        touched: ['i-1'],
      };
    });
    await runChain(
      [
        {
          type: 'value.changed',
          sheetId: 's-ca',
          itemId: 'i-1',
          fieldId: owner.id,
          before: null,
          after: ['u-maria'],
          actor: user,
        },
      ],
      store,
      opts(),
    );
    expect(saved).toHaveLength(1);
  });

  it('isolates effects: a failing action does not stop the next, the run is partial and the creator is told', async () => {
    const a = automation({
      name: 'Two steps',
      actions: [
        { type: 'set_field', fieldKey: 'status', value: 'opt_done' },
        { type: 'lock_item', reason: 'Approved' },
      ],
    });
    const { store, saved, failures } = fakeStore([a], [makeItem({}, { id: 'i-1' })], (e) => {
      if (e.kind === 'set_values') throw new Error('Database is down');
      return {};
    });
    const out = await runChain([created('i-1')], store, opts());
    expect(saved[0]!.status).toBe('partial');
    expect(saved[0]!.steps.map((s) => [s.outcome, s.message])).toEqual([
      ['failed', 'Database is down'],
      ['done', ''],
    ]);
    expect(failures).toEqual(['Database is down']);
    expect(out.messages[0]).toBe(
      'Two steps: Set Status to Done (failed: Database is down) · Lock the item: Approved',
    );
  });

  it('a blocked write is a blocked step, and a run with nothing done has failed', async () => {
    const a = automation({
      actions: [{ type: 'set_field', fieldKey: 'status', value: 'opt_done' }],
    });
    const { store, saved, failures } = fakeStore([a], [makeItem({}, { id: 'i-1' })], () => ({
      outcome: 'blocked',
      message: 'Fill in Root cause first.',
    }));
    await runChain([created('i-1')], store, opts());
    expect(saved[0]).toMatchObject({ status: 'failed', detail: 'Fill in Root cause first.' });
    expect(failures).toEqual([]);
  });

  it('stops at the 5 s budget: remaining steps skipped, the run stopped, later events dropped', async () => {
    let now = 0;
    const a = automation({
      name: 'Slow',
      actions: [
        { type: 'lock_item' },
        { type: 'post_update', message: 'one' },
        { type: 'post_update', message: 'two' },
      ],
    });
    const b = automation({ name: 'Never', actions: [{ type: 'lock_item' }] });
    const { store, saved } = fakeStore(
      [a, b],
      [makeItem({}, { id: 'i-1' }), makeItem({}, { id: 'i-2' })],
      () => {
        now += 6000;
        return {};
      },
    );
    const out = await runChain(
      [created('i-1'), created('i-2')],
      store,
      opts(() => now),
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]!.status).toBe('stopped');
    expect(saved[0]!.steps.map((s) => s.outcome)).toEqual(['done', 'skipped', 'skipped']);
    expect(saved[0]!.steps[1]!.message).toBe('Time budget reached');
    expect(out.messages[0]).toMatch(/^Slow stopped \(Time budget reached\)/);
  });

  it('skips paused automations for that item only', async () => {
    const a = automation({ actions: [{ type: 'lock_item' }] });
    const { store, saved } = fakeStore(
      [a],
      [makeItem({}, { id: 'i-1' }), makeItem({}, { id: 'i-2' })],
      () => ({}),
      { [a.id]: ['i-1'] },
    );
    await runChain([created('i-1'), created('i-2')], store, opts());
    expect(saved.map((r) => r.itemId)).toEqual(['i-2']);
  });

  it('stores no run when the conditions are false', async () => {
    const a = automation({
      conditions: [{ fieldKey: 'status', op: 'is_any_of', value: ['opt_done'] }],
      actions: [{ type: 'lock_item' }],
    });
    const { store, saved } = fakeStore([a], [makeItem({}, { id: 'i-1' })], () => ({}));
    const out = await runChain([created('i-1')], store, opts());
    expect(saved).toEqual([]);
    expect(out).toEqual({ runs: [], messages: [] });
  });

  it('fires number triggers on computed fields from the stored change', async () => {
    const a = automation({
      name: 'High risk',
      trigger: { type: 'number_above', fieldKey: 'residual', threshold: 12 },
      actions: [{ type: 'post_update', message: 'Residual is {residual}' }],
    });
    const item = makeItem({ [likelihood.id]: 4, [impact.id]: 4 }, { id: 'i-1' });
    const { store, saved, state } = fakeStore([a], [item], () => ({}));
    const change = (before: number, after: number): AutomationEvent => ({
      type: 'value.changed',
      sheetId: 's-ca',
      itemId: 'i-1',
      fieldId: impact.id,
      before,
      after,
      actor: user,
    });
    await runChain([change(3, 4)], store, opts()); // 12 → 16
    expect(saved).toHaveLength(1);
    expect(saved[0]!.steps[0]!.summary).toBe('Post an update');
    state.items.set('i-1', { ...item, values: { [likelihood.id]: 4, [impact.id]: 5 } });
    await runChain([change(4, 5)], store, opts()); // 16 → 20: still above
    expect(saved).toHaveLength(1);
  });

  it('plans each action on the item as the earlier actions left it', async () => {
    const a = automation({
      actions: [
        { type: 'set_field', fieldKey: 'status', value: 'opt_done' },
        { type: 'post_update', message: 'Now {status}' },
      ],
    });
    const posts: string[] = [];
    const { store } = fakeStore([a], [makeItem({}, { id: 'i-1' })], (e, s) => {
      if (e.kind === 'post') posts.push(e.body);
      if (e.kind !== 'set_values') return {};
      const it = s.items.get('i-1')!;
      s.items.set('i-1', {
        ...it,
        values: { ...it.values, ...(e.values as Record<string, Json>) },
      });
      return { touched: ['i-1'] };
    });
    await runChain([created('i-1')], store, opts());
    expect(posts).toEqual(['Now Done']);
  });

  it('summarises bulk runs in one line', async () => {
    const a = automation({ actions: [{ type: 'lock_item' }] });
    const { store } = fakeStore(
      [a],
      [makeItem({}, { id: 'i-1' }), makeItem({}, { id: 'i-2' })],
      () => ({}),
    );
    const out = await runChain([created('i-1'), created('i-2')], store, {
      ...opts(),
      summarise: true,
    });
    expect(out.messages).toEqual(['1 automation ran 2 times']);
  });
});
