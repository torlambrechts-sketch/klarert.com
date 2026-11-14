'use client';

import { useId, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Check, Clock, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { inputClass } from '@/components/fields/shared';
import { formatDate } from '@/engine/fields/helpers';
import type { QueueStatus } from '@/engine/retention';
import type { RetentionQueueRow } from '@/server/commands/retention';
import type { Result } from '@/server/result';
import {
  approveRetentionAction,
  checkRetentionNowAction,
  postponeRetentionAction,
  removeErasedFilesAction,
  setRetentionHoldAction,
} from './actions';

// Workspace admin › Retention (docs/02 §18): the review queue. A person approves each erasure, postpones it with a
// date and a reason, or places a legal hold; nothing is erased without that approval.

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run(action: () => Promise<Result<{ message: string }>>, done?: () => void) {
    start(async () => {
      let r: Result<{ message: string }>;
      try {
        r = await action();
      } catch {
        toast.error('Something went wrong. Try again.');
        return;
      }
      if (!r.ok) {
        toast.error(r.error.message, {
          action: { label: 'Retry', onClick: () => run(action, done) },
        });
        return;
      }
      toast(r.data.message);
      done?.();
      router.refresh();
    });
  }
  return { pending, run };
}

const STATE: Record<QueueStatus, { label: string; icon: typeof Check; tone: string }> = {
  due: { label: 'Due', icon: AlertTriangle, tone: 'text-[var(--amber-900)]' },
  held: { label: 'Legal hold', icon: Lock, tone: 'text-[var(--blue-900)]' },
  postponed: { label: 'Postponed', icon: Clock, tone: 'text-muted-foreground' },
  done: { label: 'Done', icon: Check, tone: 'text-[var(--green-900)]' },
};

const ACTION_WORDS = {
  erase: 'Erase personal data',
  anonymise: 'Anonymise',
  archive: 'Archive',
} as const;

export function StateChip({ state }: { state: QueueStatus }) {
  const s = STATE[state];
  const Icon = s.icon;
  return (
    <span className={`text-label-13 inline-flex items-center gap-1 ${s.tone}`}>
      <Icon className="size-3.5" aria-hidden />
      {s.label}
    </span>
  );
}

export function CheckRetentionNow({ org }: { org: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => run(() => checkRetentionNowAction({ org }))}
    >
      {pending ? 'Checking…' : 'Check now'}
    </Button>
  );
}

export function RemoveErasedFiles({ org }: { org: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => run(() => removeErasedFilesAction({ org }))}
    >
      {pending ? 'Removing…' : 'Remove erased files from storage'}
    </Button>
  );
}

type Mode = 'approve' | 'postpone' | 'hold' | 'release';

