import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { makeCtx, makeField, makeFile, makeItem, NOW } from '../testing/fixtures';
import type { Automation, Json } from '../types';
import {
  isDue,
  planFirings,
  SCHEDULE_WINDOW_MS,
  scheduledMoment,
  type ScheduledAutomation,
} from './schedule';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const DAY = 86_400_000;
const f = {
  due: makeField('date', { relative: false }, { key: 'due', id: 'f-due' }),
  aware: makeField('datetime', {}, { key: 'aware_at', id: 'f-aware' }),
  notified: makeField('date', { relative: false }, { key: 'notified_on', id: 'f-notified' }),
  clock: makeField(
    'clock',
    { startFieldKey: 'aware_at', stopFieldKey: 'notified_on', hours: 72 },
    { key: 'clock', id: 'f-clock' },
  ),
  evidence: makeField(
    'evidence',
    { validDays: 365, multiple: true, accept: [] },
    { key: 'evidence', id: 'f-ev' },
  ),
  status: makeField('status', FIELD_TYPES.status.defaultConfig(), {
    key: 'status',
    id: 'f-status',
  }),
};
const fields = Object.values(f);

const trig = (type: Automation['trigger']['type'], extra: Record<string, Json> = {}) =>
  ({ type, ...extra }) as Automation['trigger'];

// fixtures: NOW = 2026-11-11T12:00:00Z, Europe/London (UTC+0 in November)
describe('scheduledMoment', () => {
  it('date_arrives: the date plus offsetDays at midnight in the workspace time zone', () => {
    const ctx = makeCtx({ fields });
    const item = makeItem({ 'f-due': '2026-12-11' });
    expect(
      scheduledMoment(trig('date_arrives', { fieldKey: 'due', offsetDays: -30 }), item, ctx),
    ).toEqual({ at: Date.parse('2026-11-11T00:00:00Z'), occurrence: '2026-12-11' });
    expect(scheduledMoment(trig('date_arrives', { fieldKey: 'due' }), item, ctx)?.at).toBe(
      Date.parse('2026-12-11T00:00:00Z'),
    );
  });

  it('uses the workspace time zone for midnight', () => {
    const ctx = makeCtx({ fields }, { timeZone: 'Europe/Berlin' });
    const item = makeItem({ 'f-due': '2026-11-11' });
    expect(scheduledMoment(trig('date_arrives', { fieldKey: 'due' }), item, ctx)?.at).toBe(
      Date.parse('2026-11-10T23:00:00Z'),
    );
  });

  it('date_arrives: nothing for an empty date or an unknown field', () => {
    const ctx = makeCtx({ fields });
    expect(scheduledMoment(trig('date_arrives', { fieldKey: 'due' }), makeItem(), ctx)).toBeNull();
    expect(
      scheduledMoment(
        trig('date_arrives', { fieldKey: 'gone' }),
        makeItem({ 'f-due': '2026-11-11' }),
        ctx,
      ),
    ).toBeNull();
  });

  it('clock_warning: the deadline minus hoursLeft; occurrence is the deadline', () => {
    const ctx = makeCtx({ fields });
    const item = makeItem({ 'f-aware': '2026-11-10T00:00:00.000Z' });
    expect(
      scheduledMoment(trig('clock_warning', { fieldKey: 'clock', hoursLeft: 24 }), item, ctx),
    ).toEqual({
      at: Date.parse('2026-11-12T00:00:00Z'),
      occurrence: '2026-11-13T00:00:00.000Z',
    });
  });

  it('clock_warning: a stopped or unstarted clock never warns', () => {
    const ctx = makeCtx({ fields });
    const t = trig('clock_warning', { fieldKey: 'clock', hoursLeft: 24 });
    expect(scheduledMoment(t, makeItem(), ctx)).toBeNull();
    expect(
      scheduledMoment(
        t,
        makeItem({ 'f-aware': '2026-11-10T00:00:00.000Z', 'f-notified': '2026-11-11' }),
        ctx,
      ),
    ).toBeNull();
  });

  it('evidence_expiring: the earliest valid_until minus days', () => {
    const item = makeItem({}, { id: 'i-ev' });
    const ctx = makeCtx({
      fields,
      files: [
        makeFile({ itemId: 'i-ev', fieldId: 'f-ev', validUntil: '2027-01-10' }),
        makeFile({ itemId: 'i-ev', fieldId: 'f-ev', validUntil: '2026-12-11' }),
        makeFile({
          itemId: 'i-ev',
          fieldId: 'f-ev',
          validUntil: '2026-11-12',
          replacedBy: 'newer',
        }),
      ],
    });
    expect(
      scheduledMoment(trig('evidence_expiring', { fieldKey: 'evidence', days: 30 }), item, ctx),
    ).toEqual({ at: Date.parse('2026-11-11T00:00:00Z'), occurrence: '2026-12-11' });
    expect(
      scheduledMoment(
        trig('evidence_expiring', { fieldKey: 'evidence', days: 30 }),
        makeItem({}, { id: 'none' }),
        ctx,
      ),
    ).toBeNull();
  });

  it("evidence_expiring with source item_files: the item's Files tab, no field", () => {
    const item = makeItem({}, { id: 'i-if' });
    const ctx = makeCtx({
      fields,
      files: [
        makeFile({ itemId: 'i-if', fieldId: null, validUntil: '2027-03-01' }),
        makeFile({ itemId: 'i-if', fieldId: null, validUntil: '2026-12-11' }),
        // a field's evidence does not count for the item files source
        makeFile({ itemId: 'i-if', fieldId: 'f-ev', validUntil: '2026-11-20' }),
      ],
    });
    const t = trig('evidence_expiring', { source: 'item_files', fieldKey: null, days: 30 });
    expect(scheduledMoment(t, item, ctx)).toEqual({
      at: Date.parse('2026-11-11T00:00:00Z'),
      occurrence: '2026-12-11',
    });
    expect(scheduledMoment(t, makeItem({}, { id: 'none' }), ctx)).toBeNull();
    // the field source ignores item files
    expect(
      scheduledMoment(trig('evidence_expiring', { fieldKey: 'evidence', days: 30 }), item, ctx)
        ?.occurrence,
    ).toBe('2026-11-20');
  });
});

