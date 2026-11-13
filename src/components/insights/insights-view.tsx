'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { ChevronDown, ChevronUp, LayoutGrid, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  addRow,
  addWidget,
  computeWidget,
  defaultLayout,
  duplicateWidget,
  layoutLabel,
  locate,
  moveRow,
  moveToAdjacentRow,
  moveToRow,
  moveWithinRow,
  openSlots,
  placeForNew,
  removeRow,
  removeWidget,
  replaceWidget,
  ROW_HEIGHTS,
  ROW_LAYOUTS,
  setRowHeight,
  setRowLayout,
  setSpan,
  sourceLine,
  stepSpan,
  widgetDef,
  widgetSource,
  widgetTitle,
  type Edit,
  type InsightRow,
  type InsightsLayout,
  type InsightWidget,
  type Span,
} from '@/engine/insights';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Item } from '@/engine/types';
import { useSheetsList } from '@/components/grid/use-sheet';
import type { ViewsState } from '@/components/views/use-views';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { InsightCard, MIN_HEIGHT, SPAN_CLASS } from './insight-card';
import { useInsightsData } from './use-insights-data';
import type { BodyActions, RowHeight } from './widget-body';
import { Segmented, WidgetEditor, type EditorState } from './widget-editor';

// The Insights view (docs/05 §3.6): rows of widget cards computed by the engine from the sheet's items (as the view
// shows them) and from other sheets. "Customize" edits the layout in place; changes go to the view's config through
// the view commands (a saved view I may change saves itself; on the built-in tab, Done saves it as a view).

const newId = (p: string) => `${p}${Math.random().toString(36).slice(2, 10)}`;

const headButton = 'h-9 text-label-13.5 font-medium [&_svg]:size-3.5';

