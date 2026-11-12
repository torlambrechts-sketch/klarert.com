'use client';

import { useState } from 'react';
import type { Item } from '@/engine/types';
import { inputClass } from '@/components/fields/shared';
import type { SheetActions } from '@/components/grid/use-sheet';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

/** Ask for the reason, then lock the items that are not locked yet (row menu and bulk actions). */
export function LockDialog({
  items,
  actions,
  onClose,
}: {
  /** Null: closed. */
  items: Item[] | null;
  actions: SheetActions;
  onClose(): void;
}) {
  const [reason, setReason] = useState('');
  const n = items?.length ?? 0;
  return (
    <Dialog open={!!items} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle className="text-heading-16">
          Lock {n === 1 ? 'this item' : `${n} items`}
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-label-13">
          Only owners and admins can change a locked item. Everyone sees the lock and the reason.
        </DialogDescription>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            (items ?? [])
              .filter((i) => !i.locked)
              .forEach((it) => void actions.lockItem(it, true, reason.trim()));
            setReason('');
            onClose();
          }}
        >
          <label className="text-label-13 flex flex-col gap-1 font-semibold">
            Reason
            <input
              className={inputClass}
              maxLength={200}
              value={reason}
              placeholder="Approved by QA"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Lock</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
