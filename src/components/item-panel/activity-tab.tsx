'use client';

import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { verifyActivityAction } from '@/app/[org]/s/panel-actions';
import { noteActivityLogOpenedAction } from '@/app/[org]/shell-actions';
import { activityLine, isItemEntry, type ActivityLookup } from '@/engine/activity';
import { formatDateTime } from '@/engine/fields/helpers';
import type { Ctx, Item } from '@/engine/types';
import { Avatar } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import type { VerifyResult } from '@/server/commands/panel';
import type { ActivityData } from './queries';

// Activity log (docs/05 §3.4, FR-28/FR-40): the item's hash-chained entries, newest first, as readable sentences
// with who, when and the short hash; "Verify audit trail" recomputes the chain in the database. Opening it once is a
// step of Home's Getting started checklist.

let notedOpened = false;

export function ActivityTab({
  org,
  item,
  ctx,
  data,
  state,
  onRetry,
}: {
  org: string;
  item: Item;
  ctx: Ctx;
  data: ActivityData | undefined;
  state: 'loading' | 'error' | 'ready';
  onRetry(): void;
}) {
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  useEffect(() => {
    if (notedOpened) return;
    notedOpened = true;
    noteActivityLogOpenedAction({ org }).catch(() => {
      notedOpened = false;
    });
  }, [org]);

  const verify = async () => {
    setVerifying(true);
    const r = await verifyActivityAction({ org, itemId: item.id });
    setVerifying(false);
    if (!r.ok) return toast.error(r.error.message);
    setResult(r.data);
  };

  const entries = (data?.entries ?? []).filter(isItemEntry);
  const look: ActivityLookup = {
    ctx,
    field: (id) => data?.fields.find((f) => f.id === id),
    groupName: (id) => ctx.groups.get(id)?.name,
    displayId: (id) => ctx.item(id)?.displayId ?? data?.items.find((i) => i.id === id)?.displayId,
    personName: (id) => ctx.people.get(id)?.name,
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={verifying}
          onClick={() => void verify()}
        >
          <ShieldCheck aria-hidden /> {verifying ? 'Verifying…' : 'Verify audit trail'}
        </Button>
        <p role="status" className="text-13 m-0">
          {result ? (
            result.ok ? (
              <span className="text-good inline-flex items-center gap-1 font-semibold">
                <CircleCheck className="size-4" aria-hidden />
                Audit trail intact. {result.entries} {result.entries === 1 ? 'entry' : 'entries'}{' '}
                recomputed.
              </span>
            ) : (
              <span className="text-crit inline-flex items-center gap-1 font-semibold">
                <CircleX className="size-4" aria-hidden />
                Entry #{result.firstBadId} does not match. The audit trail was changed after it was
                written.
              </span>
            )
          ) : null}
        </p>
      </div>
      {state === 'loading' && !data ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading the activity log"
          className="flex flex-col gap-2"
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-soft h-10 animate-pulse rounded" />
          ))}
        </div>
      ) : state === 'error' && !data ? (
        <div role="alert" className="text-13 flex flex-col items-start gap-2">
          <p>The activity log could not be loaded.</p>
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground text-13">No activity yet.</p>
      ) : (
        <ol className="flex flex-col" aria-label="Activity log">
          {entries.map((e) => {
            const line = activityLine(e, look);
            return (
              <li key={e.id} className="border-line text-13 flex gap-2 border-t py-2">
                {e.actorKind === 'user' && e.actorId ? (
                  <Avatar id={e.actorId} ctx={ctx} size={22} />
                ) : (
                  <span className="bg-soft border-line text-12 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full border font-bold">
                    {line.who.slice(0, 1)}
                  </span>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="break-words">
                    <b>{line.who}</b> · {line.text}
                  </span>
                  <span className="text-muted-foreground text-12 font-mono">
                    {formatDateTime(e.at, ctx.timeZone)} · #{e.id} · hash {line.shortHash}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-muted-foreground text-12">
        Entries are hash-chained: each hash covers the one before it. Restoring an old value writes
        a new entry; history is never rewritten.
      </p>
    </div>
  );
}
