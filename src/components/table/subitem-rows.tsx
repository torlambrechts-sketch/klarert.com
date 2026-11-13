'use client';

import { memo, useState } from 'react';
import { ArrowRightLeft, Archive, ExternalLink, FileStack, MoreHorizontal } from 'lucide-react';
import type { Ctx, Field, Item } from '@/engine/types';
import type { EditorProps } from '@/components/fields/types';
import type { CellRef } from '@/components/grid/grid-store';
import type { SheetActions } from '@/components/grid/use-sheet';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { cellId, explainOnly, Sticky, TableCell } from './table-cells';
import type { TableRow } from './table-model';

// Sub-item rows of the Table (docs/05 §3.1): under an expanded parent, a muted column header with the sub-items'
// own fields, indented rows on a left spine, a note when there are none and "+ Add". Sub-items are full rows: cells
// edit inline, the name opens the item, and "…" opens, moves to another parent or archives.

export type SubRowAction = 'open' | 'move' | 'archive';

/** Everything the sub-item rows share; built once per render of the Table. */
export interface SubRowContext {
  /** The sheet's word for its sub-items ("Actions") and one of them ("Action"). */
  label: string;
  one: string;
  ctx: Ctx;
  fields: Field[];
  widthOf(f: Field): number;
  actions: SheetActions;
  canEdit: boolean;
  isAdmin: boolean;
  canEditItem(item: Item): boolean;
  hasTemplate: boolean;
  onOpen(item: Item): void;
  onCommit(item: Item, col: string, raw: unknown): void;
  onCancel(): void;
  fieldProps(field: Field): Pick<EditorProps, 'onAddOption' | 'onEditField'>;
  onMouseDown(e: React.MouseEvent): void;
  onDoubleClick(e: React.MouseEvent): void;
  onAdd(parent: Item, name: string): Promise<void>;
  onFromTemplate(parent: Item): void;
  onAction(item: Item, action: SubRowAction): void;
}

interface Common {
  sub: SubRowContext;
  stickyW: number;
  active: CellRef | null;
  editing: CellRef | null;
  seed: string | null;
  menuOpen: boolean;
  setMenu(itemId: string | null): void;
}

/** x of each sub-item column, after the sticky part. */
function offsets(sub: SubRowContext, stickyW: number) {
  let x = stickyW;
  return sub.fields.map((f) => {
    const w = sub.widthOf(f);
    const at = { field: f, left: x, width: w };
    x += w;
    return at;
  });
}

const subAddId = (parentId: string) => `subadd-${parentId}`;
export { subAddId };

/** The left spine: a line down the indent and an elbow to the row. */
function Spine({ last }: { last: boolean }) {
  return (
    <span aria-hidden className="relative h-full w-[58px] shrink-0">
      <span
        className={cn('bg-line-strong absolute left-[30px] w-px', last ? 'top-0 h-1/2' : 'inset-y-0')}
      />
      <span className="bg-line-strong absolute top-1/2 left-[30px] h-px w-[14px]" />
    </span>
  );
}

export function SubHeaderRow({ sub, stickyW }: Common & { row: Extract<TableRow, { kind: 'subheader' }> }) {
  return (
    <>
      <Sticky width={stickyW} role="columnheader" className="bg-subtle border-b-soft border-b">
        <span aria-hidden className="relative h-full w-[58px] shrink-0">
          <span className="bg-line-strong absolute top-1/2 bottom-0 left-[30px] w-px" />
        </span>
        <span className="text-muted-foreground text-label-12 truncate">{sub.label}</span>
      </Sticky>
      {offsets(sub, stickyW).map(({ field, left, width }) => (
        <div
          key={field.id}
          role="columnheader"
          className="bg-subtle border-b-soft text-muted-foreground text-label-12 absolute top-0 flex h-full items-center truncate border-b px-[14px]"
          style={{ left, width }}
        >
          <span className="truncate">{field.name}</span>
        </div>
      ))}
    </>
  );
}