describe('isDue: passed and within the last 7 days', () => {
  const now = NOW.getTime();
  it.each([
    ['in the future', now + 1, false],
    ['exactly now', now, true],
    ['an hour ago', now - 3_600_000, true],
    ['exactly 7 days ago', now - SCHEDULE_WINDOW_MS, true],
    ['8 days ago', now - 8 * DAY, false],
  ])('%s', (_label, at, due) => {
    expect(isDue(at, now)).toBe(due);
  });
});

describe('planFirings', () => {
  const auto = (over: Partial<ScheduledAutomation> = {}): ScheduledAutomation => ({
    id: 'a-1',
    sheetId: 's-ca',
    trigger: trig('date_arrives', { fieldKey: 'due', offsetDays: -30 }),
    conditions: [],
    ...over,
  });

  it('fires items whose moment is due, with the date as the occurrence', () => {
    const due = makeItem({ 'f-due': '2026-12-11' }, { id: 'i-due' });
    const later = makeItem({ 'f-due': '2026-12-20' }, { id: 'i-later' });
    const old = makeItem({ 'f-due': '2026-11-20' }, { id: 'i-old' }); // moment 21 Oct: history
    const archived = makeItem(
      { 'f-due': '2026-12-11' },
      { id: 'i-arch', archivedAt: '2026-11-01T00:00:00Z' },
    );
    const ctx = makeCtx({ fields, items: [due, later, old, archived] });
    expect(planFirings([auto()], [due, later, old, archived], ctx, () => false)).toEqual([
      {
        automationId: 'a-1',
        sheetId: 's-ca',
        itemId: 'i-due',
        occurrence: '2026-12-11',
        at: '2026-11-11T00:00:00.000Z',
      },
    ]);
  });

  it('skips paused items, items whose conditions are false, and other triggers', () => {
    const a = makeItem({ 'f-due': '2026-12-10', 'f-status': 'opt_done' }, { id: 'i-a' });
    const b = makeItem({ 'f-due': '2026-12-10' }, { id: 'i-b' });
    const c = makeItem({ 'f-due': '2026-12-10' }, { id: 'i-c' });
    const ctx = makeCtx({ fields, items: [a, b, c] });
    const doneOpt = (f.status.config as { options: { id: string; done?: boolean }[] }).options.find(
      (o) => o.done,
    )!.id;
    a.values['f-status'] = doneOpt;
    const notDone = auto({ conditions: [{ fieldKey: 'status', op: 'is_not_done' }] });
    const firings = planFirings(
      [notDone, auto({ id: 'a-btn', trigger: trig('button_clicked', { fieldKey: 'due' }) })],
      [a, b, c],
      ctx,
      (automationId, itemId) => automationId === 'a-1' && itemId === 'i-c',
    );
    expect(firings.map((x) => x.itemId)).toEqual(['i-b']);
  });

  it('a changed date is a new occurrence', () => {
    const item = makeItem({ 'f-due': '2026-12-10' }, { id: 'i-x' });
    const ctx = makeCtx({ fields, items: [item] });
    const first = planFirings([auto()], [item], ctx, () => false)[0]!.occurrence;
    item.values['f-due'] = '2026-12-11';
    const second = planFirings([auto()], [item], ctx, () => false)[0]!.occurrence;
    expect([first, second]).toEqual(['2026-12-10', '2026-12-11']);
  });
});
