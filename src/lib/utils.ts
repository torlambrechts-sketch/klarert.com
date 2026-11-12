import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// The sheet type scale (globals.css: text-cell, text-label, text-meta) are font sizes, not colours: without this,
// `cn('text-label', 'text-white')` dropped the size (the active view tab lost it).
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['cell', 'label', 'meta'] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
