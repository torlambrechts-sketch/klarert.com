import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import type { Json } from '../types';
import { clock, clockState, type ClockValue } from './clock';
import { date } from './date';
import { installFieldTypes } from './resolve';

const running: ClockValue = {
  state: 'running',
  start: '2026-11-11T10:00:00.000Z',
  deadline: '2026-11-14T10:00:00.000Z',
  stoppedAt: null,
  hoursLeft: 70,
};
const warning: ClockValue = {
  ...running,
  state: 'warning',
  deadline: '2026-11-12T00:00:00.000Z',
  hoursLeft: 12,
};
const notStarted: ClockValue = {
  state: 'not_started',
  start: null,
  deadline: null,
  stoppedAt: null,
  hoursLeft: null,
};

// Minimal checkbox stand-in: filled when true, no date.
const check = { ...date, id: 'check', isEmpty: (v: unknown) => v !== true, toDate: () => null };
installFieldTypes([date, check]);

const startDate = makeField('date', { relative: false }, { key: 'aware_date', id: 'f-aware-date' });
const startAt = makeField('datetime', {}, { key: 'aware_at', id: 'f-aware-at' });
const stopDate = makeField('date', { relative: false }, { key: 'notified_on', id: 'f-notified' });
const stopCheck = makeField('check', {}, { key: 'notified', id: 'f-notified-check' });
const ctx = makeCtx({ fields: [startDate, startAt, stopDate, stopCheck] });

const clockField = (
  over: Partial<{ startFieldKey: string; stopFieldKey: string; hours: number }> = {},
) =>
  makeField('clock', {
    startFieldKey: 'aware_at',
    stopFieldKey: 'notified_on',
    hours: 72,
    ...over,
  });
const state = (values: Record<string, Json>, over = {}) =>
  clockState(makeItem(values), clockField(over), ctx);

describe('clock', () => {
  contract(clock, {
    valid: [
      [running, running],
      [warning, warning],
      [notStarted, notStarted],
    ],
    invalid: [null, 'Running', { state: 'later' }, 72],
    parse: [
      [JSON.stringify(running), running],
      ['3 days left', null],
      ['', null],
    ],
    text: [
      [running, '3 days left'],
      [warning, '12 h left'],
      [notStarted, 'Not started'],
    ],
    number: [[running, null]],
    date: [
      [running, '2026-11-14'],
      [notStarted, null],
    ],
    order: [warning, running],
    empty: [
      [notStarted, true],
      [running, false],
    ],
  });

  describe('states at an injected now (11 Nov 2026 12:00 UTC)', () => {
    it('is not started without a start value', () => {
      expect(state({}).state).toBe('not_started');
      expect(clock.toText(state({}), clockField().config, ctx)).toBe('Not started');
    });

    it('runs, warns with less than a third left, then goes overdue', () => {
      const run = state({ 'f-aware-at': '2026-11-11T10:00:00Z' });
      expect(run).toMatchObject({
        state: 'running',
        deadline: '2026-11-14T10:00:00.000Z',
        hoursLeft: 70,
      });
      const warn = state({ 'f-aware-at': '2026-11-09T00:00:00Z' });
      expect(warn).toMatchObject({ state: 'warning', hoursLeft: 12 });
      const over = state({ 'f-aware-at': '2026-11-07T12:00:00Z' });
      expect(over).toMatchObject({ state: 'overdue', hoursLeft: -24 });
      expect(clock.toText(over, clockField().config, ctx)).toBe('Overdue 24 h');
    });

    it('is met or missed once the stop field is filled', () => {
      const start = { 'f-aware-at': '2026-11-07T12:00:00Z' };
      expect(state({ ...start, 'f-notified': '2026-11-09' }).state).toBe('met');
      const missed = state({ ...start, 'f-notified': '2026-11-11' });
      expect(missed.state).toBe('missed');
      expect(clock.toText(missed, clockField().config, ctx)).toBe('Missed by 12 h');
      expect(
        state({ ...start, 'f-notified-check': true }, { stopFieldKey: 'notified' }).state,
      ).toBe('met');
      expect(
        state({ ...start, 'f-notified-check': false }, { stopFieldKey: 'notified' }).state,
      ).toBe('overdue');
    });

    it('starts a date-only start field at local midnight', () => {
      const s = state({ 'f-aware-date': '2026-11-10' }, { startFieldKey: 'aware_date' });
      expect(s.deadline).toBe('2026-11-13T00:00:00.000Z');
      expect(clock.toDate(s, clockField().config, ctx)).toBe('2026-11-13');
      const summer = clockState(
        makeItem({ 'f-aware-date': '2026-07-01' }),
        clockField({ startFieldKey: 'aware_date' }),
        makeCtx({ fields: [startDate] }, { now: new Date('2026-07-01T12:00:00Z') }),
      );
      expect(summer.start).toBe('2026-06-30T23:00:00.000Z');
      expect(summer.state).toBe('running');
    });

    it('computes through compute()', () => {
      const item = makeItem({ 'f-aware-at': '2026-11-11T10:00:00Z' });
      expect(clock.compute!(item, clockField(), ctx)?.state).toBe('running');
    });
  });
});
