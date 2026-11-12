import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges conflicting Tailwind classes, last one wins', () => {
    expect(cn('px-2 text-sm', false && 'hidden', 'px-4')).toBe('text-sm px-4');
  });
});

describe('cn with the sheet type scale', () => {
  it('keeps a type-scale size next to a text colour', () => {
    expect(cn('text-label flex', 'text-white')).toBe('text-label flex text-white');
    expect(cn('text-meta', 'text-muted-foreground')).toBe('text-meta text-muted-foreground');
  });
  it('lets a later size win', () => {
    expect(cn('text-label', 'text-cell')).toBe('text-cell');
    expect(cn('text-sm', 'text-meta')).toBe('text-meta');
  });
});