export function InsightsView({
  org,
  data,
  ctx,
  items,
  views,
  env,
  onOpenItem,
  onSlice,
}: {
  org: string;
  data: SheetData;
  ctx: Ctx;
  /** The view's items: searched, filtered and in the chosen group. */
  items: Item[];
  views: ViewsState;
  env: { now: Date; timeZone: string; userId: string; isAdmin: boolean };
  onOpenItem(item: Item): void;
  /** A bar or segment was clicked: show the Table filtered to that value. */
  onSlice(fieldKey: string, key: string, label: string): void;
}) {
  const { active, config, setConfig } = views;
  const fallback = useMemo(() => {
    let n = 0;
    return defaultLayout({ sheet: data.sheet, fields: data.fields, ctx }, (p) => `d${p}${++n}`);
  }, [data.sheet, data.fields, ctx]);
  const layout: InsightsLayout = config.insights ?? fallback;
  const [edit, setEdit] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorSrc, setEditorSrc] = useState<string | undefined>(undefined);
  useEffect(() => {
    setEdit(false);
    setEditor(null);
  }, [active.id]);

  const setLayout = useCallback(
    (next: InsightsLayout) => setConfig((c) => ({ ...c, insights: next })),
    [setConfig],
  );
  const apply = (e: Edit) => {
    if (!e.ok) return void toast.error(e.error);
    setLayout(e.layout);
  };

  const sheets = useSheetsList(data.sheet.orgId);
  const insights = useInsightsData({
    data,
    ctx,
    items,
    layout,
    extra: editorSrc ? [editorSrc] : undefined,
    env,
  });
  const bodyActions: BodyActions = useMemo(
    () => ({
      org,
      onSlice,
      onOpenItem: (id) => {
        const it = data.items.find((x) => x.id === id);
        if (it) onOpenItem(it);
      },
    }),
    [org, onSlice, onOpenItem, data.items],
  );

  const saving = active.saved && active.canWrite;
  const finish = async () => {
    setEdit(false);
    if (saving || !views.unsaved) return;
    const shared = views.canShare && !active.saved;
    await views.create({
      name: shared ? 'Insights' : 'My insights',
      type: 'insights',
      shared,
      config,
    });
  };

  const openAdd = (rowId: string | null, span: Span) => {
    setEditorSrc(undefined);
    setEditor({
      mode: 'add',
      rowId,
      widget: { id: newId('w'), type: 'bars', span, filter: 'all' },
    });
  };
  const addFromToolbar = () => {
    const at = placeForNew(layout);
    openAdd(at.rowId, at.span);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    const from = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!over || over === from) return;
    if (over.startsWith('row:')) return apply(moveToRow(layout, from, over.slice(4), null, newId));
    const at = locate(layout, over);
    if (!at) return;
    apply(moveToRow(layout, from, layout.rows[at.row]!.id, at.index, newId));
  };

  const anyFilterable = layout.rows.some((r) =>
    r.widgets.some((w) => {
      const m = computeWidget(w, insights);
      return (m.kind === 'bars' || m.kind === 'donut') && m.filterable;
    }),
  );
  const empty = !layout.rows.some((r) => r.widgets.length);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-label-12 m-0">
          {anyFilterable && !edit ? 'Click a bar to filter the table' : null}
        </p>
        {edit ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className={headButton} onClick={addFromToolbar}>
              <Plus aria-hidden /> Add widget
            </Button>
            <Button
              type="button"
              variant="outline"
              className={headButton}
              onClick={() => setEdit(true)}
            >
              <LayoutGrid aria-hidden /> Customize
            </Button>
          </div>
        )}
      </div>

      {edit ? (
        <div
          role="region"
          aria-label="Editing layout"
          className="border-line bg-background-100 text-label-13 mb-4 flex flex-wrap items-center gap-2.5 rounded-xl border py-2 pr-2.5 pl-3.5 text-gray-900"
        >
          <LayoutGrid className="text-ink size-4" aria-hidden />
          <span>
            <b className="text-ink font-semibold">Editing layout.</b> Choose columns per row, resize
            with − and +.{' '}
            {saving
              ? 'Saved automatically.'
              : views.canShare && !active.saved
                ? 'Done saves it for everyone.'
                : 'Done saves it as your own view.'}
          </span>
          <span className="flex-1" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setLayout(defaultLayout({ sheet: data.sheet, fields: data.fields, ctx }, newId));
              toast('Layout reset to default.');
            }}
          >
            Reset to default
          </Button>
          <AddRowButton onPick={(plan) => apply(addRow(layout, plan, newId))} />
          <Button type="button" size="sm" onClick={() => void finish()}>
            Done
          </Button>
        </div>
      ) : null}

      {empty && !edit ? (
        <div className="border-line text-muted-foreground text-label-13.5 flex flex-col items-center gap-2 rounded-xl border border-dashed px-5 py-12 text-center">
          <b className="text-ink text-label-16 font-semibold">No widgets yet</b>
          <span>Build this view from this sheet or any sheet you can view.</span>
          <Button type="button" className="mt-2" onClick={addFromToolbar}>
            <Plus aria-hidden /> Add widget
          </Button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <div className="flex flex-col gap-4">
            {layout.rows.map((row, ri) =>
              !edit && !row.widgets.length ? null : (
                <RowFrame
                  key={row.id}
                  row={row}
                  index={ri}
                  count={layout.rows.length}
                  edit={edit}
                  onLayout={(plan) => apply(setRowLayout(layout, row.id, plan))}
                  onHeight={(h) => apply(setRowHeight(layout, row.id, h))}
                  onMove={(by) => apply(moveRow(layout, row.id, by))}
                  onRemove={() => {
                    apply(removeRow(layout, row.id));
                    toast('Row removed.');
                  }}
                >
                  <SortableContext
                    items={row.widgets.map((w) => w.id)}
                    strategy={rectSortingStrategy}
                  >
                    {row.widgets.map((w, wi) => (
                      <Card
                        key={w.id}
                        widget={w}
                        row={row}
                        index={wi}
                        rowIndex={ri}
                        layout={layout}
                        insights={insights}
                        org={org}
                        edit={edit}
                        bodyActions={bodyActions}
                        apply={apply}
                        onConfigure={() => {
                          setEditorSrc(w.src);
                          setEditor({ mode: 'edit', rowId: row.id, widget: structuredClone(w) });
                        }}
                      />
                    ))}
                  </SortableContext>
                  {edit
                    ? openSlots(row).map((span, i) => (
                        <button
                          key={`slot-${i}`}
                          type="button"
                          onClick={() => openAdd(row.id, span)}
                          className={cn(
                            'border-line-strong text-muted-foreground hover:text-ink hover:bg-background-100 text-label-13 col-span-12 flex items-center justify-center gap-1.5 rounded-xl border border-dashed font-medium hover:border-gray-600',
                            SPAN_CLASS[span],
                            MIN_HEIGHT[row.height ?? 'm'],
                          )}
                        >
                          <Plus className="size-4" aria-hidden /> Add widget
                        </button>
                      ))
                    : null}
                </RowFrame>
              ),
            )}
          </div>
        </DndContext>
      )}

      <WidgetEditor
        state={editor}
        data={insights}
        sheets={(sheets.data ?? []).map((s) => ({ id: s.id, name: s.name }))}
        bodyActions={bodyActions}
        onSourceChange={setEditorSrc}
        onClose={() => setEditor(null)}
        onRemove={(id) => {
          apply(removeWidget(layout, id));
          setEditor(null);
          toast('Widget removed.');
        }}
        onSave={(s) => {
          const e =
            s.mode === 'add'
              ? addWidget(layout, s.rowId, s.widget, newId)
              : replaceWidget(layout, s.widget);
          if (!e.ok) return void toast.error(e.error);
          setLayout(e.layout);
          setEditor(null);
          toast(s.mode === 'add' ? 'Widget added.' : 'Widget updated.');
        }}
      />
    </div>
  );
}

