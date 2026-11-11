import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { multiselect } from './multiselect';

describe('multiselect', () => {
  contract(multiselect, {
    valid: [
      [['opt_2'], ['opt_2']],
      [
        ['opt_3', 'Option 1', 'opt_3'],
        ['opt_1', 'opt_3'],
      ],
      ['Option 2, option 1', ['opt_1', 'opt_2']],
      [['opt_1', 'Unknown'], ['opt_1']],
    ],
    invalid: [[], ['Unknown'], 'Unknown', '', null, 7, { opt_1: true }],
    parse: [
      ['Option 1; Option 3', ['opt_1', 'opt_3']],
      ['Option 2\nOption 1', ['opt_1', 'opt_2']],
      ['["opt_3","opt_2"]', ['opt_2', 'opt_3']],
      ['', null],
    ],
    text: [
      [['opt_1', 'opt_3'], 'Option 1, Option 3'],
      [['opt_gone', 'opt_2'], 'Option 2'],
      [[], ''],
    ],
    number: [[['opt_1'], null]],
    date: [[['opt_1'], null]],
    order: [['opt_1', 'opt_2'], ['opt_2']],
    empty: [
      [[], true],
      [['opt_1'], false],
    ],
  });

  it('orders by first option, then by count', () => {
    const cfg = multiselect.defaultConfig();
    const ctx = makeCtx();
    expect(multiselect.compare(['opt_1'], ['opt_1', 'opt_2'], cfg, ctx)).toBeLessThan(0);
    expect(multiselect.compare(['opt_3'], ['opt_1', 'opt_3'], cfg, ctx)).toBeGreaterThan(0);
    expect(multiselect.compare([], ['opt_3'], cfg, ctx)).toBeGreaterThan(0);
  });

  it('matches a label that contains a comma as one option', () => {
    const cfg = {
      options: [
        { id: 'opt_a', label: 'Health, safety', color: 'red' },
        { id: 'opt_b', label: 'Quality', color: 'blue' },
      ],
    };
    const ctx = makeCtx();
    expect(multiselect.parseText('Health, safety', cfg, ctx)).toEqual(['opt_a']);
    expect(multiselect.parseText('Quality, Health', cfg, ctx)).toEqual(['opt_b']);
    expect(multiselect.kind).toBe('multi');
    expect(multiselect.triggers).toContain('field_becomes');
  });
});
