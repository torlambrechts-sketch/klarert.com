import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// The Keptrow type (globals.css, docs/18 §3: text-12 … text-28 and the named styles text-hero … text-section-label) is
// font sizes and the materials (shadow-card, shadow-menu …) are shadows, not colours: without this,
// `cn('text-13', 'text-white')` would drop the size.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            ...['12', '13', '14', '15', '16', '17', '18', '20', '24', '28'],
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
