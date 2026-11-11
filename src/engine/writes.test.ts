import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import './fields/registry';
import { makeCtx, makeField, makeItem } from './testing/fixtures';
import { checkCreate, checkWrite, defaultValues, planValues, resolveDefaultToken } from './writes';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const status = makeField(
  'status',
  {
    options: [
      { id: 'opt_todo', label: 'Not started', color: 'grey' },
      { id: 'opt_stuck', label: 'Stuck', color: 'red' },
      { id: 'opt_done', label: 'Done', color: 'green', done: true },
    ],
  },
  { key: 'status', name: 'Status' },
);
const cause = makeField('text', {}, { key: 'root_cause', name: 'Root cause' });
const owner = makeField(
  'people',
  { multiple: true },
  { key: 'owner', name: 'Owner', required: true },
);
const sig = makeField(
  'signature',
  { meaning: 'Approved', clearOnChange: true },
  { key: 'sign', name: 'Sign-off' },
);
const files = makeField(
  'evidence',
  { validDays: 365, multiple: true, accept: [] },
  { key: 'evidence' },
);
status.rules = [
  {
    id: 'r1',
    whenFieldKey: 'status',
    whenValues: ['opt_done'],
    require: ['root_cause'],
    message: 'Add the root cause before closing.',
  },
  { id: 'r2', whenFieldKey: 'status', whenValues: ['opt_stuck'], requireComment: true },
];
const fields = [status, cause, owner, sig, files];
const ctx = makeCtx({ fields });

describe('planValues', () => {
  it('normalises inputs and returns only real changes', () => {
    const item = makeItem({ [status.id]: 'opt_todo' });
    const p = planValues(
      item,
      fields,
      { [status.id]: 'Done', [owner.id]: 'me', [cause.id]: '' },
      ctx,
      sha,
    );
    expect(p.patch).toEqual({ [status.id]: 'opt_done', [owner.id]: ['u-maria'] });
    expect(p.changedKeys).toEqual(['status', 'owner']);
    expect(p.next.values[status.id]).toBe('opt_done');
  });

  it('rejects inputs that do not normalise and non-value fields', () => {
    const p = planValues(
      makeItem(),
      fields,
      { [status.id]: 'Maybe', [files.id]: 'x.pdf', nope: 1 },
      ctx,
      sha,
    );
    expect(p.patch).toEqual({});
    expect(p.rejected.map((r) => r.fieldId)).toEqual([status.id, files.id, 'nope']);
  });

  it('stamps a signature with the caller, the clock and the hash of the other values', () => {
    const item = makeItem({ [cause.id]: 'Guard missing' });
    const p = planValues(
      item,
      fields,
      {
        [sig.id]: {
          by: 'u-james',
          at: '2020-01-01T00:00:00Z',
          meaning: 'Approved',
          hash: '0'.repeat(64),
        },
      },
      ctx,
      sha,
    );
    expect(p.patch[sig.id]).toEqual({
      by: 'u-maria',
      at: '2026-11-11T12:00:00.000Z',
      meaning: 'Approved',
      hash: sha(JSON.stringify({ [cause.id]: 'Guard missing' })),
    });
  });

  it('clears a signature when another value changes (clearOnChange)', () => {
    const signed = {
      by: 'u-maria',
      at: '2026-11-01T00:00:00Z',
      meaning: 'Approved',
      hash: 'a'.repeat(64),
    };
    const item = makeItem({ [sig.id]: signed, [cause.id]: 'x' });
    const p = planValues(item, fields, { [cause.id]: 'y' }, ctx, sha);
    expect(p.patch).toEqual({ [cause.id]: 'y', [sig.id]: null });
    expect(p.changedKeys).toEqual(['root_cause', 'sign']);
  });
});

describe('checkWrite', () => {
  it('blocks a status rule until the required field is filled', () => {
    const item = makeItem({ [status.id]: 'opt_todo', [owner.id]: ['u-maria'] });
    const p = planValues(item, fields, { [status.id]: 'opt_done' }, ctx, sha);
    const c = checkWrite(item, p.next, fields, p.changedKeys, ctx);
    expect(c.blocking.map((i) => i.message)).toEqual(['Add the root cause before closing.']);
    const filled = makeItem({ ...item.values, [cause.id]: 'Worn guard' });
    const p2 = planValues(filled, fields, { [status.id]: 'opt_done' }, ctx, sha);
    expect(checkWrite(filled, p2.next, fields, p2.changedKeys, ctx).blocking).toEqual([]);
  });

  it('asks for a comment, except for automations', () => {
    const item = makeItem({ [owner.id]: ['u-maria'] });
    const p = planValues(item, fields, { [status.id]: 'opt_stuck' }, ctx, sha);
    expect(
      checkWrite(item, p.next, fields, p.changedKeys, ctx).commentRequired.map((r) => r.id),
    ).toEqual(['r2']);
    expect(
      checkWrite(item, p.next, fields, p.changedKeys, ctx, { automation: true }).commentRequired,
    ).toEqual([]);
  });

  it('does not block on an unrelated empty required field, but blocks clearing it', () => {
    const item = makeItem({});
    const p = planValues(item, fields, { [cause.id]: 'x' }, ctx, sha);
    expect(checkWrite(item, p.next, fields, p.changedKeys, ctx).blocking).toEqual([]);
    const full = makeItem({ [owner.id]: ['u-maria'] });
    const p2 = planValues(full, fields, { [owner.id]: null }, ctx, sha);
    expect(
      checkWrite(full, p2.next, fields, p2.changedKeys, ctx).blocking.map((i) => i.code),
    ).toEqual(['required']);
  });

  it('blocks a duplicate unique value', () => {
    const code = makeField('text', {}, { key: 'code', name: 'Code', validation: { unique: true } });
    const item = makeItem({});
    const p = planValues(item, [code], { [code.id]: 'A1' }, ctx, sha);
    const c = checkWrite(item, p.next, [code], p.changedKeys, ctx, { isUnique: () => false });
    expect(c.blocking.map((i) => i.code)).toEqual(['unique']);
  });

  it('checkCreate ignores empty required fields', () => {
    const item = makeItem({ [cause.id]: 'x' });
    expect(checkCreate(item, fields, ctx).blocking).toEqual([]);
  });
});

describe('defaults', () => {
  it('resolves today, me and in N days', () => {
    expect(resolveDefaultToken('today', ctx)).toBe('2026-11-11');
    expect(resolveDefaultToken('me', ctx)).toBe('u-maria');
    expect(resolveDefaultToken('in 3 days', ctx)).toBe('2026-11-14');
    expect(resolveDefaultToken('Open', ctx)).toBe('Open');
  });
  it('normalises config.default for value fields', () => {
    const d = makeField('date', { relative: true, default: 'in 7 days' } as never);
    const o = makeField('people', { multiple: true, default: 'me' } as never);
    const s = makeField('status', { ...status.config, default: 'Stuck' } as never);
    expect(defaultValues([d, o, s, files], ctx)).toEqual({
      [d.id]: '2026-11-18',
      [o.id]: ['u-maria'],
      [s.id]: 'opt_stuck',
    });
  });
});