export const SubItemRow = memo(function SubItemRow(
  p: Common & { row: Extract<TableRow, { kind: 'subitem' }> },
) {
  const { sub, row } = p;
  const item = row.item;
  const editable = sub.canEditItem(item);
  const isActive = (col: string) => p.active?.itemId === item.id && p.active.col === col;
  const isEditing = (col: string) => p.editing?.itemId === item.id && p.editing.col === col;
  const cols = offsets(sub, p.stickyW);
  const end = cols.at(-1) ? cols.at(-1)!.left + cols.at(-1)!.width : p.stickyW;
  const temp = item.id.startsWith('temp-');
  return (
    <>
      <Sticky
        width={p.stickyW}
        role="none"
        className={cn('border-b-line group-hover/row:bg-subtle border-b', row.match && 'bg-sel')}
      >
        <div
          id={cellId(item.id, 'name')}
          role="gridcell"
          aria-readonly={!editable || undefined}
          data-cell={`${item.id}|name`}
          data-subitem={row.parent.id}
          onMouseDown={sub.onMouseDown}
          onDoubleClick={sub.onDoubleClick}
          className={cn(
            'relative flex h-full w-full min-w-0 cursor-default items-center pr-[14px]',
            isActive('name') && 'outline-focus z-[1] outline-2 -outline-offset-2',
          )}
        >
          <Spine last={row.last} />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {temp ? (
              <span className="text-ink text-label-13 truncate">{item.name}</span>
            ) : (
              <button
                type="button"
                tabIndex={-1}
                title={`Open ${item.displayId}`}
                className="text-ink text-label-13 min-w-0 truncate text-left hover:underline"
                onMouseDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.currentTarget.focus();
                  sub.onOpen(item);
                }}
              >
                {item.name}
              </button>
            )}
            <span className="text-muted-foreground text-label-12-mono shrink-0">
              {item.displayId}
            </span>
            {sub.actions.held.has(item.id) ? (
              <button
                type="button"
                tabIndex={-1}
                className="border-line text-ink text-label-12 shrink-0 rounded-full border px-1.5 leading-4 font-semibold"
                title="Actions run when you finish this row"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  void sub.actions.finishItem(item.id);
                }}
              >
                Done
                <span className="sr-only">: actions run when you finish this row</span>
              </button>
            ) : null}
            {isEditing('name') ? (
              <NameEditor item={item} sub={sub} seed={p.seed} />
            ) : null}
          </span>
        </div>
      </Sticky>
      {cols.map(({ field, left, width }) => {
        const editing = isEditing(field.id);
        return (
          <TableCell
            key={field.id}
            item={item}
            field={field}
            ctx={sub.ctx}
            left={left}
            width={width}
            selected={false}
            rowSelected={row.match}
            active={isActive(field.id)}
            editing={editing}
            seed={editing ? p.seed : null}
            readOnly={!editable || explainOnly(field)}
            onMouseDown={sub.onMouseDown}
            onDoubleClick={sub.onDoubleClick}
            onCommit={sub.onCommit}
            onCancel={sub.onCancel}
            actions={sub.actions}
            canEdit={editable}
            editorProps={editing ? sub.fieldProps(field) : undefined}
            onOpenItem={sub.onOpen}
          />
        );
      })}
      <div
        role="gridcell"
        className="border-b-line bg-background-100 group-hover/row:bg-subtle absolute top-0 flex h-full items-center border-b pl-1"
        style={{ left: end, width: 44 }}
      >
        {temp ? null : (
          <DropdownMenu
            open={p.menuOpen}
            onOpenChange={(o) => p.setMenu(o ? item.id : null)}
          >
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                tabIndex={-1}
                aria-label={`Actions for ${item.displayId} ${item.name}`}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                document
                  .querySelector<HTMLElement>('[role="grid"]')
                  ?.focus({ preventScroll: true });
              }}
            >
              <DropdownMenuItem onSelect={() => sub.onAction(item, 'open')}>
                <ExternalLink aria-hidden /> Open
              </DropdownMenuItem>
              {editable ? (
                <>
                  <DropdownMenuItem onSelect={() => sub.onAction(item, 'move')}>
                    <ArrowRightLeft aria-hidden /> Move to another item
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => sub.onAction(item, 'archive')}>
                    <Archive aria-hidden /> Archive
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </>
  );
});

/** The name editor of a sub-item: a text box committed with Enter. */
function NameEditor({ item, sub, seed }: { item: Item; sub: SubRowContext; seed: string | null }) {
  const [v, setV] = useState(seed ?? item.name);
  return (
    <input
      autoFocus
      aria-label={`${sub.one} name`}
      className="border-focus text-label-13 bg-background-100 absolute inset-y-1 right-2 left-[58px] z-[3] rounded border-2 px-2 outline-none"
      value={v}
      maxLength={500}
      onChange={(e) => setV(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          sub.onCommit(item, 'name', v);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          sub.onCancel();
        }
      }}
      onBlur={() => sub.onCommit(item, 'name', v)}
    />
  );
}

export function SubEmptyRow({
  sub,
  stickyW,
  row,
}: Common & { row: Extract<TableRow, { kind: 'subempty' }> }) {
  return (
    <Sticky width={stickyW} className="border-b-line border-b">
      <span aria-hidden className="relative h-full w-[58px] shrink-0">
        <span className="bg-line-strong absolute inset-y-0 left-[30px] w-px" />
      </span>
      <span className="text-muted-foreground text-label-13 flex min-w-0 items-center gap-2">
        No {sub.label.toLowerCase()} yet.
        {sub.canEdit && sub.hasTemplate ? (
          <Button
            type="button"
            variant="link"
            className="text-label-13 h-auto p-0"
            onClick={() => sub.onFromTemplate(row.parent)}
          >
            <FileStack aria-hidden /> From template
          </Button>
        ) : null}
      </span>
    </Sticky>
  );
}

export function SubAddRow({ sub, stickyW, row }: Common & { row: Extract<TableRow, { kind: 'subadd' }> }) {
  const [name, setName] = useState('');
  const label = sub.one.toLowerCase();
  return (
    <Sticky width={stickyW} className="border-b-line border-b">
      <span aria-hidden className="relative h-full w-[58px] shrink-0">
        <span className="bg-line-strong absolute top-0 left-[30px] h-1/2 w-px" />
        <span className="bg-line-strong absolute top-1/2 left-[30px] h-px w-[14px]" />
      </span>
      <input
        id={subAddId(row.parent.id)}
        className="placeholder:text-muted-foreground text-ink text-label-13 h-full min-w-0 flex-1 bg-transparent px-[4px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-inset"
        placeholder={`+ Add ${label}`}
        aria-label={`Add ${label} to ${row.parent.displayId} ${row.parent.name}`}
        value={name}
        maxLength={500}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            setName('');
            void sub.onAdd(row.parent, n);
          } else if (e.key === 'Escape') {
            setName('');
            document.querySelector<HTMLElement>('[role="grid"]')?.focus({ preventScroll: true });
          }
        }}
      />
      {sub.hasTemplate && sub.canEdit ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-label-12 mr-2 h-7 shrink-0"
          onClick={() => sub.onFromTemplate(row.parent)}
        >
          <FileStack aria-hidden /> From template
        </Button>
      ) : null}
    </Sticky>
  );
}
