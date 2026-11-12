import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges conflicting Tailwind classes, last one wins', () => {
    expect(cn('px-2 text-label-13', false && 'hidden', 'px-4')).toBe('text-label-13 px-4');
  });
});

describe('cn with the Geist type scale and materials', () => {
  it('keeps a type style next to a text colour', () => {
    expect(cn('text-label-13 flex', 'text-white')).toBe('text-label-13 flex text-white');
    expect(cn('text-label-12-mono', 'text-muted-foreground')).toBe(
      'text-label-12-mono text-muted-foreground',
    );
    expect(cn('text-heading-24', 'text-ink')).toBe('text-heading-24 text-ink');
  });
  it('lets a later type style win', () => {
    expect(cn('text-label-13', 'text-label-14')).toBe('text-label-14');
    expect(cn('text-copy-13', 'text-label-12-mono')).toBe('text-label-12-mono');
    expect(cn('text-heading-16', 'text-copy-14')).toBe('text-copy-14');
  });
  it('treats material shadows as shadows', () => {
    expect(cn('shadow-menu', 'shadow-none')).toBe('shadow-none');
    expect(cn('shadow-modal', 'shadow-black')).toBe('shadow-modal shadow-black');
  });
});
