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
  Lock,
  EyeOff,
  Settings2,
  Sigma,
  Trash2,
  X,
} from 'lucide-react';
import { defaultSummary, SUMMARY_LABELS, summaryOptions, type SummaryFn } from '@/engine/summaries';
import type { Ctx, Field } from '@/engine/types';
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
import { systemColumnText } from '@/engine/packs/system';

export interface ColumnMenuActions {
  sort(dir: 'asc' | 'desc' | null): void;
  hide(): void;
  settings(): void;
  insert(side: 'left' | 'right'): void;
  duplicate(): void;
  move(by: -1 | 1): void;
  remove(): void;
  /** Show the column's group summary with this function, or hide it (null). */
  summary(fn: SummaryFn | null): void;
  resize(width: number, done: boolean): void;
}

/**
 * A column header of the Table (docs/05 §3.1), repeated at the top of every group card: small muted name, no type
 * icon; the reorder grip and the resize edge show on hover and focus. Menu (sort, hide, show or hide the group summary and choose its
 * function, settings, insert left/right, duplicate, move, delete), resize by dragging or with the arrow keys on the
 * edge, reorder by dragging the header.
 */
export function ColumnHeader({
  scope,
  field,
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
  /** The group card this header sits in: drag ids are unique per header row. */
  scope: string;
  field: Field;
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
  const editable = canEdit && (!field.locked || isAdmin);
  const drag = useDraggable({
    id: `col:${scope}:${field.id}`,
    data: { type: 'column', fieldId: field.id },
    disabled: !editable || dragDisabled,
  });
  const drop = useDroppable({
    id: `coldrop:${scope}:${field.id}`,
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
        'group/col border-b-surface-line border-r-col-line bg-head relative flex h-full items-center border-r border-b',
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
          className="text-muted-foreground hover:text-ink absolute top-0 left-0 z-[1] flex h-full w-3 cursor-grab items-center justify-center opacity-0 group-focus-within/col:opacity-100 group-hover/col:opacity-100"
        >
          <GripVertical className="size-3" />
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'hover:text-ink text-muted-foreground text-label-12 flex h-full min-w-0 items-center gap-1.5 pl-3 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-inset',
            // the system-column mark sits right after the name
            field.locked || field.system ? 'flex-initial pr-0' : 'flex-1 pr-[14px]',
          )}
          aria-label={`${field.name} column menu`}
        >
          <span className="truncate">{field.name}</span>
          {field.restrictedTo ? (
            <Lock className="size-3 shrink-0" aria-label="restricted field" />
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
          {summary ? (
            <>
              {options.length > 1 ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Sigma aria-hidden className="text-muted-foreground size-4" /> Summary
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={summary}
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
              <DropdownMenuItem onSelect={() => actions.summary(null)}>
                <Sigma aria-hidden /> Hide summary
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={() => actions.summary(defaultSummary(field, ctx))}>
              <Sigma aria-hidden /> Show summary
            </DropdownMenuItem>
          )}
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
              {!field.locked && !field.system ? (
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
      {field.system ? (
        <SystemMark text={systemColumnText([...ctx.fieldsByKey.values()])} />
      ) : field.locked ? (
        <LockedMark />
      ) : null}
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
          className="hover:bg-focus/40 focus-visible:bg-focus group-hover/col:bg-line absolute top-1.5 right-0 bottom-1.5 z-[1] w-1 cursor-col-resize rounded-full outline-none"
        />
      ) : null}
    </div>
  );
}

/** The lock after a locked field's name, with its explanation on hover and focus. */
function LockedMark() {
  const text = 'Kept by the app. You can hide it, not delete it.';
  return (
    <span className="group/lock relative mr-auto ml-[5px] inline-flex shrink-0">
      <span
        role="img"
        tabIndex={0}
        aria-label={text}
        className="focus-visible:outline-focus inline-flex rounded outline-offset-2 focus-visible:outline-2"
      >
        {/* the design's system-column mark: a small outlined square after the name */}
        <span
          aria-hidden
          className="text-faint inline-block h-2 w-[7px] rounded-[2px] border border-current"
        />
      </span>
      <span
        role="tooltip"
        className="bg-ink text-label-12 pointer-events-none absolute top-full right-0 z-20 mt-1 hidden w-52 rounded px-2 py-1 font-normal whitespace-normal text-white group-focus-within/lock:block group-hover/lock:block"
      >
        {text}
      </span>
    </span>
  );
}

/**
 * The lock after a system column's name (docs/11 Core registers): the standards that rely on it, on hover and focus.
 */
function SystemMark({ text }: { text: string }) {
  return (
    <span className="group/lock relative mr-auto ml-[5px] inline-flex shrink-0">
      <span
        role="img"
        tabIndex={0}
        aria-label={text}
        data-testid="system-column"
        className="focus-visible:outline-focus text-faint inline-flex rounded outline-offset-2 focus-visible:outline-2"
      >
        <Lock className="size-3" aria-hidden />
      </span>
      <span
        role="tooltip"
        className="bg-ink text-label-12 pointer-events-none absolute top-full right-0 z-20 mt-1 hidden w-56 rounded px-2 py-1 font-normal whitespace-normal text-white group-focus-within/lock:block group-hover/lock:block"
      >
        {text}
      </span>
    </span>
  );
}

const clampW = (w: number) => Math.max(60, Math.min(600, Math.round(w)));
