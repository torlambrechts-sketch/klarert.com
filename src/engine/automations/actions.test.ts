import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import type { Automation, Json } from '../types';
import {
  ACTION_IDS,
  ACTIONS,
  planActions,
  recipients,
  resolveValueToken,
  type ActionJson,
  type Actor,
  type PlanEnv,
} from '.';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const f = {
  status: makeField('status', FIELD_TYPES.status.defaultConfig(), {
    key: 'status',
    name: 'Status',
    position: 'a0',
  }),
  owner: makeField('people', { multiple: true }, { key: 'owner', name: 'Owner', position: 'a1' }),
  lead: makeField('people', { multiple: false }, { key: 'lead', name: 'Lead', position: 'a2' }),
  due: makeField('date', { relative: false }, { key: 'due', name: 'Due date', position: 'a3' }),
  version: makeField('version', {}, { key: 'version', name: 'Version', position: 'a4' }),
  controls: makeField(
    'link',
    { targetSheetId: 's-controls', multiple: true, inverseFieldId: null },
    { key: 'controls', name: 'Controls', position: 'a5' },
  ),
  secret: makeField('protected', { allowedUserIds: [] }, { key: 'secret', position: 'a6' }),
  score: makeField(
    'formula',
    { expr: '1 + 1', result: 'number' },
    { key: 'score', name: 'Score', position: 'a7' },
  ),
};
const controlStatus = makeField('status', FIELD_TYPES.status.defaultConfig(), {
  key: 'status',
  name: 'Control status',
  sheetId: 's-controls',
});
const fields = Object.values(f);
const item = makeItem(
  { [f.status.id]: 'opt_wip', [f.owner.id]: ['u-maria'], [f.version.id]: 'v1.2' },
  { id: 'i-1', displayId: 'CA-014', name: 'Fix guard on press 3' },
);
const ctx = makeCtx({
  fields,
  items: [item],
  links: { [`i-1:${f.controls.id}`]: ['c-1', 'c-2'] },
  otherFields: { 's-controls': [controlStatus] },
});
const james: Actor = { kind: 'user', id: 'u-james' };
const automation: Pick<Automation, 'id' | 'name' | 'trigger'> = {
  id: 'a-1',
  name: 'Done → lock',
  trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_done' },
};
const env = (actor: Actor = james): PlanEnv => ({
  appUrl: 'https://app.example.com',
  workspace: 'meridian',
  actor,
  automation,
  roleHolders: (id) => (id === 'r-cm' ? ['u-vic'] : []),
});
const plan = (action: Record<string, Json>, it = item, e = env()) =>
  planActions([action as ActionJson], it, null, ctx, e)[0]!;

describe('resolveValueToken', () => {
  it('reads $today, $in:N, $empty, $actor and literals', () => {
    expect(resolveValueToken('$today', ctx, james)).toEqual({ ok: true, value: '2026-11-11' });
    expect(resolveValueToken('$in:14', ctx, james)).toEqual({ ok: true, value: '2026-11-25' });
    expect(resolveValueToken('$in:-1', ctx, james)).toEqual({ ok: true, value: '2026-11-10' });
    expect(resolveValueToken('$empty', ctx, james)).toEqual({ ok: true, value: null });
    expect(resolveValueToken('$actor', ctx, james)).toEqual({ ok: true, value: 'u-james' });
    expect(resolveValueToken('$actor', ctx, { kind: 'form', id: null }).ok).toBe(false);
    expect(resolveValueToken('opt_done', ctx, james)).toEqual({ ok: true, value: 'opt_done' });
    expect(resolveValueToken(5, ctx, james)).toEqual({ ok: true, value: 5 });
  });
});

