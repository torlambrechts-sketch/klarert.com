'use client';

import {
  Bell,
  Box,
  CircleCheck,
  CircleDashed,
  CirclePause,
  CircleX,
  FileText,
  FlaskConical,
  GitBranch,
  Link2,
  ListPlus,
  MousePointerClick,
  Package,
  PencilLine,
  Plug,
  RefreshCw,
  Send,
  Sheet,
  TriangleAlert,
  Webhook,
  Workflow,
  Zap,
} from 'lucide-react';
import type { HealthTone, StepHealth, StepKind, StepPack } from '@/engine/flow';
import { cn } from '@/lib/utils';

// Small parts the Design tab, the workspace map and the print view share: a step's icon, its health in words with a
// symbol (never colour alone, docs/05 §6.1) and the pack marker.

export const STEP_ICON: Record<StepKind, typeof Zap> = {
  manual: PencilLine,
  form: FileText,
  automation_in: Zap,
  button_in: MousePointerClick,
  link_in: Link2,
  api: Plug,
  sheet: Sheet,
  automation: Zap,
  approval: GitBranch,
  lifecycle: Workflow,
  link_out: Link2,
  create_out: ListPlus,
  update_out: RefreshCw,
  notify: Bell,
  webhook: Webhook,
};

export function StepIcon({ kind, inverted }: { kind: StepKind; inverted?: boolean }) {
  const Icon = STEP_ICON[kind];
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-[26px] shrink-0 place-items-center rounded-md',
        inverted ? 'bg-gray-alpha-400 text-white' : 'bg-soft text-ink',
      )}
    >
      <Icon className="size-[14px]" />
    </span>
  );
}

const TONE: Record<HealthTone, { Icon: typeof Zap; className: string; sr: string }> = {
  ok: { Icon: CircleCheck, className: 'text-good', sr: 'Healthy' },
  idle: { Icon: CircleDashed, className: 'text-muted-foreground', sr: 'Idle' },
  test: { Icon: FlaskConical, className: 'text-info', sr: 'Test mode' },
  off: { Icon: CirclePause, className: 'text-muted-foreground', sr: 'Off' },
  warn: { Icon: TriangleAlert, className: 'text-warn', sr: 'Needs attention' },
  crit: { Icon: CircleX, className: 'text-crit', sr: 'Problem' },
};

export function ToneSymbol({ tone, className }: { tone: HealthTone; className?: string }) {
  const { Icon, className: c } = TONE[tone];
  return <Icon aria-hidden className={cn('size-3.5 shrink-0', c, className)} />;
}

/** "⚠ Dead letter: 2 webhooks failed · +1 more": the headline with its symbol; the rest for screen readers and on hover. */
export function HealthLine({ health, className }: { health: StepHealth; className?: string }) {
  const more = health.problems.filter((p) => p !== health.words);
  return (
    <span
      data-testid="step-health"
      className={cn('text-label-12 flex min-w-0 items-center gap-1', className)}
      title={health.problems.length > 1 ? health.problems.join('\n') : undefined}
    >
      <ToneSymbol tone={health.tone} />
      <span className="sr-only">{TONE[health.tone].sr}: </span>
      <span
        className={cn(
          'truncate',
          health.tone === 'crit'
            ? 'text-crit'
            : health.tone === 'warn'
              ? 'text-warn'
              : 'text-muted-foreground',
        )}
      >
        {health.words}
      </span>
      {more.length ? (
        <span className="text-muted-foreground shrink-0">
          <span aria-hidden>· +{more.length}</span>
          <span className="sr-only">. Also: {more.join('. ')}</span>
        </span>
      ) : null}
    </span>
  );
}

/** "From Core registers · unchanged", "From Core registers · changed", "Added here". */
export function PackChip({ pack, className }: { pack: StepPack; className?: string }) {
  return (
    <span
      data-testid="step-pack"
      className={cn(
        'text-label-11 inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-px font-medium whitespace-nowrap',
        pack.state === 'changed'
          ? 'border-warn/40 bg-warn-soft text-warn'
          : pack.state === 'added'
            ? 'border-line text-ink'
            : 'border-line text-muted-foreground',
        className,
      )}
    >
      {pack.state === 'added' ? (
        <Box className="size-3 shrink-0" aria-hidden />
      ) : (
        <Package className="size-3 shrink-0" aria-hidden />
      )}
      <span className="truncate">{pack.words}</span>
    </span>
  );
}

export function ComingLaterChip() {
  return (
    <span className="border-line text-muted-foreground text-label-11 inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-px font-medium whitespace-nowrap">
      <Send className="size-3" aria-hidden /> Coming later
    </span>
  );
}