function Card({
  widget: w,
  row,
  index,
  rowIndex,
  layout,
  insights,
  org,
  edit,
  bodyActions,
  apply,
  onConfigure,
}: {
  widget: InsightWidget;
  row: InsightRow;
  index: number;
  rowIndex: number;
  layout: InsightsLayout;
  insights: ReturnType<typeof useInsightsData>;
  org: string;
  edit: boolean;
  bodyActions: BodyActions;
  apply(e: Edit): void;
  onConfigure(): void;
}) {
  const def = widgetDef(w.type);
  const src = widgetSource(w, insights);
  const source = src && src !== 'loading' ? src : undefined;
  const other = !def.static && w.src && w.src !== insights.current.sheet.id;
  return (
    <InsightCard
      widget={w}
      title={widgetTitle(w, insights)}
      sourceLine={def.static ? null : sourceLine(w, source, def.showsFilter)}
      sourceHref={other ? `/${org}/s/${w.src}` : null}
      model={computeWidget(w, insights)}
      height={row.height ?? 'm'}
      edit={edit}
      moves={{ left: index > 0, right: index < row.widgets.length - 1, up: rowIndex > 0 }}
      bodyActions={bodyActions}
      on={{
        configure: onConfigure,
        duplicate: () => apply(duplicateWidget(layout, w.id, newId)),
        move: (dir) =>
          apply(
            dir === 'left' || dir === 'right'
              ? moveWithinRow(layout, w.id, dir === 'left' ? -1 : 1)
              : moveToAdjacentRow(layout, w.id, dir === 'up' ? -1 : 1, newId),
          ),
        setSpan: (span) => apply(setSpan(layout, w.id, span)),
        step: (by) => apply(stepSpan(layout, w.id, by)),
        remove: () => {
          apply(removeWidget(layout, w.id));
          toast('Widget removed.');
        },
      }}
    />
  );
}

/** A small picture of a column layout: one bar per column, as wide as its share. */
function LayoutGlyph({ plan }: { plan: readonly number[] }) {
  return (
    <span aria-hidden className="flex h-3 w-[26px] gap-0.5">
      {plan.map((s, i) => (
        <i key={i} className="rounded-[2px] bg-current" style={{ flex: s }} />
      ))}
    </span>
  );
}

