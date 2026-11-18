'use client';

import { useMemo } from 'react';
import type { Ctx, Item } from '@/engine/types';
import { keyFigures } from '@/engine/views/quick-filters';

// The key figures above the view tabs (docs/18 §4): up to five numbers (Items, Open, Overdue, the alert status,
// Missing evidence). Figures, not buttons. While the sheet loads, boxes of the same size hold their place.

const box =
  'border-line bg-surface flex min-h-[64px] flex-col justify-center gap-0.5 rounded-lg border px-4 py-2';

export function KeyFigures({ items, ctx }: { items: Item[] | null; ctx: Ctx | null }) {
  const figures = useMemo(() => (items && ctx ? keyFigures(items, ctx) : null), [items, ctx]);
  return (
    <dl
      aria-label="Key figures"
      aria-busy={!figures || undefined}
      data-testid="key-figures"
      data-hero-overlap
      className="m-0 mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-3"
    >
      {figures
        ? figures.map((f) => (
            <div key={f.id} className={box}>
              <dt className="text-muted-foreground text-label-13 order-2 truncate">{f.label}</dt>
              <dd className="text-heading-24 m-0 tabular-nums">
                {f.value.toLocaleString('en-GB')}
              </dd>
            </div>
          ))
        : [0, 1, 2].map((i) => (
            <div
              key={i}
              className="border-line bg-soft min-h-[64px] animate-pulse rounded-lg border"
            />
          ))}
    </dl>
  );
}
