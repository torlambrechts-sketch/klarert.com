'use client';

import { memo } from 'react';
import { SUMMARY_CAPTION, summarise, type SummaryFn } from '@/engine/summaries';
import type { Ctx, Field, Item } from '@/engine/types';
import { solidVar } from '@/components/fields/shared';

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
        className="text-ink-2 block min-w-0 text-[12px] leading-[17px] font-semibold tabular-nums"
        title={caption ? `${s.text} ${caption}` : s.text}
      >
        <span className="block truncate">{s.text}</span>
        {caption ? (
          <span className="text-muted-foreground block truncate text-[10.5px] leading-[10.5px] font-normal">
            {caption}
          </span>
        ) : null}
      </span>
    );
  }
  // nothing to show when no item has a value
  if (s.total === 0 || s.segments.every((seg) => seg.color === 'empty')) return null;
  return (
    <span
      // a compact stacked bar, one solid segment per option (the design's board summary)
      className="mx-0.5 flex h-[22px] w-[108px] max-w-full overflow-hidden rounded-[3px]"
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
            background: seg.color === 'empty' ? 'var(--line)' : solidVar(seg.color),
          }}
        />
      ))}
    </span>
  );
});
