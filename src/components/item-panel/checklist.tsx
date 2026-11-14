'use client';

import { useQuery } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { checklistAction } from '@/app/[org]/s/panel-actions';
import type { LinkConfig } from '@/engine/fields/link';
import type { ChecklistRow } from '@/engine/item-panel';
import type { Ctx, Field, Item } from '@/engine/types';
import { Bang, Chip } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// A link field shown as a checklist section on the item (docs/05 §3.4, `config.panel: 'checklist'`): each linked
// item with its status (words and a mark, never colour alone) and the fields the link field names. Data, not a
// supplier special case: the supplier register's requirement checks use it. Rows stack as cards at 390 px.

export function ChecklistSection({
  org,
  item,
  field,
  ctx,
  onOpen,
}: {
  org: string;
  item: Item;
  field: Field;
  ctx: Ctx;
  onOpen(target: { id: string; sheetId: string; displayId: string }): void;
}) {
  const cfg = field.config as Partial<LinkConfig>;
  // refetch when the links change (a sync added checks, a check was opened and changed)
  const linkSig = ctx.links(item.id, field.id).join(',');
  const q = useQuery({
    queryKey: ['checklist', org, item.id, field.id, linkSig, item.updatedAt],
    queryFn: async (): Promise<ChecklistRow[]> => {
      const r = await checklistAction({ org, itemId: item.id, fieldId: field.id });
      if (!r.ok) throw new Error(r.error.message);
      return r.data.rows;
    },
    staleTime: 10_000,
  });
  const headingId = `checklist-${field.id}-${item.id}`;
  const rows = q.data ?? [];
  const done = rows.filter((r) => r.status?.done).length;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2" data-testid="checklist">
      <h3 id={headingId} className="text-heading-14 m-0">
        {field.name}
        {q.data ? (
          <span className="text-muted-foreground font-normal">
            {' '}
            · {done} of {rows.length} {rows.length === 1 ? 'is' : 'are'} done
          </span>
        ) : null}
      </h3>
      {q.isPending ? (
        <div aria-busy="true" aria-label={`Loading ${field.name}`} className="flex flex-col gap-1">
          <div className="bg-soft h-11 animate-pulse rounded-lg" />
          <div className="bg-soft h-11 animate-pulse rounded-lg" />
        </div>
      ) : q.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2">
          <p className="text-copy-13 m-0">{q.error.message}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void q.refetch()}>
            <RotateCcw aria-hidden /> Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-copy-13 m-0">
          {cfg.panelEmpty || `Nothing is linked in ${field.name} yet.`}
        </p>
      ) : (
        <ul aria-label={field.name} className="m-0 flex list-none flex-col gap-1 p-0">
          {rows.map((r) => (
            <li
              key={r.id}
              className="border-line text-label-13 flex flex-col gap-1.5 rounded-lg border px-3 py-2 min-[560px]:flex-row min-[560px]:flex-wrap min-[560px]:items-center min-[560px]:gap-3"
            >
              <span className="shrink-0 min-[560px]:w-[150px]">
                {r.status ? (
                  <Chip option={r.status} />
                ) : (
                  <span className="text-muted-foreground">No status</span>
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col min-[560px]:min-w-[180px]">
                <button
                  type="button"
                  className="text-left font-medium hover:underline"
                  onClick={() => onOpen(r)}
                >
                  {r.name}
                </button>
                <span className="text-muted-foreground text-label-12-mono">{r.displayId}</span>
              </span>
              {r.cells.length ? (
                <dl className="m-0 flex flex-wrap gap-x-4 gap-y-1">
                  {r.cells.map((c) => (
                    <div key={c.key} className="flex min-w-0 items-center gap-1">
                      <dt className="text-muted-foreground">{c.name}:</dt>
                      <dd
                        className={cn(
                          'm-0 flex items-center gap-1',
                          c.expired && 'text-crit-ink font-medium',
                        )}
                      >
                        {c.expired ? <Bang /> : null}
                        {c.text || '—'}
                        {c.expired ? <span> (expired)</span> : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
