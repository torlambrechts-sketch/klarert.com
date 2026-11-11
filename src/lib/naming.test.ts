import { describe, expect, it } from 'vitest';
import { initialsFor, slugify } from './naming';

describe('slugify', () => {
  it.each([
    ['Meridian Components Ltd', 'meridian-components-ltd'],
    ['  Ærø & Søn AS ', 'aero-son-as'],
    ['Café Crème', 'cafe-creme'],
    ['A'.repeat(50), 'a'.repeat(40)],
    ['Acme --- Ltd!', 'acme-ltd'],
  ])('%s → %s', (name, slug) => expect(slugify(name)).toBe(slug));

  it('never ends with a hyphen after truncation', () => {
    expect(slugify('x'.repeat(39) + ' yz')).toBe('x'.repeat(39));
  });
});

describe('initialsFor', () => {
  it.each([
    ['Maria Pereira', 'MP'],
    ['james', 'JA'],
    ['Anne Marie van der Berg', 'AB'],
    ['   ', ''],
  ])('%s → %s', (name, initials) => expect(initialsFor(name)).toBe(initials));
});
