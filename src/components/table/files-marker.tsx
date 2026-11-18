'use client';

import { Paperclip } from 'lucide-react';
import { filesMarker } from '@/engine/item-files';
import type { Ctx, Item } from '@/engine/types';
import { requestPanelTab } from '@/components/item-panel/open-tab';
import { cn } from '@/lib/utils';

// The files marker on a row (docs/05 §3.1): a paperclip and the number of files and linked documents, next to the
// comment bubble. A red dot, and "expired" for screen readers, when any file has expired. Opens the item on its
// Files tab.

export function FilesMarker({
  item,
  ctx,
  onOpen,
}: {
  item: Item;
  ctx: Ctx;
  onOpen(item: Item): void;
}) {
  const m = filesMarker(item, ctx.fieldsOf(ctx.sheet.id), ctx);
  if (m.count <= 0) return null;
  return (
    <button
      type="button"
      tabIndex={-1}
      data-files={m.count}
      data-expired={m.expired || undefined}
      title={m.label}
      aria-label={`${m.label}. Open the Files tab`}
      className={cn(
        'text-ink bg-surface text-12 border-line-strong hover:bg-panel relative inline-flex h-[22px] min-w-[28px] shrink-0 items-center justify-center gap-[3px] rounded-full border px-1.5 font-mono font-semibold',
        m.expired && 'border-crit-line',
      )}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        requestPanelTab(item.id, 'files');
        onOpen(item);
      }}
    >
      <Paperclip className="size-3 shrink-0" aria-hidden />
      <span aria-hidden>{m.count}</span>
      {m.expired ? (
        <span aria-hidden className="bg-crit absolute -top-0.5 -right-0.5 size-2 rounded-full" />
      ) : null}
    </button>
  );
}
