'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Clock } from 'lucide-react';
import type { InboxRow } from '@/engine/approvals';
import { formatDateTime } from '@/engine/fields/helpers';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DecisionDialog } from './decision-dialog';

// "Needs my approval" on My work (docs/05 §4): item, step, submitted by, waiting since, SLA due (overdue in words and
// a symbol), with Approve, Reject (a reason required) and Open. The list comes from the server; after a decision the
// page refreshes.

export function ApprovalInbox({
  org,
  rows,
  timeZone,
}: {
  org: string;
  rows: InboxRow[];
  timeZone: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<{ row: InboxRow; decision: 'approved' | 'rejected' } | null>(
    null,
  );
  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="work-approvals"
      data-testid="approval-inbox"
    >
      <h2 id="work-approvals" className="text-heading-16">
        Needs my approval{' '}
        <span className="text-muted-foreground text-label-12-mono font-normal">
          ({rows.length})
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="border-line bg-background-100 text-muted-foreground text-copy-13 m-0 rounded-lg border border-dashed p-4">
          Nothing waits for your approval.
        </p>
      ) : (
        <ul
          aria-label="Needs my approval"
          className="border-line bg-background-100 m-0 list-none overflow-hidden rounded-lg border p-0"
        >
          {rows.map((r) => {
            const href = `/${org}/s/${r.sheetId}?item=${encodeURIComponent(r.displayId)}`;
            return (
              <li
                key={r.instanceId}
                className="border-line flex flex-col gap-2 border-t px-4 py-3 first:border-t-0 sm:flex-row sm:items-center sm:gap-3"
                data-testid="approval-row"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Link
                    href={href}
                    className="text-label-14 font-medium break-words underline-offset-4 hover:underline"
                  >
                    {r.name}
                  </Link>
                  <span className="text-muted-foreground text-label-12 flex flex-wrap gap-x-2">
                    <span className="text-label-12-mono">{r.displayId}</span>
                    <span>{r.sheetName}</span>
                    <span>
                      Step {r.stepIndex + 1} of {r.stepCount}: {r.stepName}
                    </span>
                    <span>Submitted by {r.submittedBy}</span>
                  </span>
                </div>
                <div className="text-label-13 flex shrink-0 flex-col sm:items-end sm:text-right">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Clock className="size-3.5" aria-hidden />
                    Waiting since {formatDateTime(r.waitingSince, timeZone)}
                  </span>
                  {r.dueAt ? (
                    <span
                      className={cn(
                        'flex items-center gap-1',
                        r.overdue ? 'text-crit font-medium' : 'text-ink',
                      )}
                    >
                      {r.overdue ? <AlertTriangle className="size-3.5" aria-hidden /> : null}
                      {r.overdue ? 'Overdue since' : 'Due'} {formatDateTime(r.dueAt, timeZone)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No time limit</span>
                  )}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    aria-label={`Approve ${r.displayId} ${r.name}`}
                    onClick={() => setOpen({ row: r, decision: 'approved' })}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={`Reject ${r.displayId} ${r.name}`}
                    onClick={() => setOpen({ row: r, decision: 'rejected' })}
                  >
                    Reject
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <Link href={href} aria-label={`Open ${r.displayId} ${r.name}`}>
                      Open
                    </Link>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {open ? (
        <DecisionDialog
          org={org}
          instanceId={open.row.instanceId}
          decision={open.decision}
          title={`${open.decision === 'approved' ? 'Approve' : 'Reject'} ${open.row.displayId} ${open.row.name}`}
          commentRequired={open.decision === 'approved' && open.row.commentToApprove}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}
