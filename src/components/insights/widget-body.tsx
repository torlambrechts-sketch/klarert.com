'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import type {
  BarsModel,
  ColumnsModel,
  DonutModel,
  InsightModel,
  ListModel,
  ProgressModel,
  Slice,
} from '@/engine/insights';
import { colorVar, OptionDot } from '@/components/fields/shared';
import { cn } from '@/lib/utils';

// One Insights widget's body (docs/05 §3.6), drawn from its render model by kind, never by widget type. Colour is
// monochrome except option colours; every bar, column and segment has its words and number as text.

export type RowHeight = 's' | 'm' | 'l';

/** Monochrome steps for slices without an option colour (donut segments), darkest first. */
const SHADES = [
  'var(--gray-1000)',
  'var(--gray-900)',
  'var(--gray-600)',
  'var(--gray-400)',
  'var(--gray-300)',
];

const sliceFill = (s: Slice, mono: 'ink' | 'shade') =>
  s.color ? colorVar(s.color) : mono === 'ink' ? 'var(--gray-1000)' : SHADES[s.shade]!;

export interface BodyActions {
  /** Filter the Table to a value (only widgets reading the view's own sheet). */
  onSlice?(fieldKey: string, key: string, label: string): void;
  /** Open an item of the view's own sheet. */
  onOpenItem?(itemId: string): void;
  org: string;
}

