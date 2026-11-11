import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { severity } from './severity';

describe('severity', () => {
  contract(severity, {
    valid: [
      ['opt_low', 'opt_low'],
      ['High', 'opt_high'],
      ['  critical ', 'opt_critical'],
    ],
    invalid: ['Unknown', 2, null, ''],
    parse: [
      ['Medium', 'opt_medium'],
      ['CRITICAL', 'opt_critical'],
      ['opt_low', 'opt_low'],
      ['', null],
    ],
    text: [
      ['opt_high', 'High'],
      ['opt_gone', ''],
    ],
    number: [
      ['opt_low', 0],
      ['opt_critical', 3],
      ['opt_gone', null],
    ],
    date: [['opt_medium', null]],
    order: ['opt_medium', 'opt_high'],
    empty: [
      ['', true],
      ['opt_low', false],
    ],
    done: [
      ['opt_critical', false],
      [null, false],
    ],
  });

  it('is ordered: rank follows option order and supports at least', () => {
    const cfg = severity.defaultConfig();
    expect(severity.kind).toBe('ordered');
    expect(cfg.options.map((o) => o.label)).toEqual(['Low', 'Medium', 'High', 'Critical']);
    expect(severity.rank?.('opt_low', cfg)).toBe(0);
    expect(severity.rank?.('opt_critical', cfg)).toBe(3);
    expect(severity.rank?.(null, cfg)).toBeNull();
    const atLeast = (v: string, min: string) =>
      (severity.rank?.(v, cfg) ?? -1) >= (severity.rank?.(min, cfg) ?? Infinity);
    expect(atLeast('opt_critical', 'opt_high')).toBe(true);
    expect(atLeast('opt_medium', 'opt_high')).toBe(false);
  });

  it('ranks by the configured order after options are reordered', () => {
    const cfg = severity.defaultConfig();
    cfg.options.reverse();
    expect(severity.rank?.('opt_low', cfg)).toBe(3);
    expect(severity.toText('opt_low', cfg, makeCtx())).toBe('Low');
    expect(severity.kanbanCapable).toBe(true);
    expect(severity.triggers).toEqual(['field_changed', 'field_becomes']);
  });
});
