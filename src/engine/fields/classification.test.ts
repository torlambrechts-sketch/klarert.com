import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { classification } from './classification';

describe('classification', () => {
  contract(classification, {
    valid: [
      ['opt_public', 'opt_public'],
      ['Confidential', 'opt_confidential'],
      ['  restricted ', 'opt_restricted'],
    ],
    invalid: ['Unknown', 2, null, ''],
    parse: [
      ['Internal', 'opt_internal'],
      ['RESTRICTED', 'opt_restricted'],
      ['opt_public', 'opt_public'],
      ['', null],
    ],
    text: [
      ['opt_confidential', 'Confidential'],
      ['opt_gone', ''],
    ],
    number: [
      ['opt_public', 0],
      ['opt_restricted', 3],
      ['opt_gone', null],
    ],
    date: [['opt_internal', null]],
    order: ['opt_internal', 'opt_confidential'],
    empty: [
      ['', true],
      ['opt_public', false],
    ],
    done: [
      ['opt_restricted', false],
      [null, false],
    ],
  });

  it('is ordered: rank follows option order and supports at least', () => {
    const cfg = classification.defaultConfig();
    expect(classification.kind).toBe('ordered');
    expect(cfg.options.map((o) => o.label)).toEqual([
      'Public',
      'Internal',
      'Confidential',
      'Restricted',
    ]);
    expect(classification.rank?.('opt_public', cfg)).toBe(0);
    expect(classification.rank?.('opt_restricted', cfg)).toBe(3);
    expect(classification.rank?.(null, cfg)).toBeNull();
    const atLeast = (v: string, min: string) =>
      (classification.rank?.(v, cfg) ?? -1) >= (classification.rank?.(min, cfg) ?? Infinity);
    expect(atLeast('opt_restricted', 'opt_confidential')).toBe(true);
    expect(atLeast('opt_internal', 'opt_confidential')).toBe(false);
  });

  it('ranks by the configured order after options are reordered', () => {
    const cfg = classification.defaultConfig();
    cfg.options.reverse();
    expect(classification.rank?.('opt_public', cfg)).toBe(3);
    expect(classification.toText('opt_public', cfg, makeCtx())).toBe('Public');
    expect(classification.kanbanCapable).toBe(true);
    expect(classification.triggers).toEqual(['field_changed', 'field_becomes']);
  });
});
