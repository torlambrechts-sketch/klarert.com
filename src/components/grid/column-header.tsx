'use client';

import { useRef } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  ArrowDownAZ,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpAZ,
  ChevronLeft,
  ChevronRight,
  Copy,
  GripVertical,
  EyeOff,
  Lock,
  Settings2,
  Sigma,
  Trash2,
  X,
} from 'lucide-react';
import { SUMMARY_LABELS, summaryOptions, type SummaryFn } from '@/engine/summaries';
import type { Ctx, Field } from '@/engine/types';
import { fieldUI } from '@/components/fields/registry';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface ColumnMenuActions {
  sort(dir: 'asc' | 'desc' | null): void;
  hide(): void;
  settings(): void;
  insert(side: 'left' | 'right'): void;
  duplicate(): void;
  move(by: -1 | 1): void;
  remove(): void;
  summary(fn: SummaryFn): void;
  resize(width: number, done: boolean): void;
}

/**
 * A column header (docs/05 §3.2): menu (sort, hide, settings, insert left/right, duplicate, move, summary, delete),
 * resize by dragging or with the arrow keys on the edge, reorder by dragging the header.
 */
export function ColumnHeader({
  field,
  groupId,
  width,
  ctx,
  canEdit,
  isAdmin,
  sorted,
  summary,
  first,
  last,
  actions,
  dragDisabled,
}: {
  field: Field;
  groupId: string;
  width: number;
  ctx: Ctx;
  canEdit: boolean;
  isAdmin: boolean;
  sorted: 'asc' | 'desc' | null;
  summary: SummaryFn | undefined;
  first: boolean;
  last: boolean;
  actions: ColumnMenuActions;
  dragDisabled: boolean;
}) {
  const Icon = fieldUI(field.type).icon;
  const editable = canEdit && (!field.locked || isAdmin);
  const drag = useDraggable({
    id: `col:${groupId}:${field.id}`,
    data: { type: 'column', fieldId: field.id },
    disabled: !editable || dragDisabled,
  });
  const drop = useDroppable({
    id: `coldrop:${groupId}:${field.id}`,
    data: { type: 'column', fieldId: field.id },
  });
  const startX = useRef(0);
  const startW = useRef(width);
  const options = summaryOptions(field, ctx);

  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startX.current = e.clientX;
    startW.current = width;
    const move = (ev: PointerEvent) =>
      actions.resize(clampW(startW.current + ev.clientX - startX.current), false);
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      actions.resize(clampW(startW.current + ev.clientX - startX.current), true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      ref={drop.setNodeRef}
      role="columnheader"
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
      className={cn(
        'border-line relative flex h-full items-center border-r border-b bg-white',
        drop.isOver && !drag.isDragging && 'bg-sel',
        drag.isDragging && 'opacity-50',
      )}
    >
      {editable && !dragDisabled ? (
        <span
          ref={drag.setNodeRef}
          {...drag.listeners}
          aria-hidden
          title={`Drag to reorder ${field.name}`}
          className="text-muted-foreground hover:text-ink flex h-full w-3 shrink-0 cursor-grab items-center justify-center"
        >
          <GripVertical className="size-3" />
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="hover:bg-soft flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-inset"
          aria-label={`${field.name} column menu`}
        >
          <Icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{field.name}</span>
          {field.locked ? (
            <span title="Kept by the app. You can hide it, not delete it." className="shrink-0">
              <Lock className="size-3" aria-hidden />
              <span className="sr-only">(kept by the app)</span>
            </span>
          ) : null}
          {sorted ? (
            sorted === 'asc' ? (
              <ArrowDownAZ className="size-3.5 shrink-0" aria-label="sorted A to Z" />
            ) : (
              <ArrowUpAZ className="size-3.5 shrink-0" aria-label="sorted Z to A" />
            )
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onSelect={() => actions.sort('asc')}>
            <ArrowDownAZ aria-hidden /> Sort A to Z
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.sort('desc')}>
            <ArrowUpAZ aria-hidden /> Sort Z to A
          </DropdownMenuItem>
          {sorted ? (
            <DropdownMenuItem onSelect={() => actions.sort(null)}>
              <X aria-hidden /> Clear sort
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={actions.hide}>
            <EyeOff aria-hidden /> Hide
          </DropdownMenuItem>
          {options.length > 1 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Sigma aria-hidden className="text-muted-foreground size-4" /> Summary
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={summary ?? options[0]}
                  onValueChange={(v) => actions.summary(v as SummaryFn)}
                >
                  {options.map((o) => (
                    <DropdownMenuRadioItem key={o} value={o}>
                      {SUMMARY_LABELS[o]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          <DropdownMenuItem onSelect={actions.settings}>
            <Settings2 aria-hidden /> {editable ? 'Settings' : 'About this field'}
          </DropdownMenuItem>
          {canEdit ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => actions.insert('left')}>
                <ArrowLeftToLine aria-hidden /> Insert left
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.insert('right')}>
                <ArrowRightToLine aria-hidden /> Insert right
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={actions.duplicate}>
                <Copy aria-hidden /> Duplicate
              </DropdownMenuItem>
              {editable ? (
                <>
                  <DropdownMenuItem disabled={first} onSelect={() => actions.move(-1)}>
                    <ChevronLeft aria-hidden /> Move left
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={last} onSelect={() => actions.move(1)}>
                    <ChevronRight aria-hidden /> Move right
                  </DropdownMenuItem>
                </>
              ) : null}
              {!field.locked ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={actions.remove}>
                    <Trash2 aria-hidden /> Delete
                  </DropdownMenuItem>
                </>
              ) : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {editable ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${field.name}`}
          aria-valuenow={width}
          aria-valuemin={60}
          aria-valuemax={600}
          tabIndex={0}
          onPointerDown={onResizeDown}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              e.stopPropagation();
              actions.resize(clampW(width + (e.key === 'ArrowRight' ? 10 : -10)), false);
            }
          }}
          onKeyUp={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') actions.resize(width, true);
          }}
          className="hover:bg-focus/40 focus-visible:bg-focus absolute top-0 right-0 z-[1] h-full w-1.5 cursor-col-resize outline-none"
        />
      ) : null}
    </div>
  );
}

const clampW = (w: number) => Math.max(60, Math.min(600, Math.round(w)));
