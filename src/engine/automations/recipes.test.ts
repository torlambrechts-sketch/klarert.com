import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { makeCtx, makeField } from '../testing/fixtures';
import {
  applyRecipe,
  defaultMapping,
  draftProblems,
  recipeSource,
  roleCandidates,
  unfillableRoles,
  type Recipe,
} from '.';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const status = makeField('status', FIELD_TYPES.status.defaultConfig(), {
  key: 'state',
  name: 'State',
  position: 'a0',
});
const owner = makeField(
  'people',
  { multiple: true },
  { key: 'owner', name: 'Owner', position: 'a1' },
);
const reviewer = makeField(
  'people',
  { multiple: true },
  { key: 'reviewer', name: 'Reviewer', position: 'a2' },
);
const due = makeField('date', { relative: false }, { key: 'due', name: 'Due', position: 'a3' });
const ctx = makeCtx({ fields: [status, owner, reviewer, due] });

const statusNotify: Recipe = {
  id: 'status-notify',
  title: 'When status changes to something, notify someone',
  roles: { status: ['status'], person: ['people'] },
  trigger: { type: 'field_becomes', fieldKey: '{status}', value: null },
  actions: [{ type: 'notify', to: ['field:{person}'], message: '{id} {name} is now {{status}}.' }],
};

const dueRequest: Recipe = {
  id: 'due-request',
  title: 'When a date arrives, ask the owner for an update',
  roles: { date: ['date', 'datetime'], person: ['people'], status: ['status'] },
  trigger: { type: 'date_arrives', fieldKey: '{date}', offsetDays: -3 },
  conditions: [{ fieldKey: '{status}', op: 'is_not_done' }],
  actions: [
    {
      type: 'request_update',
      fieldKey: '{person}',
      message: '{name} is due on {{date}}. Please update it.',
    },
  ],
};

describe('recipe role mapping', () => {
  it('lists the fields that fit each role', () => {
    const c = roleCandidates(statusNotify, ctx);
    expect(c.status!.map((f) => f.key)).toEqual(['state']);
    expect(c.person!.map((f) => f.key)).toEqual(['owner', 'reviewer']);
  });

  it('maps every role to the first fitting field', () => {
    expect(defaultMapping(dueRequest, ctx)).toEqual({
      date: 'due',
      person: 'owner',
      status: 'state',
    });
  });

  it('replaces roles in keys, recipients and messages', () => {
    const d = applyRecipe(statusNotify, { status: 'state', person: 'reviewer' });
    expect(d.trigger).toEqual({ type: 'field_becomes', fieldKey: 'state', value: null });
    expect(d.actions).toEqual([
      { type: 'notify', to: ['field:reviewer'], message: '{id} {name} is now {state}.' },
    ]);
    const r = applyRecipe(dueRequest, defaultMapping(dueRequest, ctx));
    expect(r.conditions).toEqual([{ fieldKey: 'state', op: 'is_not_done' }]);
    expect(r.actions[0]).toEqual({
      type: 'request_update',
      fieldKey: 'owner',
      message: '{name} is due on {due}. Please update it.',
    });
  });

  it('does not re-replace a key that has the same name as a role', () => {
    const d = applyRecipe(statusNotify, { status: 'status', person: 'owner' });
    expect(d.actions[0]!.message).toBe('{id} {name} is now {status}.');
  });

  it('leaves unmapped roles empty so the builder asks for them', () => {
    const d = applyRecipe(statusNotify, { status: null, person: null });
    expect(d.trigger.fieldKey).toBeNull();
    expect(d.actions[0]!.to).toEqual([]);
    const p = draftProblems(d, ctx);
    expect(p.trigger).toBe('Choose a field.');
    expect(p['actions.0']).toBe('Choose who to notify.');
  });

  it('needs the null values filled before saving', () => {
    const d = applyRecipe(statusNotify, defaultMapping(statusNotify, ctx));
    expect(draftProblems(d, ctx).trigger).toBe('Choose a value.');
    d.trigger.value = 'opt_done';
    expect(draftProblems(d, ctx)).toEqual({});
  });

  it('names roles the sheet cannot fill', () => {
    expect(unfillableRoles({ ...statusNotify, roles: { button: ['button'] } }, ctx)).toEqual([
      'button',
    ]);
  });

  it('records the recipe as the source', () => {
    expect(recipeSource('done-lock')).toBe('template:done-lock');
  });
});
