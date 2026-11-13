'use client';

import { Check, ListTree } from 'lucide-react';
import { progressText } from '@/engine/subitems';
import { cn } from '@/lib/utils';

/**
 * "3/5": how many sub-items are done. The text carries the meaning; the bar and the tick (all done) repeat it, so
 * colour is never the only signal (CLAUDE.md, definition of done).
 */
export function ProgressChip({
  total,
  done,
  label,
  className,
}: {
  total: number;
  done: number;
  /** The sheet's word for its sub-items ("Actions"), for screen readers. */
  label: string;
  className?: string;
}) {
  const all = total > 0 && done === total;
  return (
    <span
      data-subitems-chip
      className={cn(
        'border-line text-label-12-mono text-ink bg-background-100 inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 tabular-nums',
        all && 'border-good text-good',
        className,
      )}
      title={`${label}: ${done} of ${total} done`}
    >
      {all ? (
        <Check className="size-3" aria-hidden />
      ) : (
        <ListTree className="text-muted-foreground size-3" aria-hidden />
      )}
      <span aria-hidden>{progressText({ total, done })}</span>
      <span className="sr-only">
        {label}: {done} of {total} done
      </span>
    </span>
  );
}
