'use client';

import { memo } from 'react';
import { summarise, type SummaryFn } from '@/engine/summaries';
import type { Ctx, Field, Item } from '@/engine/types';
import { colorVar } from '@/components/fields/shared';

/** One cell of a group's summary row (docs/03 §8): a value, or a distribution bar with counts on hover. */
export const GroupSummary = memo(function GroupSummary({
  field,
  items,
  ctx,
  fn,
}: {
  field: Field;
  items: Item[];
  ctx: Ctx;
  fn?: SummaryFn;
}) {
  const s = summarise(field, items, ctx, fn);
  if (s.kind === 'value')
    return (
      <span
        className="text-muted-foreground block truncate text-right text-xs font-semibold tabular-nums"
        title={s.text}
      >
        {s.text}
      </span>
    );
  if (s.total === 0) return null;
  return (
    <span
      className="flex h-4 w-full overflow-hidden rounded-sm"
      role="img"
      aria-label={s.text}
      title={s.text}
    >
      {s.segments.map((seg) => (
        <span
          key={seg.id || 'empty'}
          title={`${seg.label}: ${seg.count}`}
          style={{
            width: `${(seg.count / s.total) * 100}%`,
            background: seg.color === 'empty' ? 'var(--line)' : colorVar(seg.color),
          }}
        />
      ))}
    </span>
  );
});
