import { cn } from '@/lib/utils';

// Badges and tags (docs/18 §5): 13 px 600 pills. Done carries ✓ and action-needed carries !, so colour is never the
// only signal.

export type BadgeTone = 'blue' | 'orange' | 'red' | 'green' | 'grey';

const TONE: Record<BadgeTone, string> = {
  blue: 'bg-brand-soft text-navy',
  orange: 'bg-badge-orange-bg text-warn-ink',
  red: 'bg-badge-red-bg text-bad-ink',
  green: 'bg-badge-green-bg text-badge-green-ink',
  grey: 'bg-page text-muted-foreground',
};

export function Badge({
  tone = 'blue',
  mark,
  className,
  children,
}: {
  tone?: BadgeTone;
  /** done: ✓ before the words; action: ! before the words. */
  mark?: 'done' | 'action';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'text-13 inline-flex items-center gap-1 rounded-full px-3 py-1 leading-none font-semibold whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      {mark === 'done' ? (
        <span aria-hidden>✓</span>
      ) : mark === 'action' ? (
        <span aria-hidden>!</span>
      ) : null}
      {children}
    </span>
  );
}

/** A tag: 12 px 600 navy on --brand-soft, a pill. */
export function Tag({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'bg-brand-soft text-navy text-12 inline-flex items-center rounded-full px-2.5 py-0.5 font-semibold',
        className,
      )}
    >
      {children}
    </span>
  );
}
