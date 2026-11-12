import { AlertTriangle, Check, Minus, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';

// Run and step outcomes as chips with text and a symbol (colour is never the only signal; done and action-needed
// states carry a symbol).

const LABEL: Record<string, string> = {
  done: 'Done',
  partial: 'Partly done',
  failed: 'Failed',
  stopped: 'Stopped',
  blocked: 'Blocked',
  skipped: 'Skipped',
  no_change: 'No change',
};

export const outcomeLabel = (o: string) => LABEL[o] ?? o;

export function OutcomeChip({ outcome, className }: { outcome: string; className?: string }) {
  const bad = outcome === 'failed' || outcome === 'stopped' || outcome === 'blocked';
  const warn = outcome === 'partial';
  const Icon =
    outcome === 'done'
      ? Check
      : bad || warn
        ? AlertTriangle
        : outcome === 'skipped'
          ? SkipForward
          : Minus;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        outcome === 'done' && 'border-good/30 text-good bg-good-soft',
        bad && 'border-crit-line text-crit-ink bg-crit-soft',
        warn && 'border-warn/40 text-warn bg-warn-soft',
        !bad && !warn && outcome !== 'done' && 'border-line text-muted-foreground bg-white',
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {outcomeLabel(outcome)}
    </span>
  );
}
