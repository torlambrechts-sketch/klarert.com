import { cn } from '@/lib/utils';

/** Colour square of a group. Decorative: the group name always sits next to it. */
export function GroupSwatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-3 shrink-0 rounded-[3px]', className)}
      style={{ background: `var(--label-${color}, var(--label-grey))` }}
    />
  );
}