/** Approve, postpone, hold or release one queue entry: each in a dialog that says what will happen. */
export function QueueActions({
  org,
  row,
  today,
}: {
  org: string;
  row: RetentionQueueRow;
  today: string;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [note, setNote] = useState('');
  const [until, setUntil] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = useRun();
  const id = useId();
  if (row.state === 'done') return null;
  const open = (m: Mode) => {
    setMode(m);
    setNote('');
    setUntil('');
    setError(null);
  };
  const what = `${row.displayId} ${row.itemName}`;
  const close = () => setMode(null);
  function submit() {
    if ((mode === 'postpone' || mode === 'hold') && !note.trim()) return setError('Say why.');
    if (mode === 'postpone' && !(until > today)) return setError('Choose a date after today.');
    setError(null);
    if (mode === 'approve')
      run(
        () => approveRetentionAction({ org, queueId: row.id, note: note.trim() || undefined }),
        close,
      );
    if (mode === 'postpone')
      run(
        () => postponeRetentionAction({ org, queueId: row.id, until, reason: note.trim() }),
        close,
      );
    if (mode === 'hold')
      run(
        () => setRetentionHoldAction({ org, itemId: row.itemId, on: true, reason: note.trim() }),
        close,
      );
    if (mode === 'release')
      run(
        () =>
          setRetentionHoldAction({
            org,
            itemId: row.itemId,
            on: false,
            reason: note.trim() || undefined,
          }),
        close,
      );
  }
  const title: Record<Mode, string> = {
    approve: `${ACTION_WORDS[row.action]}: ${row.displayId}`,
    postpone: `Postpone ${row.displayId}`,
    hold: `Place a legal hold on ${row.displayId}`,
    release: `Release the legal hold on ${row.displayId}`,
  };
  const description: Record<Mode, string> = {
    approve:
      row.action === 'archive'
        ? `${what} is archived under "${row.ruleName}". It can be restored from Archived.`
        : `${what}: the personal data the rule "${row.ruleName}" names is erased for good, with the copies in the activity log. The item, its other fields and a record of this approval stay. This cannot be undone.`,
    postpone:
      'It comes back to the queue on the date you choose. The reason is kept in the item’s activity log.',
    hold: 'Nothing is erased, anonymised or archived under a retention rule while the hold is in place, for example during a claim or an investigation.',
    release: 'The item can be erased under its retention rules again.',
  };
  return (
    <div className="flex flex-wrap gap-1">
      {row.state === 'held' ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => open('release')}
          aria-label={`Release hold on ${what}`}
        >
          Release hold
        </Button>
      ) : (
        <>
          <Button
            type="button"
            size="sm"
            onClick={() => open('approve')}
            aria-label={`Approve: ${what}`}
          >
            Approve
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => open('postpone')}
            aria-label={`Postpone ${what}`}
          >
            Postpone
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => open('hold')}
            aria-label={`Legal hold on ${what}`}
          >
            Legal hold
          </Button>
        </>
      )}
      <Dialog open={mode !== null} onOpenChange={(o) => (!o && !pending ? close() : undefined)}>
        <DialogContent className="flex w-[min(520px,calc(100vw-32px))] flex-col gap-4">
          {mode ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="flex flex-col gap-1 pr-8">
                <DialogTitle className="text-heading-20">{title[mode]}</DialogTitle>
                <DialogDescription className="text-copy-14 text-muted-foreground">
                  {description[mode]}
                </DialogDescription>
              </div>
              {mode === 'postpone' ? (
                <label className="flex flex-col gap-1">
                  <span className="text-label-13 font-medium">Postpone until</span>
                  <input
                    type="date"
                    className={inputClass}
                    value={until}
                    min={today}
                    required
                    onChange={(e) => setUntil(e.target.value)}
                  />
                </label>
              ) : null}
              <label className="flex flex-col gap-1">
                <span className="text-label-13 font-medium">
                  {mode === 'approve'
                    ? 'Note (optional)'
                    : mode === 'release'
                      ? 'Note (optional)'
                      : 'Reason'}
                </span>
                <textarea
                  className={`${inputClass} min-h-20 py-2`}
                  value={note}
                  maxLength={1000}
                  aria-invalid={!!error}
                  aria-describedby={error ? `${id}-err` : undefined}
                  onChange={(e) => setNote(e.target.value)}
                />
                <span className="text-label-12 text-muted-foreground">
                  Do not write personal data here: the note is kept in the activity log.
                </span>
              </label>
              {error ? (
                <p id={`${id}-err`} role="alert" className="text-copy-13 m-0 text-[var(--red-900)]">
                  {error}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={close}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  variant={
                    mode === 'approve' && row.action !== 'archive' ? 'destructive' : 'default'
                  }
                  disabled={pending}
                >
                  {pending
                    ? 'Working…'
                    : mode === 'approve'
                      ? ACTION_WORDS[row.action]
                      : mode === 'postpone'
                        ? 'Postpone'
                        : mode === 'hold'
                          ? 'Place hold'
                          : 'Release hold'}
                </Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function QueueItemLink({ org, row }: { org: string; row: RetentionQueueRow }) {
  return (
    <Link
      href={`/${org}/s/${row.sheetId}?item=${encodeURIComponent(row.displayId)}`}
      className="hover:underline"
    >
      <span className="text-label-13-mono text-muted-foreground mr-1.5">{row.displayId}</span>
      {row.itemName}
    </Link>
  );
}

export const dueLabel = (row: RetentionQueueRow) =>
  row.state === 'postponed' && row.postponedUntil
    ? `Postponed to ${formatDate(row.postponedUntil)}`
    : `Due ${formatDate(row.dueOn)}`;
