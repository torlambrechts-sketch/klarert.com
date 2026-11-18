'use client';

import { memo } from 'react';
import { SUMMARY_CAPTION, summarise, type Segment, type SummaryFn } from '@/engine/summaries';
import type { Ctx, Field, Item } from '@/engine/types';
import { Avatar, solidVar } from '@/components/fields/shared';

/**
 * One cell of a group's summary footer (docs/03 §8, docs/18 §5, summaries on by default: C6): a value with its muted
 * caption ("Σ 42", "12.3 average", "20 Dec 2026 – 3 Feb 2027", "3 of 5 with files"), a status battery whose words are
 * its accessible name and tooltip, or the avatars of the people present.
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
    const sum = s.fn === 'sum';
    const caption = sum || s.fn === 'range' ? '' : SUMMARY_CAPTION[s.fn];
    const text = sum ? `Σ ${s.text}` : s.text;
    return (
      <span
        className="text-ink text-12 block min-w-0 leading-[17px] font-semibold tabular-nums"
        title={caption ? `${text} ${caption}` : text}
      >
        <span className="block truncate" aria-label={sum ? `Sum ${s.text}` : undefined}>
          {text}
        </span>
        {caption ? (
          <span className="text-muted-foreground text-12 block truncate leading-none font-normal">
            {caption}
          </span>
        ) : null}
      </span>
    );
  }
  if (s.kind === 'people') {
    if (s.ids.length === 0) return null;
    return (
      <span className="flex min-w-0 items-center" title={s.text}>
        <span className="flex items-center -space-x-1.5">
          {s.ids.slice(0, 4).map((id) => (
            <Avatar key={id} id={id} ctx={ctx} size={24} tone="soft" decorative />
          ))}
        </span>
        {s.ids.length > 4 ? (
          <span className="text-muted-foreground text-12 pl-1.5 font-semibold" aria-hidden>
            +{s.ids.length - 4}
          </span>
        ) : null}
        <span className="sr-only">{s.text}</span>
      </span>
    );
  }
  // nothing to show when no item has a value
  if (s.total === 0 || s.segments.every((seg) => seg.color === 'empty')) return null;
  return <Battery segments={s.segments} total={s.total} label={s.text} />;
});

/**
 * A status battery (docs/18 §5): one segment per option in its solid colour, grey for empty values, as wide as the
 * cell (or `width`). Its accessible name and tooltip list the counts.
 */
export function Battery({
  segments,
  total,
  label,
  className,
}: {
  segments: Segment[];
  total: number;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={className ?? 'flex h-[22px] w-full overflow-hidden rounded-[2px]'}
      role="img"
      aria-label={label}
      title={label}
    >
      {segments.map((seg) => (
        <span
          key={seg.id || 'empty'}
          title={`${seg.label}: ${seg.count}`}
          style={{
            width: `${(seg.count / total) * 100}%`,
            background: seg.color === 'empty' ? 'var(--line-strong)' : solidVar(seg.color),
          }}
        />
      ))}
    </span>
  );
}
