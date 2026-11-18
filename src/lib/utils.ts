import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// The type scales (globals.css: the Keptrow text-hero … text-section-label and the Geist: text-heading-*, text-label-*, text-copy-*, with -mono variants) are font sizes
// and the Geist materials (shadow-tooltip, shadow-menu, shadow-modal, shadow-fullscreen) are shadows, not colours:
// without this, `cn('text-label-13', 'text-white')` would drop the size.
const sizes = (kind: string, steps: number[], mono: number[] = []) => [
  ...steps.map((n) => `${kind}-${n}`),
  ...mono.map((n) => `${kind}-${n}-mono`),
];
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            ...sizes('heading', [72, 64, 56, 48, 40, 32, 26, 24, 20, 16, 14]),
            ...sizes(
              'label',
              [20, 18, 16, 14, 13.5, 13, 12.5, 12, 11, 9.5],
              [14, 13, 12.5, 12, 11.5, 11, 10.5],
            ),
            ...sizes('copy', [24, 20, 18, 16, 14, 13], [14, 13]),
            // the Keptrow type scale (docs/18 §3)
            ...['logo', 'hero', 'hero-sub', 'figure', 'kpi', 'card-title', 'panel-title', 'nav'],
            ...['body', 'sub', 'tab', 'section-label'],
          ],
        },
      ],
      shadow: [{ shadow: ['tooltip', 'menu', 'modal', 'fullscreen', 'card', 'drawer'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
