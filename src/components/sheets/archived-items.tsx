'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { archiveItemsAction } from '@/app/[org]/s/grid-actions';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/engine/fields/helpers';

export type ArchivedItem = { id: string; displayId: string; name: string; archivedAt: string };

/**
 * FR-13: archived items are hidden from views, search and automations. They are listed here and can be restored
 * (the activity log records both). Restoring goes through the archive command like the grid's Undo.
 */
export function ArchivedItems({
  org,
  sheetId,
  items,
}: {
  org: string;
  sheetId: string;
  items: ArchivedItem[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (items.length === 0)
    return (
      <p className="text-muted-foreground text-13">
        No archived items. Archive items from the Grid by selecting them.
      </p>
    );
  return (
    <ul className="divide-line flex flex-col divide-y" aria-label="Archived items">
      {items.map((it) => (
        <li key={it.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-semibold">{it.name}</span>
            <span className="text-muted-foreground text-12">
              <span className="font-mono">{it.displayId}</span> · archived{' '}
              {formatDate(it.archivedAt.slice(0, 10))}
            </span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy === it.id}
            aria-label={`Restore ${it.name}`}
            onClick={async () => {
              setBusy(it.id);
              let r;
              try {
                r = await archiveItemsAction({ org, sheetId, itemIds: [it.id], archived: false });
              } catch {
                r = null;
              }
              setBusy(null);
              if (!r?.ok)
                return void toast.error(r ? r.error.message : 'Restoring failed. Try again.');
              if (r.data.skipped.length) return void toast.error(r.data.skipped[0]!.message);
              toast(`${it.displayId} restored.`);
              router.refresh();
            }}
          >
            <RotateCcw aria-hidden /> Restore
          </Button>
        </li>
      ))}
    </ul>
  );
}
