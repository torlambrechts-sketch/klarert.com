import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges conflicting Tailwind classes, last one wins', () => {
    expect(cn('px-2 text-13', false && 'hidden', 'px-4')).toBe('text-13 px-4');
  });
});

describe('cn with the Keptrow type and materials', () => {
  it('keeps a type style next to a text colour', () => {
    expect(cn('text-13 flex', 'text-white')).toBe('text-13 flex text-white');
    expect(cn('font-mono text-12', 'text-muted-foreground')).toBe(
      'font-mono text-12 text-muted-foreground',
    );
    expect(cn('text-kpi', 'text-ink')).toBe('text-kpi text-ink');
  });
  it('lets a later type style win', () => {
    expect(cn('text-13', 'text-14')).toBe('text-14');
    expect(cn('text-13', 'font-mono text-12')).toBe('font-mono text-12');
    expect(cn('text-card-title', 'text-14')).toBe('text-14');
  });
  it('treats material shadows as shadows', () => {
    expect(cn('shadow-menu', 'shadow-none')).toBe('shadow-none');
    expect(cn('shadow-modal', 'shadow-black')).toBe('shadow-modal shadow-black');
  });
});
