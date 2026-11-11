import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { dropdown } from './dropdown';

describe('dropdown', () => {
  contract(dropdown, {
    valid: [
      ['opt_1', 'opt_1'],
      ['Option 2', 'opt_2'],
      [' option 3 ', 'opt_3'],
    ],
    invalid: ['Option 4', 3, null, ''],
    parse: [
      ['Option 1', 'opt_1'],
      ['OPTION 2', 'opt_2'],
      ['opt_3', 'opt_3'],
      ['', null],
    ],
    text: [
      ['opt_2', 'Option 2'],
      ['opt_gone', ''],
    ],
    number: [['opt_1', null]],
    date: [['opt_1', null]],
    order: ['opt_1', 'opt_3'],
    empty: [
      ['', true],
      ['opt_1', false],
    ],
    done: [
      ['opt_1', false],
      [null, false],
    ],
  });

  it('has three distinct default options and is not ordered', () => {
    const cfg = dropdown.defaultConfig();
    expect(cfg.options.map((o) => o.id)).toEqual(['opt_1', 'opt_2', 'opt_3']);
    expect(new Set(cfg.options.map((o) => o.color)).size).toBe(3);
    expect(dropdown.kind).toBe('option');
    expect(dropdown.rank).toBeUndefined();
    expect(dropdown.triggers).toContain('field_becomes');
  });

  it('keeps the stored id when an option is renamed', () => {
    const cfg = dropdown.defaultConfig();
    cfg.options[0]!.label = 'Supplier';
    expect(dropdown.toText('opt_1', cfg, makeCtx())).toBe('Supplier');
    expect(dropdown.normalize('Supplier', cfg, makeCtx())).toBe('opt_1');
  });
});
