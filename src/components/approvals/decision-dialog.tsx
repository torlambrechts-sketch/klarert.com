'use client';

import { useId, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Undo2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { decideApprovalAction } from '@/app/[org]/approval-actions';
import type { ApprovalSymbol } from '@/engine/approvals';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { inputClass } from '@/components/fields/shared';
import { cn } from '@/lib/utils';

// Shared parts of the approval screens (docs/05 §3.4, §4): the state symbol (never colour alone) and the Approve /
// Reject dialog (a reason is required to reject).

const SYMBOLS: Record<ApprovalSymbol, { icon: LucideIcon; tone: string }> = {
  waiting: { icon: Clock, tone: 'text-info' },
  overdue: { icon: AlertTriangle, tone: 'text-crit' },
  approved: { icon: CheckCircle2, tone: 'text-good' },
  rejected: { icon: XCircle, tone: 'text-crit' },
  withdrawn: { icon: Undo2, tone: 'text-muted-foreground' },
  draft: { icon: CircleDashed, tone: 'text-muted-foreground' },
};

export function ApprovalStateLine({
  symbol,
  text,
  detail,
  className,
}: {
  symbol: ApprovalSymbol;
  text: string;
  detail?: string | null;
  className?: string;
}) {
  const { icon: Icon, tone } = SYMBOLS[symbol];
  return (
    <p className={cn('m-0 flex items-start gap-2', className)} data-testid="approval-state">
      <Icon className={cn('mt-0.5 size-4 shrink-0', tone)} aria-hidden />
      <span className="flex min-w-0 flex-col">
        <span className="text-label-14 font-semibold">{text}</span>
        {detail ? (
          <span
            className={cn(
              'text-label-12',
              symbol === 'overdue' ? 'text-crit font-medium' : 'text-muted-foreground',
            )}
          >
            {detail}
          </span>
        ) : null}
      </span>
    </p>
  );
}

export function DecisionDialog({
  org,
  instanceId,
  decision,
  title,
  commentRequired,
  onClose,
  onDone,
}: {
  org: string;
  instanceId: string;
  decision: 'approved' | 'rejected';
  /** "Approve ISD-003 Information security policy" */
  title: string;
  /** Approving needs a comment too (a documents register's version note). */
  commentRequired?: boolean;
  onClose(): void;
  onDone(messages: string[]): void;
}) {
  const id = useId();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rejecting = decision === 'rejected';
  const needed = rejecting || !!commentRequired;

  async function submit() {
    if (needed && !comment.trim()) {
      setError(
        rejecting ? 'Say why you reject it.' : 'Add a version note: what changed in this version.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    const r = await decideApprovalAction({
      org,
      instanceId,
      decision,
      comment: comment.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.fieldErrors?.comment ?? r.error.message);
      return;
    }
    toast(
      rejecting
        ? 'Rejected. The person who submitted it is told.'
        : r.data.outcome === 'approved'
          ? 'Approved. Every step is done.'
          : r.data.outcome === 'waiting'
            ? 'Approved. Waiting for the other approvers.'
            : 'Approved. It moves to the next step.',
    );
    for (const m of r.data.messages) toast(m);
    onDone(r.data.messages);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={`${id}-desc`}>
        <DialogTitle className="text-heading-16 m-0">{title}</DialogTitle>
        <DialogDescription id={`${id}-desc`} className="text-muted-foreground text-copy-13 m-0">
          {rejecting
            ? 'Your reason goes to the person who submitted it and into the activity log.'
            : 'Your approval and comment go into the activity log.'}
        </DialogDescription>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="text-label-13 flex flex-col gap-1">
            {rejecting ? 'Why do you reject it?' : needed ? 'Version note' : 'Comment (optional)'}
            <textarea
              className={cn(inputClass, 'h-auto min-h-20 py-2')}
              value={comment}
              maxLength={2000}
              required={needed}
              aria-invalid={!!error}
              autoFocus
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          {error ? (
            <p role="alert" className="text-crit text-copy-13 m-0">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={rejecting ? 'destructive' : 'default'} disabled={busy}>
              {busy ? 'Saving…' : rejecting ? 'Reject' : 'Approve'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
