'use client';

import { useEffect, useId, useState } from 'react';
import type { Group, Item, Sheet } from '@/engine/types';
import { inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { byPosition, positionsAtEnd } from '@/components/grid/grid-model';
import type { SheetActions } from '@/components/grid/use-sheet';
import { cn } from '@/lib/utils';

// "+ New" outside the Grid (List, Kanban, Calendar): a name and a group, plus values the view fills in (the lane
// of a Kanban, the day of a Calendar). Saved through the createItem command.

export interface NewItemRequest {
  /** What the dialog says it prefills ("Status: Done", "Due date: 12 Nov 2026"). */
  note?: string;
  values?: Record<string, unknown>;
  groupId?: string | null;
}

export function NewItemDialog({
  request,
  onClose,
  sheet,
  groups,
  items,
  actions,
  onCreated,
}: {
  request: NewItemRequest | null;
  onClose(): void;
  sheet: Sheet;
  groups: Group[];
  items: Item[];
  actions: SheetActions;
  onCreated?(item: Item): void;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const sorted = [...groups].sort((a, b) => (a.position < b.position ? -1 : 1));
  useEffect(() => {
    if (!request) return;
    setName('');
    setError(null);
    setGroupId(
      request.groupId && groups.some((g) => g.id === request.groupId)
        ? request.groupId
        : (sorted[0]?.id ?? ''),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  const label = sheet.itemLabel.toLowerCase();
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogTitle className="text-lg font-bold">New {label}</DialogTitle>
        <DialogDescription className="text-muted-foreground text-sm">
          {request?.note ?? `Add a ${label} to this sheet.`}
        </DialogDescription>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return setError('A name is required.');
            if (!groupId) return setError('Choose a group.');
            setSaving(true);
            let position: string;
            try {
              const list = items.filter((i) => i.groupId === groupId).sort(byPosition);
              position = positionsAtEnd(list, 1)[0]!;
            } catch {
              setSaving(false);
              return setError(
                'The order of this group needs repair. Reload the sheet and try again.',
              );
            }
            onClose();
            const item = await actions.createItem(groupId, n, position, undefined, {
              values: request?.values,
            });
            setSaving(false);
            if (item) onCreated?.(item);
          }}
        >
          <label htmlFor={`${id}-name`} className="flex flex-col gap-1 text-sm font-semibold">
            Name
            <input
              id={`${id}-name`}
              autoFocus
              className={cn(inputClass, 'h-9 font-normal')}
              value={name}
              maxLength={500}
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {sorted.length > 1 ? (
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Group
              <select
                className={cn(inputClass, 'h-9 font-normal')}
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                {sorted.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {error ? (
            <p id={`${id}-error`} className="text-crit text-sm">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Add {label}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
