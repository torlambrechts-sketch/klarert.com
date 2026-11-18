'use client';

import { hiddenFor } from '@/engine/values';
import { memo, useEffect, useRef } from 'react';
import { resolveFieldType } from '@/engine/fields/resolve';
import { readsSubitems, subitemLabel } from '@/engine/subitems';
import type { Ctx, Field, Item } from '@/engine/types';
import { fieldUI } from '@/components/fields/registry';
import { cellValue, editorPopoverClass } from '@/components/fields/shared';
import type { EditorProps } from '@/components/fields/types';
import type { SheetActions } from '@/components/grid/use-sheet';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// Cells shared by the Table's item rows and sub-item rows (docs/05 §3.1): the sticky lead, a value cell with its
// editor popover, and the ids the grid points at with aria-activedescendant.

export const cellId = (itemId: string, col: string) => `cell-${itemId}-${col}`;

const storageOf = (f: Field) => resolveFieldType(f.type)?.storage;

/** Read-only values whose editor only explains them (computed, files, buttons). */
export const explainOnly = (f: Field) => {
  const s = storageOf(f);
  return s === 'computed' || s === 'files' || s === 'none';
};

/** The sticky left part of a row: the leading controls and the name. */
export function Sticky({
  width,
  children,
  className,
  role = 'gridcell',
}: {
  width: number;
  children?: React.ReactNode;
  className?: string;
  /** Rows own only cells (ARIA grid): the sticky part is a cell of its own, or none when it wraps the name cell. */
  role?: 'gridcell' | 'none' | 'columnheader';
}) {
  return (
    <div
      role={role}
      className={cn(
        'bg-surface sticky left-0 z-[2] flex shrink-0 items-center',
        // once the table scrolls sideways, a plain 1 px line on the name column's edge (no shadow)
        'group-data-[scrolled-left=true]/grid:shadow-[inset_-1px_0_0_var(--line)]',
        className,
      )}
      style={{ width }}
    >
      {children}
    </div>
  );
}

export const TableCell = memo(function TableCell({
  item,
  field,
  ctx,
  left,
  width,
  selected,
  rowSelected,
  active,
  editing,
  seed,
  readOnly,
  canEdit,
  onMouseDown,
  onDoubleClick,
  onCommit,
  onCancel,
  actions,
  onOpenItem,
  editorProps,
}: {
  item: Item;
  field: Field;
  ctx: Ctx;
  left: number;
  width: number;
  selected: boolean;
  /** The row's checkbox is ticked. */
  rowSelected: boolean;
  active: boolean;
  editing: boolean;
  seed: string | null;
  readOnly: boolean;
  canEdit: boolean;
  onMouseDown(e: React.MouseEvent): void;
  onDoubleClick(e: React.MouseEvent): void;
  onCommit(item: Item, col: string, raw: unknown): void;
  onCancel(): void;
  actions: SheetActions;
  onOpenItem(item: Item): void;
  editorProps?: Pick<EditorProps, 'onAddOption' | 'onEditField'>;
}) {
  const ui = fieldUI(field.type);
  const value = cellValue(item, field, ctx);
  const def = resolveFieldType(field.type)!;
  // a restricted field the person may not see is not "missing": its value never reached them
  const missing =
    field.required &&
    def.storage === 'values' &&
    !hiddenFor(field, ctx) &&
    def.isEmpty(value as never);
  return (
    <div
      id={cellId(item.id, field.id)}
      role="gridcell"
      aria-selected={selected}
      aria-readonly={readOnly || undefined}
      aria-label={missing ? `${field.name}: required, empty` : undefined}
      // roll-ups over the sub-items are derived: say where they come from
      title={
        readsSubitems(field, ctx) ? `From ${subitemLabel(ctx.sheet).toLowerCase()}` : undefined
      }
      data-cell={`${item.id}|${field.id}`}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        'border-b-row-line border-r-col-line text-ink group-hover/row:bg-row-hover bg-surface text-14 absolute top-0 flex h-full items-center overflow-hidden border-r border-b px-[14px] hover:shadow-[inset_0_0_0_1px_var(--line-strong)] has-[[data-box]]:px-2 [&_[data-pill]]:-mx-1.5',
        (selected || rowSelected) && 'bg-sel group-hover/row:bg-sel',
        active && 'outline-focus z-[1] outline-2 -outline-offset-2',
      )}
      style={{ left, width }}
    >
      <ui.Cell
        value={value as never}
        field={field}
        item={item}
        ctx={ctx}
        density="table"
        active={active && !editing}
      />
      {missing ? (
        <span
          aria-hidden
          title="Required"
          className="absolute top-0 right-0 size-0 border-t-[7px] border-l-[7px] border-t-[var(--crit)] border-l-transparent"
        />
      ) : null}
      {editing ? (
        <CellEditor
          width={ui.editorWidth ?? Math.max(260, width)}
          onCancel={onCancel}
          seed={seed}
          editor={
            <ui.Editor
              value={value as never}
              field={field}
              item={item}
              ctx={ctx}
              onCommit={(v) => onCommit(item, field.id, v)}
              onCancel={onCancel}
              onCommitField={canEdit ? (fieldId, v) => onCommit(item, fieldId, v) : undefined}
              onButton={
                canEdit
                  ? () => {
                      onCancel();
                      void actions.clickButton(item, field);
                    }
                  : undefined
              }
              onOpenItem={() => {
                onCancel();
                onOpenItem(item);
              }}
              {...editorProps}
            />
          }
        />
      ) : null}
    </div>
  );
});

/**
 * The editor popover anchored to a cell. With a `seed` (the key typed on the cell), the editor's focused text box
 * starts with that character, as typing into a spreadsheet cell does.
 */
export function CellEditor({
  width,
  editor,
  onCancel,
  seed = null,
}: {
  width: number;
  editor: React.ReactNode;
  onCancel(): void;
  seed?: string | null;
}) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!seed) return;
    const frame = requestAnimationFrame(() => {
      const el = document.activeElement;
      if (!content.current?.contains(el)) return;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
      if (el instanceof HTMLInputElement && !['text', 'search', ''].includes(el.type)) return;
      if (el.value !== seed) {
        // set through the native setter so React sees the change
        const proto = el instanceof HTMLInputElement ? HTMLInputElement : HTMLTextAreaElement;
        Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(el, seed);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // carry on typing after the key, not over it
      el.setSelectionRange(seed.length, seed.length);
    });
    return () => cancelAnimationFrame(frame);
    // only when the editor opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Popover open onOpenChange={(o) => !o && onCancel()}>
      <PopoverAnchor asChild>
        <span className="absolute inset-0" aria-hidden />
      </PopoverAnchor>
      <PopoverContent
        ref={content}
        align="start"
        sideOffset={2}
        className={editorPopoverClass}
        style={{ width: Math.min(width, 420) }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onKeyDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {editor}
      </PopoverContent>
    </Popover>
  );
}
