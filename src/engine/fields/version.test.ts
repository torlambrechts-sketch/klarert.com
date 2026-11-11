import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { raiseVersion, version } from './version';

describe('version', () => {
  contract(version, {
    valid: [
      ['v1.2', 'v1.2'],
      ['1.2', 'v1.2'],
      ['V2', 'v2.0'],
      [3, 'v3.0'],
    ],
    invalid: ['', 'draft', 'v1.2.3', null, -1, 'v'],
    parse: [
      ['v1.10', 'v1.10'],
      ['1.5', 'v1.5'],
      ['Version 4.1', 'v4.1'],
    ],
    text: [['v1.2', 'v1.2']],
    number: [['v1.2', null]],
    order: ['v1.9', 'v1.10'],
    empty: [
      ['', true],
      ['v1.0', false],
    ],
  });

  it('compares numerically', () => {
    const ctx = undefined as never;
    expect(version.compare('v2.0', 'v1.10', {}, ctx)).toBeGreaterThan(0);
    expect(version.compare('v1.10', 'v1.9', {}, ctx)).toBeGreaterThan(0);
  });

  it('raises minor and major versions', () => {
    expect(raiseVersion('v1.2', 'minor')).toBe('v1.3');
    expect(raiseVersion('v1.9', 'minor')).toBe('v1.10');
    expect(raiseVersion('v1.2', 'major')).toBe('v2.0');
    expect(raiseVersion(null, 'minor')).toBe('v1.0');
    expect(raiseVersion(null, 'major')).toBe('v1.0');
  });
});