describe('planActions', () => {
  it('has a planner for each of the 14 actions (11 on the item, 3 for sub-items)', () => {
    expect(ACTION_IDS).toHaveLength(14);
    expect(Object.keys(ACTIONS).sort()).toEqual([...ACTION_IDS].sort());
  });

  it('set_field plans a set_values effect with a readable summary', () => {
    const s = plan({ type: 'set_field', fieldKey: 'status', value: 'opt_done' });
    expect(s.summary).toBe('Set Status to Done');
    expect(s.effects).toEqual([
      { kind: 'set_values', sheetId: 's-ca', itemId: 'i-1', values: { [f.status.id]: 'opt_done' } },
    ]);
    const d = plan({ type: 'set_field', fieldKey: 'due', value: '$in:14' });
    expect(d.summary).toBe('Set Due date to 25 Nov 2026');
    expect(d.effects[0]).toMatchObject({ values: { [f.due.id]: '2026-11-25' } });
    expect(plan({ type: 'set_field', fieldKey: 'due', value: '$empty' }).summary).toBe(
      'Set Due date to empty',
    );
    expect(
      plan({ type: 'set_field', fieldKey: 'owner', value: '$actor' }).effects[0],
    ).toMatchObject({
      values: { [f.owner.id]: 'u-james' },
    });
  });

  it('set_field fails for missing and computed fields, and skips $actor without a person', () => {
    expect(plan({ type: 'set_field', fieldKey: 'gone', value: 1 })).toMatchObject({
      outcome: 'failed',
      message: 'The field "gone" no longer exists.',
    });
    expect(plan({ type: 'set_field', fieldKey: 'score', value: 1 })).toMatchObject({
      outcome: 'failed',
    });
    expect(
      plan(
        { type: 'set_field', fieldKey: 'owner', value: '$actor' },
        item,
        env({ kind: 'form', id: null }),
      ),
    ).toMatchObject({ outcome: 'skipped' });
  });

  it('notify resolves fields, users, teams, job roles and the actor, without duplicates', () => {
    expect(
      recipients(
        ['field:owner', 'user:u-maria', 'team:t-it', 'jobRole:r-cm', 'actor', 'user:not-a-member'],
        item,
        ctx,
        env(),
      ),
    ).toEqual(['u-maria', 'u-james', 'u-vic']);
    const s = plan({ type: 'notify', to: ['field:owner'], message: '{id} {name} is now {status}' });
    expect(s.summary).toBe('Notify Maria Pereira');
    expect(s.effects).toEqual([
      {
        kind: 'notify',
        itemId: 'i-1',
        userIds: ['u-maria'],
        notification: 'notify',
        body: 'CA-014 Fix guard on press 3 is now Working on it',
        post: 'Notified Maria Pereira: CA-014 Fix guard on press 3 is now Working on it',
      },
    ]);
  });

  it('notify with nobody to tell is skipped', () => {
    expect(plan({ type: 'notify', to: ['field:lead'], message: 'x' })).toMatchObject({
      outcome: 'skipped',
      message: 'No one to notify.',
      effects: [],
    });
  });

  it('request_update notifies the people in the field with kind request and posts on the item', () => {
    const s = plan({
      type: 'request_update',
      fieldKey: 'owner',
      message: 'Please update {name} before {due}.',
    });
    expect(s.effects[0]).toMatchObject({
      kind: 'notify',
      notification: 'request',
      userIds: ['u-maria'],
      body: 'Please update Fix guard on press 3 before .',
      post: 'Requested an update from Maria Pereira: Please update Fix guard on press 3 before .',
    });
    expect(plan({ type: 'request_update', fieldKey: 'lead', message: 'x' }).outcome).toBe(
      'skipped',
    );
  });

  it('create_item renders the name, resolves value tokens, copies the owner and asks for a link', () => {
    const s = plan({
      type: 'create_item',
      sheetId: 's-follow',
      groupId: null,
      name: 'Follow-up: {name}',
      values: { due_date: '$in:14', note: 'From {id}' },
      link: true,
    });
    expect(s.summary).toBe('Create "Follow-up: Fix guard on press 3"');
    expect(s.effects).toEqual([
      {
        kind: 'create_item',
        sourceSheetId: 's-ca',
        sourceItemId: 'i-1',
        sheetId: 's-follow',
        groupId: null,
        name: 'Follow-up: Fix guard on press 3',
        values: { due_date: '2026-11-25', note: 'From CA-014' },
        link: true,
        ownerId: 'u-maria',
      },
    ]);
    expect(plan({ type: 'create_item', sheetId: null, name: 'x' }).outcome).toBe('failed');
  });

  it('update_linked out: the linked items, known now; in: found by the runner', () => {
    const out = plan({
      type: 'update_linked',
      path: { direction: 'out', linkFieldKey: 'controls' },
      fieldKey: 'status',
      value: 'opt_wip',
    });
    expect(out.summary).toBe('Set Control status to Working on it on Controls');
    expect(out.effects).toEqual([
      {
        kind: 'update_linked',
        itemId: 'i-1',
        direction: 'out',
        targetIds: ['c-1', 'c-2'],
        fromSheetId: null,
        linkFieldKey: 'controls',
        fieldKey: 'status',
        value: 'opt_wip',
      },
    ]);
    const inbound = plan({
      type: 'update_linked',
      path: { direction: 'in', sheetId: 's-risks', linkFieldKey: 'risks' },
      fieldKey: 'status',
      value: 'opt_done',
    });
    expect(inbound.effects[0]).toMatchObject({
      direction: 'in',
      targetIds: null,
      fromSheetId: 's-risks',
      linkFieldKey: 'risks',
    });
    const none = plan(
      {
        type: 'update_linked',
        path: { direction: 'out', linkFieldKey: 'controls' },
        fieldKey: 'status',
        value: 'opt_wip',
      },
      makeItem({}, { id: 'i-lonely' }),
    );
    expect(none).toMatchObject({ outcome: 'skipped', message: 'No linked items.' });
  });

  it('move_to_group moves, or says no change when already there', () => {
    expect(plan({ type: 'move_to_group', groupId: 'g-closed' })).toMatchObject({
      summary: 'Move to Closed',
      effects: [{ kind: 'move', itemId: 'i-1', groupId: 'g-closed' }],
    });
    expect(plan({ type: 'move_to_group', groupId: 'g-open' }).outcome).toBe('no_change');
    expect(plan({ type: 'move_to_group', groupId: 'g-gone' }).outcome).toBe('failed');
  });

  it('assign adds the person, keeps the others and notifies them', () => {
    const s = plan({ type: 'assign', fieldKey: 'owner', who: 'user:u-james' });
    expect(s.summary).toBe('Assign James Okafor to Owner');
    expect(s.effects[0]).toEqual({
      kind: 'set_values',
      sheetId: 's-ca',
      itemId: 'i-1',
      values: { [f.owner.id]: ['u-maria', 'u-james'] },
    });
    expect(s.effects[1]).toMatchObject({ kind: 'notify', userIds: ['u-james'], post: null });
    expect(plan({ type: 'assign', fieldKey: 'owner', who: 'user:u-maria' }).outcome).toBe(
      'no_change',
    );
    expect(plan({ type: 'assign', fieldKey: 'owner', who: 'actor' }).effects[0]).toMatchObject({
      values: { [f.owner.id]: ['u-maria', 'u-james'] },
    });
  });

  it('assign on a one-person field replaces the person', () => {
    const withLead = makeItem({ [f.lead.id]: ['u-maria'] }, { id: 'i-lead' });
    expect(
      plan({ type: 'assign', fieldKey: 'lead', who: 'user:u-james' }, withLead).effects[0],
    ).toMatchObject({ values: { [f.lead.id]: ['u-james'] } });
  });

  it('lock_item locks unless already locked', () => {
    expect(plan({ type: 'lock_item', reason: 'Approved' })).toMatchObject({
      summary: 'Lock the item: Approved',
      effects: [{ kind: 'lock', itemId: 'i-1', reason: 'Approved' }],
    });
    expect(plan({ type: 'lock_item' }, { ...item, locked: true }).outcome).toBe('no_change');
  });

  it('post_update renders the message; protected fields read Restricted', () => {
    expect(plan({ type: 'post_update', message: 'Checked: {status}, {secret}' }).effects).toEqual([
      { kind: 'post', itemId: 'i-1', body: 'Checked: Working on it, Restricted' },
    ]);
    expect(plan({ type: 'post_update', message: '  ' }).outcome).toBe('skipped');
  });

  it('webhook queues a payload for https URLs only, without protected fields', () => {
    const s = plan({ type: 'webhook', url: 'https://hooks.example.com/x', preset: 'generic' });
    expect(s.summary).toBe('Send a webhook to hooks.example.com');
    const effect = s.effects[0] as { payload: Record<string, unknown> };
    expect(effect.payload).toMatchObject({
      event: 'automation',
      automation: { id: 'a-1', name: 'Done → lock' },
      workspace: 'meridian',
      sheet: { id: 's-ca', name: 'Corrective actions' },
      item: {
        displayId: 'CA-014',
        url: 'https://app.example.com/meridian/s/s-ca?item=CA-014',
      },
      trigger: { type: 'field_becomes', field: 'Status', value: 'Working on it' },
      at: '2026-11-11T12:00:00.000Z',
    });
    const values = (effect.payload.item as { values: Record<string, string> }).values;
    expect(values.status).toBe('Working on it');
    expect('secret' in values).toBe(false);
    expect(plan({ type: 'webhook', url: 'http://insecure.example.com' }).outcome).toBe('failed');
    const teams = plan({ type: 'webhook', url: 'https://x.example.com', preset: 'teams' });
    expect((teams.effects[0] as { payload: Record<string, unknown> }).payload).toMatchObject({
      '@type': 'MessageCard',
      title: 'CA-014 Fix guard on press 3',
    });
    const slack = plan({ type: 'webhook', url: 'https://x.example.com', preset: 'slack' });
    expect((slack.effects[0] as { payload: Record<string, unknown> }).payload).toMatchObject({
      text: 'CA-014 Fix guard on press 3',
    });
  });

  it('raise_version: minor, major, and v1.0 from empty', () => {
    expect(
      plan({ type: 'raise_version', fieldKey: 'version', kind: 'minor' }).effects[0],
    ).toMatchObject({ values: { [f.version.id]: 'v1.3' } });
    expect(plan({ type: 'raise_version', fieldKey: 'version', kind: 'major' }).summary).toBe(
      'Raise Version to v2.0',
    );
    expect(
      plan({ type: 'raise_version', fieldKey: 'version', kind: 'minor' }, makeItem({})).effects[0],
    ).toMatchObject({ values: { [f.version.id]: 'v1.0' } });
    expect(plan({ type: 'raise_version', fieldKey: 'status', kind: 'minor' }).outcome).toBe(
      'failed',
    );
  });

  it('unknown actions fail without stopping the others', () => {
    const steps = planActions(
      [{ type: 'teleport' } as ActionJson, { type: 'lock_item' } as ActionJson],
      item,
      null,
      ctx,
      env(),
    );
    expect(steps[0]).toMatchObject({ outcome: 'failed', message: 'This action is not supported.' });
    expect(steps[1]!.effects).toHaveLength(1);
  });
});
