'use client';

import { memo } from 'react';
import { SUMMARY_CAPTION, summarise, type SummaryFn } from '@/engine/summaries';
import type { Ctx, Field, Item } from '@/engine/types';
import { colorVar } from '@/components/fields/shared';

/**
 * One cell of a group's summary footer (docs/03 §8): a value with its muted caption ("12.3 average", "20 Dec 2026 –
 * 3 Feb 2027 range"), or a distribution bar whose words are its accessible name and tooltip.
 */
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
  if (s.kind === 'value') {
    if (!s.text) return null;
    const caption = SUMMARY_CAPTION[s.fn];
    return (
      <span
        className="text-ink-2 block truncate text-[12.5px] tabular-nums"
        title={caption ? `${s.text} ${caption}` : s.text}
      >
        {s.text}
        {caption ? <span className="text-muted-foreground ml-1.5">{caption}</span> : null}
      </span>
    );
  }
  if (s.total === 0) return null;
  return (
    <span
      className="flex h-2 w-full overflow-hidden rounded-full"
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
