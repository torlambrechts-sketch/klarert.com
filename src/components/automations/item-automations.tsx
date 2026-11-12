'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { describeTrigger } from '@/engine/automations';
import type { Ctx, Item } from '@/engine/types';
import { Switch } from '@/components/ui/switch';
import { setAutomationPauseAction } from '@/app/[org]/automations/actions';
import { useAutomations, usePauses } from './queries';

// "Automations on this item" (docs/05 §3.4, FR-34): the sheet's automations, each with a switch that pauses it for
// this item only (automation_pauses, logged on the item's chain). Editors pause, also on locked items: pausing
// changes no value.

export function ItemAutomations({
  org,
  item,
  ctx,
  canPause,
}: {
  org: string;
  item: Item;
  ctx: Ctx;
  canPause: boolean;
}) {
  const qc = useQueryClient();
  const autos = useAutomations(ctx.sheet.orgId);
  const pauses = usePauses(item.id);
  const [busy, setBusy] = useState<string | null>(null);
  const list = (autos.data ?? []).filter((a) => a.sheetId === item.sheetId);
  const headingId = `autos-${item.id}`;

  const set = async (automationId: string, name: string, paused: boolean) => {
    setBusy(automationId);
    const r = await setAutomationPauseAction({ org, automationId, itemId: item.id, paused });
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    toast.success(
      paused
        ? `“${name}” is paused for ${item.displayId}. It still runs on other items.`
        : `“${name}” runs on ${item.displayId} again.`,
    );
    await qc.invalidateQueries({ queryKey: ['automation-pauses', item.id] });
    void qc.invalidateQueries({ queryKey: ['item-activity', item.id] });
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <h3 id={headingId} className="text-label-13 m-0 font-extrabold">
        Automations on this item
      </h3>
      {autos.isError || pauses.isError ? (
        <p className="text-muted-foreground text-copy-13 m-0">
          Automations could not be loaded.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              void autos.refetch();
              void pauses.refetch();
            }}
          >
            Retry
          </button>
        </p>
      ) : autos.isPending || pauses.isPending ? (
        <div
          className="bg-soft h-8 animate-pulse rounded-md"
          aria-busy="true"
          aria-label="Loading"
        />
      ) : list.length === 0 ? (
        <p className="text-muted-foreground text-copy-13 m-0">
          No automations on this sheet.{' '}
          {canPause ? (
            <Link className="underline" href={`/${org}/automations?new=1&sheet=${item.sheetId}`}>
              Create one
            </Link>
          ) : null}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-labelledby={headingId}>
          {list.map((a) => {
            const paused = pauses.data.has(a.id);
            const state = !a.enabled
              ? 'Off for every item'
              : paused
                ? 'Paused for this item'
                : 'Runs';
            return (
              <li key={a.id} className="text-label-13 flex items-start gap-2">
                <Switch
                  className="mt-0.5"
                  checked={!paused}
                  disabled={!canPause || busy === a.id}
                  aria-label={`Run “${a.name}” on this item`}
                  onCheckedChange={(on) => void set(a.id, a.name, !on)}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold break-words">{a.name}</span>
                  <span className="text-muted-foreground text-label-12">
                    {state} · {describeTrigger(a.trigger, ctx)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
