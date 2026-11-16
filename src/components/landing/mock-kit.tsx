// Small building blocks for the public site's illustrations: static HTML and CSS in the app's own tokens, never a
// screenshot, always inside an aria-hidden illustration (the words around each one say what it shows). Status shows
// text, and a symbol for done (✓) and action-needed (!) states, never colour alone (docs/05 §6.1).
import { cn } from '@/lib/utils';

export type Tint = 'green' | 'blue' | 'red' | 'grey' | 'yellow' | 'purple' | 'navy' | 'teal';

// full class names, so Tailwind sees them
const TINT: Record<Tint, string> = {
  green: 'bg-(--tint-green-bg) border-(--tint-green-line) text-(--tint-green-ink)',
  blue: 'bg-(--tint-blue-bg) border-(--tint-blue-line) text-(--tint-blue-ink)',
  red: 'bg-(--tint-red-bg) border-(--tint-red-line) text-(--tint-red-ink)',
  grey: 'bg-(--tint-grey-bg) border-(--tint-grey-line) text-(--tint-grey-ink)',
  yellow: 'bg-(--tint-yellow-bg) border-(--tint-yellow-line) text-(--tint-yellow-ink)',
  purple: 'bg-(--tint-purple-bg) border-(--tint-purple-line) text-(--tint-purple-ink)',
  navy: 'bg-(--tint-navy-bg) border-(--tint-navy-line) text-(--tint-navy-ink)',
  teal: 'bg-(--tint-teal-bg) border-(--tint-teal-line) text-(--tint-teal-ink)',
};

/** An option value as the Table shows it: the label, with ✓ for done and ! for action needed. */
export function Tag({
  tint,
  mark,
  children,
  className,
}: {
  tint: Tint;
  mark?: '✓' | '!';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        TINT[tint],
        'text-label-12 inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium whitespace-nowrap',
        className,
      )}
    >
      {mark ? <span>{mark}</span> : null}
      {children}
    </span>
  );
}

/** A state in words with a dot: "Live", "On", "Chain intact". */
export function Dot({
  tone,
  children,
}: {
  tone: 'good' | 'warn' | 'muted';
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'text-label-12 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium whitespace-nowrap',
        tone === 'good' && 'border-line bg-good-soft text-good',
        tone === 'warn' && 'border-line bg-warn-soft text-warn',
        tone === 'muted' && 'border-line bg-soft text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          tone === 'good' && 'bg-(--bar-good)',
          tone === 'warn' && 'bg-(--bar-warn)',
          tone === 'muted' && 'bg-gray-600',
        )}
      />
      {children}
    </span>
  );
}

/** A flat white card for a piece of UI. `float` adds the menu shadow a floating surface casts. */
export function Panel({
  float,
  className,
  children,
}: {
  float?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('bg-card border-line rounded-lg border', float && 'shadow-menu', className)}>
      {children}
    </div>
  );
}

/** The browser window the hero and the big cards draw UI in: three grey dots and an address pill. */
export function BrowserFrame({
  address,
  className,
  children,
}: {
  address: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('bg-card border-line overflow-hidden rounded-xl border', className)}>
      <div className="border-line bg-subtle flex items-center gap-3 border-b px-3 py-2">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-gray-500" />
          <span className="size-2.5 rounded-full bg-gray-500" />
          <span className="size-2.5 rounded-full bg-gray-500" />
        </span>
        <span className="bg-background-100 border-line text-muted-foreground text-label-11-mono min-w-0 flex-1 truncate rounded-full border px-3 py-0.5 text-center">
          {address}
        </span>
      </div>
      {children}
    </div>
  );
}

/** An avatar with initials. */
export function Initials({ children }: { children: string }) {
  return (
    <span className="bg-soft text-label-11 text-ink flex size-6 shrink-0 items-center justify-center rounded-full font-semibold">
      {children}
    </span>
  );
}

/** A thin progress bar beside the words that say the same. */
export function Bar({ percent, tone = 'good' }: { percent: number; tone?: 'good' | 'warn' }) {
  return (
    <span className="bg-soft block h-1.5 w-full overflow-hidden rounded-full">
      <span
        className={cn(
          'block h-full rounded-full',
          tone === 'good' ? 'bg-(--bar-good)' : 'bg-(--bar-warn)',
        )}
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}

/** The grey panel an illustration sits on inside a card. */
export function Stage({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'bg-glow-soft border-line relative flex items-center justify-center overflow-hidden rounded-lg border p-4 sm:p-6',
        className,
      )}
    >
      {children}
    </div>
  );
}