function AddRowButton({ onPick }: { onPick(plan: readonly Span[]): void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Plus aria-hidden /> Add row
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[232px] p-1.5">
        <p className="text-muted-foreground text-label-12 m-0 px-2 pt-1 pb-1.5 font-medium">
          Columns in the new row
        </p>
        <div role="group" aria-label="Columns in the new row" className="flex flex-col">
          {ROW_LAYOUTS.map((plan) => (
            <button
              key={plan.join('-')}
              type="button"
              className="hover:bg-soft text-label-13 flex h-8 items-center gap-2.5 rounded-md px-2 text-left"
              onClick={() => {
                setOpen(false);
                onPick(plan);
              }}
            >
              <span className="text-muted-foreground">
                <LayoutGlyph plan={plan} />
              </span>
              {layoutLabel(plan)}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RowFrame({
  row,
  index,
  count,
  edit,
  onLayout,
  onHeight,
  onMove,
  onRemove,
  children,
}: {
  row: InsightRow;
  index: number;
  count: number;
  edit: boolean;
  onLayout(plan: readonly Span[]): void;
  onHeight(h: RowHeight): void;
  onMove(by: -1 | 1): void;
  onRemove(): void;
  children: React.ReactNode;
}) {
  const drop = useDroppable({ id: `row:${row.id}`, disabled: !edit });
  const sig = row.widgets.map((w) => w.span).join('-');
  const current = ROW_LAYOUTS.find((l) => l.join('-') === sig) ?? null;
  return (
    <div
      ref={drop.setNodeRef}
      role={edit ? 'group' : undefined}
      aria-label={edit ? `Row ${index + 1}` : undefined}
      className={cn(
        'flex flex-col gap-2.5',
        edit && 'bg-subtle rounded-[14px] border border-dashed border-gray-400 px-3 pt-2.5 pb-3',
        edit && drop.isOver && 'border-gray-700',
      )}
    >
      {edit ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-label-12-mono mr-1 font-medium">
            Row {index + 1}
          </span>
          <span
            role="group"
            aria-label="Columns"
            className="bg-soft inline-flex gap-0.5 rounded-lg p-0.5"
          >
            {ROW_LAYOUTS.map((plan) => {
              const on = current === plan;
              return (
                <button
                  key={plan.join('-')}
                  type="button"
                  aria-pressed={on}
                  aria-label={`Layout ${layoutLabel(plan)}`}
                  title={layoutLabel(plan)}
                  onClick={() => onLayout(plan)}
                  className={cn(
                    'inline-flex h-[26px] min-w-[30px] items-center justify-center rounded-md px-2',
                    on
                      ? 'bg-background-100 text-ink shadow-tooltip'
                      : 'text-muted-foreground hover:text-ink [&_i]:opacity-50',
                  )}
                >
                  <LayoutGlyph plan={plan} />
                </button>
              );
            })}
          </span>
          <Segmented
            label="Row height"
            value={row.height ?? 'm'}
            choices={ROW_HEIGHTS.map((h) => ({
              value: h.id,
              label: h.label,
              name: `Row height ${h.name.toLowerCase()}`,
            }))}
            onChange={onHeight}
          />
          <span className="flex-1" />
          <RowButton label="Move row up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ChevronUp aria-hidden />
          </RowButton>
          <RowButton label="Move row down" disabled={index >= count - 1} onClick={() => onMove(1)}>
            <ChevronDown aria-hidden />
          </RowButton>
          <RowButton label="Delete row" onClick={onRemove}>
            <Trash2 aria-hidden />
          </RowButton>
        </div>
      ) : null}
      <div className="grid grid-cols-12 gap-4">{children}</div>
    </div>
  );
}

function RowButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="text-muted-foreground hover:bg-soft hover:text-ink inline-flex size-7 items-center justify-center rounded-md disabled:cursor-default disabled:bg-transparent disabled:opacity-35 [&_svg]:size-4"
    >
      {children}
    </button>
  );
}