export function WidgetBody({
  model,
  height,
  actions,
  preview,
}: {
  model: InsightModel;
  height: RowHeight;
  actions: BodyActions;
  /** Inside the editor's preview: nothing is clickable. */
  preview?: boolean;
}) {
  const act = preview ? { org: actions.org } : actions;
  switch (model.kind) {
    case 'figure':
      return (
        <div className="flex flex-col">
          <b
            className={cn(
              'text-heading-32 leading-[1.1] font-semibold tabular-nums',
              model.alert && 'text-crit',
            )}
          >
            {model.display}
          </b>
          <span className="text-muted-foreground text-label-12.5 mt-0.5">{model.caption}</span>
        </div>
      );
    case 'bars':
      return <BarList model={model} actions={act} />;
    case 'donut':
      return <Donut model={model} height={height} actions={act} />;
    case 'columns':
      return <Columns model={model} height={height} />;
    case 'progress':
      return <Progress model={model} />;
    case 'list':
      return <ItemList model={model} actions={act} />;
    case 'note':
      return model.text ? (
        <p className="text-copy-14 text-gray-1000 m-0 [text-wrap:pretty] whitespace-pre-wrap">
          {model.text}
        </p>
      ) : (
        <p className="text-muted-foreground text-copy-13 m-0">
          Write a note in the widget settings.
        </p>
      );
    case 'message':
      return <p className="text-muted-foreground text-copy-13 m-0">{model.message}</p>;
    case 'unavailable':
      return (
        <div className="text-muted-foreground text-label-12.5 flex flex-col items-center gap-1 text-center">
          <Lock className="size-[18px]" aria-hidden />
          <b className="text-ink text-label-13.5 font-semibold">No access</b>
          <span>This sheet no longer exists or you cannot see it.</span>
        </div>
      );
    case 'loading':
      return (
        <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-2">
          {[80, 60, 70].map((w) => (
            <span
              key={w}
              className="bg-soft h-3 animate-pulse rounded"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      );
  }
}

/** A bar or legend row: a button that filters the Table when the widget reads this sheet, else plain. */
function SliceRow({
  className,
  slice,
  fieldKey,
  fieldName,
  actions,
  filterable,
  children,
}: {
  className: string;
  slice: Slice;
  fieldKey: string;
  fieldName: string;
  actions: BodyActions;
  filterable: boolean;
  children: React.ReactNode;
}) {
  const onSlice = filterable ? actions.onSlice : undefined;
  if (!onSlice) return <div className={className}>{children}</div>;
  return (
    <button
      type="button"
      className={cn(className, 'hover:bg-soft cursor-pointer')}
      title={`Show ${fieldName.toLowerCase()} ${slice.label} in the table`}
      onClick={() => onSlice(fieldKey, slice.key, slice.label)}
    >
      {children}
    </button>
  );
}

function Swatch({ fill }: { fill: string }) {
  return <i aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: fill }} />;
}

function BarList({ model, actions }: { model: BarsModel; actions: BodyActions }) {
  return (
    <ul
      className="m-0 flex list-none flex-col gap-1 p-0"
      aria-label={`Items by ${model.fieldName.toLowerCase()}`}
    >
      {model.slices.map((s) => {
        const fill = sliceFill(s, 'ink');
        return (
          <li key={s.key}>
            <SliceRow
              className="text-ink -mx-2 grid w-[calc(100%+16px)] grid-cols-[minmax(90px,150px)_minmax(0,1fr)_36px] items-center gap-3 rounded-md px-2 py-1.5 text-left"
              slice={s}
              fieldKey={model.fieldKey}
              fieldName={model.fieldName}
              actions={actions}
              filterable={model.filterable}
            >
              <span className="text-label-13 flex min-w-0 items-center gap-2 font-medium">
                <Swatch fill={fill} />
                <span className="truncate">{s.label}</span>
              </span>
              <span aria-hidden className="bg-soft h-2.5 overflow-hidden rounded">
                <i
                  className="block h-full rounded"
                  style={{
                    width: `${s.value ? Math.max(2, (s.value / model.max) * 100) : 0}%`,
                    background: fill,
                  }}
                />
              </span>
              <b className="text-label-12.5-mono text-right font-medium tabular-nums">
                {s.value.toLocaleString('en-GB')}
              </b>
            </SliceRow>
          </li>
        );
      })}
    </ul>
  );
}

const DONUT_SIZE: Record<RowHeight, string> = {
  s: 'size-[76px]',
  m: 'size-[150px]',
  l: 'size-[220px]',
};
const R = 15.915;

function Donut({
  model,
  height,
  actions,
}: {
  model: DonutModel;
  height: RowHeight;
  actions: BodyActions;
}) {
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className={cn('relative shrink-0', DONUT_SIZE[height])}>
        <svg viewBox="0 0 42 42" aria-hidden className="size-full -rotate-90">
          <circle r={R} cx="21" cy="21" fill="none" stroke="var(--soft)" strokeWidth="5" />
          {model.slices
            .filter((s) => s.value > 0)
            .map((s) => {
              const p = (s.value / (model.total || 1)) * 100;
              const el = (
                <circle
                  key={s.key}
                  r={R}
                  cx="21"
                  cy="21"
                  fill="none"
                  strokeWidth="5"
                  stroke={sliceFill(s, 'shade')}
                  strokeDasharray={`${p.toFixed(2)} ${(100 - p).toFixed(2)}`}
                  strokeDashoffset={(-offset).toFixed(2)}
                />
              );
              offset += p;
              return el;
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <b
            className={cn(
              'font-semibold tabular-nums',
              height === 's' ? 'text-label-16' : 'text-heading-20',
            )}
          >
            {model.totalDisplay}
          </b>
          {height === 's' ? null : (
            <span className="text-muted-foreground text-label-11">{model.caption}</span>
          )}
        </div>
      </div>
      <ul
        className="m-0 flex min-w-[150px] flex-1 list-none flex-col gap-0.5 p-0"
        aria-label={`${model.totalDisplay} ${model.caption} by ${model.fieldName.toLowerCase()}`}
      >
        {model.slices.map((s) => (
          <li key={s.key}>
            <SliceRow
              className="text-ink text-label-13 -mx-1.5 grid w-[calc(100%+12px)] grid-cols-[8px_minmax(0,1fr)_auto_38px] items-center gap-2 rounded-md px-1.5 py-[5px] text-left"
              slice={s}
              fieldKey={model.fieldKey}
              fieldName={model.fieldName}
              actions={actions}
              filterable={model.filterable}
            >
              <Swatch fill={sliceFill(s, 'shade')} />
              <span className="truncate">{s.label}</span>
              <b className="text-label-12.5-mono font-medium tabular-nums">
                {s.value.toLocaleString('en-GB')}
              </b>
              <em className="text-muted-foreground text-label-12-mono text-right not-italic">
                {s.percent}%
              </em>
            </SliceRow>
          </li>
        ))}
      </ul>
    </div>
  );
}

const PLOT: Record<RowHeight, string> = { s: 'h-[60px]', m: 'h-[170px]', l: 'h-[300px]' };

function Columns({ model, height }: { model: ColumnsModel; height: RowHeight }) {
  const words = model.columns.map((c) => `${c.name}: ${c.value}`).join(', ');
  return (
    <figure
      className="m-0"
      role="img"
      aria-label={`Items per month by ${model.fieldName.toLowerCase()}. ${words}.`}
    >
      <div
        className={cn(
          'border-line flex items-end gap-2.5 border-b px-1',
          'bg-[repeating-linear-gradient(to_top,transparent_0,transparent_44px,var(--soft)_44px,var(--soft)_45px)]',
          PLOT[height],
        )}
      >
        {model.columns.map((c) => (
          <div
            key={c.key}
            title={`${c.name}: ${c.value}`}
            className="flex h-full min-w-3.5 flex-1 flex-col items-center justify-end"
          >
            <b className="text-muted-foreground text-label-11-mono mb-1 font-medium tabular-nums">
              {c.value}
            </b>
            <i
              className="bg-gray-1000 block min-h-0.5 w-[70%] max-w-9 rounded-t"
              style={{ height: `${Math.max(1, (c.value / model.max) * 86)}%` }}
            />
          </div>
        ))}
      </div>
      <div aria-hidden className="flex gap-2.5 px-1">
        {model.columns.map((c) => (
          <span
            key={c.key}
            className="text-muted-foreground text-label-11 min-w-3.5 flex-1 truncate pt-1.5 text-center"
          >
            {c.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

function Progress({ model }: { model: ProgressModel }) {
  return (
    <div>
      <div className="flex flex-col">
        <b className="text-heading-32 leading-[1.1] font-semibold tabular-nums">{model.percent}%</b>
        <span className="text-muted-foreground text-label-12.5 mt-0.5">
          {model.done} of {model.total} completed
        </span>
      </div>
      <div
        role="img"
        aria-label={`By ${model.fieldName.toLowerCase()}: ${model.segments.map((s) => `${s.label} ${s.value}`).join(', ') || 'no items'}`}
        className="bg-soft mt-3 mb-2.5 flex h-2.5 gap-0.5 overflow-hidden rounded-full"
      >
        {model.segments.map((s) => (
          <i
            key={s.key}
            className="block h-full"
            title={`${s.label}: ${s.value}`}
            style={{ flex: s.value, background: colorVar(s.color) }}
          />
        ))}
      </div>
      <ul
        aria-hidden
        className="text-muted-foreground text-label-12 m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1.5 p-0"
      >
        {model.segments.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <Swatch fill={colorVar(s.color)} />
            {s.label} · {s.value}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ItemList({ model, actions }: { model: ListModel; actions: BodyActions }) {
  if (!model.rows.length)
    return <p className="text-muted-foreground text-copy-13 m-0">No items.</p>;
  const open = model.current ? actions.onOpenItem : undefined;
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="text-label-13 w-full border-collapse">
        <thead>
          <tr>
            <th className="text-muted-foreground text-label-12 border-line border-b pr-2 pb-2 text-left font-medium whitespace-nowrap">
              Item
            </th>
            {model.columns.map((c) => (
              <th
                key={c.key}
                className="text-muted-foreground text-label-12 border-line border-b px-2 pb-2 text-left font-medium whitespace-nowrap"
              >
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((r) => (
            <tr
              key={r.itemId}
              className={cn('hover:[&>td]:bg-subtle', open && 'cursor-pointer')}
              onClick={open ? () => open(r.itemId) : undefined}
            >
              <td className="border-soft max-w-[220px] border-b py-2 pr-2 [tr:last-child>&]:border-0">
                {open ? (
                  <button
                    type="button"
                    className="block max-w-full truncate text-left font-medium"
                    onClick={(e) => {
                      e.stopPropagation();
                      open(r.itemId);
                    }}
                  >
                    {r.name}
                  </button>
                ) : !model.current && actions.onOpenItem ? (
                  <Link
                    href={`/${actions.org}/s/${model.sheetId}?item=${encodeURIComponent(r.displayId)}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {r.name}
                  </Link>
                ) : (
                  <b className="block truncate font-medium">{r.name}</b>
                )}
                <small className="text-muted-foreground text-label-11.5-mono block">
                  {r.displayId}
                </small>
              </td>
              {r.cells.map((c, i) => (
                <td
                  key={model.columns[i]!.key}
                  className="border-soft max-w-[220px] truncate border-b px-2 py-2 whitespace-nowrap [tr:last-child>&]:border-0"
                >
                  {c.option ? (
                    <span className="inline-flex items-center gap-1.5">
                      <OptionDot option={c.option} />
                      {c.text}
                    </span>
                  ) : c.text ? (
                    c.text
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {model.more > 0 ? (
        <p className="text-muted-foreground text-label-12 m-0 pt-2">+{model.more} more</p>
      ) : null}
    </div>
  );
}
