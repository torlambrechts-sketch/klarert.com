'use client';

import { useState } from 'react';
import { ChevronRight, FileStack } from 'lucide-react';
import { isSubitemDone, subitemLabel } from '@/engine/subitems';
import type { Item } from '@/engine/types';
import { fieldUI } from '@/components/fields/registry';
import { cellValue } from '@/components/fields/shared';
import { positionAt } from '@/components/table/table-model';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ProgressChip } from './progress-chip';
import { listFields } from './subitems-tab';
import type { SubitemsState } from './use-subitems';

// Sub-items on a phone card (docs/05 §5): the "3/5" chip opens a nested list of 44 px rows (tap opens the sub-item)
// and "Add". The card's own tap target stays the item's name.

export function CardSubitems({
  parent,
  parentSheetId,
  sub,
  canEdit,
  expanded,
  onToggle,
  onOpen,
}: {
  parent: Item;
  parentSheetId: string;
  sub: SubitemsState;
  canEdit: boolean;
  expanded: boolean;
  onToggle(): void;
  onOpen(item: Item): void;
}) {
  const [name, setName] = useState('');
  const { data, ctx, actions } = sub;
  const parentSheet = ctx.sheetOf(parent.id) ?? { subitems: null };
  const label = subitemLabel(parentSheet);
  const one = subitemLabel(parentSheet, 1).toLowerCase();
  const list = data.items
    .filter((i) => i.parentId === parent.id)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  const done = list.filter((c) => isSubitemDone(c, ctx)).length;
  const cols = listFields(data.fields, ctx).slice(0, 2);
  const id = `card-sub-${parent.id}`;
  return (
    <div className="relative z-[1] flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={onToggle}
        className="focus-visible:outline-focus flex min-h-11 w-fit items-center gap-1.5 rounded-md focus-visible:outline-2"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'text-muted-foreground size-4 transition-transform',
            expanded && 'rotate-90',
          )}
        />
        {list.length ? (
          <ProgressChip total={list.length} done={done} label={label} />
        ) : (
          <span className="text-muted-foreground text-label-12">No {label.toLowerCase()} yet</span>
        )}
        <span className="sr-only">
          {expanded ? 'Hide' : 'Show'} {label.toLowerCase()}
        </span>
      </button>
      {expanded ? (
        <div id={id} className="border-line flex flex-col rounded-md border">
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={c.id.startsWith('temp-')}
              onClick={() => onOpen(c)}
              className="border-line hover:bg-subtle focus-visible:outline-focus flex min-h-11 items-center gap-2 border-b px-2 text-left last:border-b-0 focus-visible:outline-2"
            >
              <span className="text-muted-foreground text-label-12-mono shrink-0">
                {c.displayId}
              </span>
              <span className="text-label-13 min-w-0 flex-1 truncate">{c.name}</span>
              {cols.map((f) => {
                const ui = fieldUI(f.type);
                return (
                  <span
                    key={f.id}
                    className="relative flex max-w-[96px] shrink-0 items-center overflow-hidden"
                  >
                    <ui.Cell
                      value={cellValue(c, f, ctx) as never}
                      field={f}
                      item={c}
                      ctx={ctx}
                      density="list"
                    />
                  </span>
                );
              })}
            </button>
          ))}
          {canEdit ? (
            <div className="flex items-center gap-1 p-1">
              <input
                className="placeholder:text-muted-foreground text-label-13 focus-visible:outline-focus h-11 min-w-0 flex-1 rounded px-2 focus-visible:outline-2"
                placeholder={`+ Add ${one}`}
                aria-label={`Add ${one} to ${parent.displayId}`}
                value={name}
                maxLength={500}
                enterKeyHint="done"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const n = name.trim();
                  if (!n) return;
                  setName('');
                  void actions.createSubitem(parent.id, n, positionAt(list, list.length));
                }}
              />
              {list.length === 0 && (parentSheet.subitems?.template.length ?? 0) > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11"
                  onClick={() => void actions.subitemsFromTemplate(parentSheetId, parent.id)}
                >
                  <FileStack aria-hidden /> From template
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
