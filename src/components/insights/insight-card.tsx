'use client';

import Link from 'next/link';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  ExternalLink,
  GripVertical,
  MoreHorizontal,
  Settings2,
  Trash2,
} from 'lucide-react';
import {
  SPANS,
  spanLabel,
  type InsightModel,
  type InsightWidget,
  type Span,
} from '@/engine/insights';
import { Button } from '@/components/ui/button';
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
import { WidgetBody, type BodyActions, type RowHeight } from './widget-body';

// One widget card (docs/05 §3.6): title and source line, the widget menu, and in edit mode a drag handle and the − / +
// width steps. Cards span their share of the row's 12 columns; below 860 px every card takes the full width.

export const SPAN_CLASS: Record<number, string> = {
  3: 'min-[860px]:col-span-3',
  4: 'min-[860px]:col-span-4',
  6: 'min-[860px]:col-span-6',
  8: 'min-[860px]:col-span-8',
  9: 'min-[860px]:col-span-9',
  12: 'min-[860px]:col-span-12',
};

export const MIN_HEIGHT: Record<RowHeight, string> = {
  s: 'min-h-[128px]',
  m: 'min-h-[300px]',
  l: 'min-h-[430px]',
};

/** Bodies that read top-down (lists of rows); the others sit centred in the card. */
const TOP_ALIGNED = new Set<InsightModel['kind']>(['bars', 'list']);

export interface CardMoves {
  left: boolean;
  right: boolean;
  up: boolean;
}

export interface CardHandlers {
  configure(): void;
  duplicate(): void;
  move(dir: 'left' | 'right' | 'up' | 'down'): void;
  setSpan(span: Span): void;
  step(by: -1 | 1): void;
  remove(): void;
}

export function InsightCard({
  widget,
  title,
  sourceLine,
  sourceHref,
  model,
  height,
  edit,
  moves,
  on,
  bodyActions,
}: {
  widget: InsightWidget;
  title: string;
  /** "This sheet · Open items" or the other sheet's name; null for notes. */
  sourceLine: string | null;
  /** The other sheet, when the widget reads one. */
  sourceHref: string | null;
  model: InsightModel;
  height: RowHeight;
  edit: boolean;
  moves: CardMoves;
  on: CardHandlers;
  bodyActions: BodyActions;
}) {
  const sortable = useSortable({ id: widget.id, disabled: !edit });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };
  return (
    <section
      ref={sortable.setNodeRef}
      style={style}
      aria-label={title}
      data-widget={widget.type}
      className={cn(
        'border-line bg-background-100 col-span-12 flex min-w-0 flex-col rounded-xl border',
        SPAN_CLASS[widget.span],
        MIN_HEIGHT[height],
        sortable.isDragging && 'shadow-menu relative z-10 opacity-90',
      )}
    >
      <div className="flex items-start gap-2 pt-4 pr-3.5 pb-1 pl-5">
        {edit ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-ink -ml-3 flex h-5 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm"
            aria-label={`Move ${title}`}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical className="size-3.5" aria-hidden />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="text-label-14 m-0 truncate font-semibold tracking-[-0.01em]">{title}</h3>
          {sourceLine ? (
            <p className="text-muted-foreground text-label-12.5 m-0 mt-[3px] flex min-w-0 items-center">
              {sourceHref ? (
                <Link
                  href={sourceHref}
                  className="hover:text-ink inline-flex min-w-0 items-center gap-[5px] hover:underline hover:underline-offset-2"
                  title="Open sheet"
                >
                  <ExternalLink className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{sourceLine}</span>
                </Link>
              ) : (
                <span className="truncate">{sourceLine}</span>
              )}
            </p>
          ) : null}
        </div>
        <div className="-mt-1 flex items-center gap-1">
          {edit ? (
            <span className="border-line bg-background-100 inline-flex h-[26px] items-center rounded-md border">
              <button
                type="button"
                className="text-muted-foreground hover:text-ink text-label-14 size-6"
                aria-label={`Narrower (${title})`}
                title="Narrower"
                onClick={() => on.step(-1)}
              >
                −
              </button>
              <b
                className="text-label-11-mono min-w-8 text-center font-medium"
                aria-label={`Width ${spanLabel(widget.span)}`}
              >
                {spanLabel(widget.span)}
              </b>
              <button
                type="button"
                className="text-muted-foreground hover:text-ink text-label-14 size-6"
                aria-label={`Wider (${title})`}
                title="Wider"
                onClick={() => on.step(1)}
              >
                +
              </button>
            </span>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="text-muted-foreground hover:text-ink size-7 p-0"
                aria-label={`Widget options: ${title}`}
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[232px]">
              <DropdownMenuItem onSelect={on.configure}>
                <Settings2 aria-hidden /> Configure…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={on.duplicate}>
                <Copy aria-hidden /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!moves.left} onSelect={() => on.move('left')}>
                <ArrowLeft aria-hidden /> Move left
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!moves.right} onSelect={() => on.move('right')}>
                <ArrowRight aria-hidden /> Move right
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!moves.up} onSelect={() => on.move('up')}>
                <ArrowUp aria-hidden /> Move to row above
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => on.move('down')}>
                <ArrowDown aria-hidden /> Move to row below
              </DropdownMenuItem>
              {sourceHref ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href={sourceHref}>
                      <ExternalLink aria-hidden /> Open {sourceLine?.split(' · ')[0]}
                    </Link>
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Width: {spanLabel(widget.span)}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={String(widget.span)}
                    onValueChange={(v) => on.setSpan(Number(v) as Span)}
                  >
                    {SPANS.map((x) => (
                      <DropdownMenuRadioItem key={x.span} value={String(x.span)}>
                        {x.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={on.remove}>
                <Trash2 aria-hidden /> Remove widget
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col px-5 pt-2.5 pb-[18px]',
          TOP_ALIGNED.has(model.kind) ? 'justify-start' : 'justify-center',
        )}
      >
        <WidgetBody model={model} height={height} actions={bodyActions} />
      </div>
    </section>
  );
}
