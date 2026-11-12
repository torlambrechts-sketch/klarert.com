import { describe, expect, it } from 'vitest';
import {
  bulkSummary,
  ChainGuard,
  MAX_DEPTH,
  runMessage,
  runStatus,
  stepLine,
  TIME_BUDGET_MS,
  type Step,
} from '.';

const step = (outcome: Step['outcome'], summary = 'Do it', message = ''): Step => ({
  action: 'set_field',
  summary,
  outcome,
  message,
});

describe('ChainGuard', () => {
  it('stops chains deeper than 3', () => {
    const g = new ChainGuard(() => 0);
    expect(MAX_DEPTH).toBe(3);
    expect(g.tooDeep(0)).toBe(false);
    expect(g.tooDeep(3)).toBe(false);
    expect(g.tooDeep(4)).toBe(true);
  });

  it('lets an automation run once per item per chain', () => {
    const g = new ChainGuard(() => 0);
    expect(g.enter('a-1', 'i-1')).toBe(true);
    expect(g.enter('a-1', 'i-1')).toBe(false);
    expect(g.enter('a-1', 'i-2')).toBe(true);
    expect(g.enter('a-2', 'i-1')).toBe(true);
  });

  it('measures the 5 s budget with the injected clock', () => {
    let now = 1000;
    const g = new ChainGuard(() => now);
    expect(TIME_BUDGET_MS).toBe(5000);
    now = 6000;
    expect(g.overBudget()).toBe(false);
    now = 6001;
    expect(g.overBudget()).toBe(true);
    expect(g.elapsed()).toBe(5001);
  });
});

describe('runStatus', () => {
  it('done, partial, failed', () => {
    expect(runStatus([step('done'), step('no_change'), step('skipped')])).toBe('done');
    expect(runStatus([step('done'), step('blocked')])).toBe('partial');
    expect(runStatus([step('failed'), step('skipped')])).toBe('failed');
    expect(runStatus([])).toBe('done');
  });
});

describe('messages', () => {
  it('lists the steps for the toast', () => {
    expect(stepLine(step('done', 'Set Status to Done'))).toBe('Set Status to Done');
    expect(stepLine(step('done', 'Create "Follow-up"', 'FU-003'))).toBe(
      'Create "Follow-up" (FU-003)',
    );
    expect(stepLine(step('blocked', 'Set Status to Done', 'Fill in Root cause first.'))).toBe(
      'Set Status to Done (blocked: Fill in Root cause first)',
    );
    expect(
      runMessage('Approve', 'partial', [
        step('done', 'Lock the item'),
        step('skipped', 'Notify', 'No one to notify.'),
      ]),
    ).toBe('Approve: Lock the item · Notify (skipped: No one to notify)');
    expect(runMessage('Ping', 'stopped', [], 'Loop guard: chain deeper than 3')).toBe(
      'Ping stopped. Loop guard: chain deeper than 3.',
    );
  });

  it('summarises bulk runs', () => {
    expect(bulkSummary([])).toBeNull();
    expect(bulkSummary([{ automationId: 'a' }])).toBe('1 automation ran once');
    expect(bulkSummary([{ automationId: 'a' }, { automationId: 'b' }, { automationId: 'a' }])).toBe(
      '2 automations ran 3 times',
    );
  });
});
