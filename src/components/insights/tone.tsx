import { AlertTriangle, CheckCircle2, CircleMinus, Clock, XCircle } from 'lucide-react';
import type { EvidenceStatus } from '@/engine/evidence-library';
import type { Tone } from '@/engine/dashboards';
import { cn } from '@/lib/utils';

// Tones for status badges and bars on the insight pages (evidence library, workflow, dashboards). A tone always comes
// with words, and badges add a symbol: colour is never the only signal (CLAUDE.md, definition of done for UI).

export const TONE_BADGE: Record<Tone, string> = {
  good: 'bg-good-soft text-good',
  warn: 'bg-warn-soft text-warn',
  crit: 'bg-crit-soft text-crit-ink',
  neutral: 'bg-soft text-muted-foreground',
};

export const TONE_FILL: Record<Tone, string> = {
  good: 'bg-good',
  warn: 'bg-[var(--label-yellow)]',
  crit: 'bg-crit',
  neutral: 'bg-faint',
};

export const EVIDENCE_TONE: Record<EvidenceStatus, Tone> = {
  valid: 'good',
  expiring: 'warn',
  expired: 'crit',
  none: 'neutral',
};

const EVIDENCE_ICON: Record<EvidenceStatus, typeof CheckCircle2> = {
  valid: CheckCircle2,
  expiring: Clock,
  expired: XCircle,
  none: CircleMinus,
};

export function ToneBadge({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: Tone;
  icon?: typeof AlertTriangle;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-medium whitespace-nowrap',
        TONE_BADGE[tone],
        className,
      )}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      {children}
    </span>
  );
}

export function EvidenceStatusIcon({
  status,
  className,
}: {
  status: EvidenceStatus;
  className?: string;
}) {
  const Icon = EVIDENCE_ICON[status];
  return <Icon className={cn('size-4 shrink-0', className)} aria-hidden />;
}

export function EvidenceBadge({ status, label }: { status: EvidenceStatus; label: string }) {
  return (
    <ToneBadge tone={EVIDENCE_TONE[status]} icon={EVIDENCE_ICON[status]}>
      {label}
    </ToneBadge>
  );
}
