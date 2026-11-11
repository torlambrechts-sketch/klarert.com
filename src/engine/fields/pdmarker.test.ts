import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { hasSpecialCategory, pdmarker, PD_CATEGORIES } from './pdmarker';

describe('pdmarker', () => {
  contract(pdmarker, {
    valid: [
      [
        ['identity', 'health'],
        ['identity', 'health'],
      ],
      [
        ['health', 'Identity', 'identity'],
        ['identity', 'health'],
      ],
      ['Contact details, criminal', ['contact', 'criminal']],
    ],
    invalid: [[], '', null, ['identity', 'shoe size'], 3],
    parse: [
      ['Identity; Health', ['identity', 'health']],
      ['["union","beliefs"]', ['beliefs', 'union']],
      ['Religion or beliefs\nBiometric', ['biometric', 'beliefs']],
    ],
    text: [[['identity', 'union'], 'Identity, Trade union membership']],
    number: [[['identity', 'health'], 2]],
    order: [['contact'], ['identity']],
    empty: [
      [[], true],
      [['images'], false],
    ],
  });

  it('flags special categories', () => {
    expect(PD_CATEGORIES.filter((c) => c.special).map((c) => c.id)).toEqual([
      'health',
      'biometric',
      'beliefs',
      'union',
      'criminal',
    ]);
    expect(PD_CATEGORIES).toHaveLength(12);
    expect(hasSpecialCategory(['identity', 'health'])).toBe(true);
    expect(hasSpecialCategory(['identity'])).toBe(false);
    const opts = pdmarker.options!({}, makeCtx());
    expect(opts.find((o) => o.id === 'criminal')?.color).toBe('red');
    expect(opts.find((o) => o.id === 'identity')?.color).toBe('blue');
  });
});
