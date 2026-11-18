import Link from 'next/link';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { Bar, HeatCell, WidgetLink, WidgetResult, WidgetRow } from '@/engine/dashboards';
import { Chip, solidVar } from '@/components/fields/shared';
import { TONE_FILL, ToneBadge } from '@/components/insights/tone';
import { cn } from '@/lib/utils';

// One widget's result (docs/05 §4, design "Compliance overview"). Rendered by result kind, never by widget type: a
// big number with its caption, labelled bars, rows (label, a quieter line, the value; an optional bar behind), a
// heatmap grid with its levels in words, or the problem in plain words. Key figures have their own card
// (key-figures.tsx).

export const linkHref = (org: string, link: WidgetLink | undefined): string | null =>
  !link
    ? null
    : link.to === 'sheet'
      ? `/${org}/s/${link.sheetId}`
      : link.to === 'evidence'
        ? `/${org}/evidence`
        : `/${org}/automations`;

/** The quiet text on the right of a card's heading: what the result says about itself, else the widget's scope. */
export const resultMeta = (result: WidgetResult | undefined): string | null =>
  result && (result.kind === 'rows' || result.kind === 'heatmap') ? result.meta : null;

export function WidgetBody({ result, org }: { result: WidgetResult | undefined; org: string }) {
  if (!result)
    return (
      <p className="text-muted-foreground text-13 m-0 p-4">This widget could not be loaded.</p>
    );
  if (result.kind === 'problem')
    return (
      <p className="text-muted-foreground text-13 m-0 flex items-start gap-1.5 p-4">
        <AlertTriangle className="text-warn mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{result.message} Edit or remove this widget.</span>
      </p>
    );
  if (result.kind === 'stat')
    return (
      <div className="flex flex-col gap-1 p-4">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'text-figure leading-none tabular-nums',
              result.tone === 'crit' && result.value > 0 && 'text-crit-ink',
            )}
          >
            {result.value}
          </span>
          {result.tone === 'crit' && result.value > 0 ? (
            <ToneBadge tone="crit" icon={AlertTriangle}>
              Needs action
            </ToneBadge>
          ) : null}
        </span>
        <span className="text-muted-foreground text-13">{result.caption}</span>
      </div>
    );
  if (result.kind === 'bars')
    return <Bars bars={result.bars} total={result.total} caption={result.caption} />;
  if (result.kind === 'rows') return <Rows result={result} org={org} />;
  if (result.kind === 'heatmap') return <Heatmap result={result} />;
  return null;
}

function Bars({ bars, total, caption }: { bars: Bar[]; total: number; caption: string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="flex flex-col gap-2.5 p-4">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {bars.map((b) => (
          <li
            key={b.key}
            className="text-13 grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] items-center gap-2.5"
          >
            <span className="min-w-0 truncate" title={b.label}>
              {b.option ? (
                <Chip option={b.option} className="max-w-full" />
              ) : (
                <span className="text-ink">{b.label}</span>
              )}
            </span>
            <span aria-hidden className="bg-soft h-2.5 overflow-hidden rounded-full">
              <span
                className={cn(
                  'block h-full rounded-full',
                  b.option ? '' : TONE_FILL[b.tone ?? 'neutral'],
                )}
                style={{
                  width: `${(b.value / max) * 100}%`,
                  ...(b.option ? { background: solidVar(b.option.color) } : {}),
                }}
              />
            </span>
            <span className="text-ink text-13 w-8 text-right font-mono tabular-nums">
              {b.value}
              <span className="sr-only"> of {total}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-13 m-0">{caption}</p>
    </div>
  );
}

function Rows({ result, org }: { result: Extract<WidgetResult, { kind: 'rows' }>; org: string }) {
  if (result.rows.length === 0)
    return (
      <p className="text-muted-foreground text-13 m-0 p-4">
        {result.empty ?? 'Nothing to show yet.'}
      </p>
    );
  return (
    <div className="flex flex-col gap-0.5 p-[8px]">
      {result.columns ? (
        <div
          aria-hidden
          className="text-muted-foreground text-12 flex justify-between px-[10px] pt-[4px] pb-[6px]"
        >
          <span>{result.columns[0]}</span>
          <span>{result.columns[1]}</span>
        </div>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {result.rows.map((r) => (
          <li key={r.key}>
            <RowLine row={r} href={linkHref(org, r.link)} column={result.columns?.[1]} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RowLine({ row, href, column }: { row: WidgetRow; href: string | null; column?: string }) {
  const filled = row.fill != null;
  const attention = (row.count ?? 0) > 0 && row.tone && row.tone !== 'neutral';
  const inner = (
    <>
      {filled ? (
        <i
          aria-hidden
          className="bg-soft group-hover:bg-soft absolute inset-y-1 left-0 rounded-[5px]"
          style={{ width: `${Math.max(0, Math.min(100, row.fill!))}%` }}
        />
      ) : null}
      <span className="text-14 relative flex min-w-0 flex-1 flex-col font-medium">
        <span className="truncate">{row.label}</span>
        <small
          className={cn(
            'text-12 truncate font-normal',
            filled ? 'text-muted-foreground' : 'text-muted-foreground',
          )}
        >
          {row.sub}
        </small>
      </span>
      <b className="text-14 relative font-mono font-medium tabular-nums">
        {column ? <span className="sr-only">{column}: </span> : null}
        {row.value}
        {attention ? <span className="sr-only"> (needs attention)</span> : null}
      </b>
      {!filled && href ? (
        <ChevronRight className="text-faint size-[15px] shrink-0" aria-hidden />
      ) : null}
    </>
  );
  const cls = cn(
    'group text-ink relative flex min-h-[48px] items-center gap-2.5 overflow-hidden rounded-md px-[10px] no-underline',
    !filled && href && 'hover:bg-soft',
  );
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** Heat fills by level rank (1 lowest … 4 highest): the shared heat tokens, fill and ink. */
const HEAT: Record<HeatCell['rank'], string> = {
  1: 'bg-h1 text-h1i',
  2: 'bg-h2 text-h2i',
  3: 'bg-h3 text-h3i',
  4: 'bg-h4 text-h4i',
};

function Heatmap({ result }: { result: Extract<WidgetResult, { kind: 'heatmap' }> }) {
  const { axes, size } = result;
  const cols = { gridTemplateColumns: `20px repeat(${size}, minmax(0, 1fr))` };
  return (
    <div className="flex flex-col p-[16px]">
      <div
        role="table"
        aria-label={`${axes.y} by ${axes.x.toLowerCase()}`}
        className="grid gap-[4px]"
        style={cols}
      >
        {result.rows.map((row) => (
          <div role="row" key={row[0]!.y} className="contents">
            <span
              role="rowheader"
              className="text-muted-foreground text-12 grid place-items-center font-mono"
            >
              <span className="sr-only">{axes.y} </span>
              {row[0]!.y}
            </span>
            {row.map((c) => (
              <span
                role="cell"
                key={c.x}
                title={`${axes.y} ${c.y} · ${axes.x.toLowerCase()} ${c.x}: ${c.count} · ${c.level}`}
                className={cn(
                  'text-14 grid aspect-[1.5/1] min-h-[36px] place-items-center rounded-md font-semibold tabular-nums',
                  c.count > 0 ? HEAT[c.rank] : 'bg-subtle',
                )}
              >
                <span className="sr-only">
                  {axes.x} {c.x}, {c.level}:{' '}
                </span>
                {c.count > 0 ? c.count : <span className="sr-only">0</span>}
              </span>
            ))}
          </div>
        ))}
        <div role="row" className="contents" aria-hidden>
          <span />
          {result.rows[0]!.map((c) => (
            <span
              key={c.x}
              className="text-muted-foreground text-12 grid h-[20px] place-items-center font-mono"
            >
              {c.x}
            </span>
          ))}
        </div>
      </div>
      <div className="text-muted-foreground text-12 mt-[12px] flex flex-wrap justify-between gap-2.5">
        <span>
          Rows: {axes.y.toLowerCase()} · Columns: {axes.x.toLowerCase()}
        </span>
        <ul className="m-0 flex list-none flex-wrap items-center gap-x-2.5 gap-y-1 p-0">
          {result.levels.map((l) => (
            <li key={l.rank} className="flex items-center gap-1">
              <i aria-hidden className={cn('size-2.5 rounded-[3px]', HEAT[l.rank])} />
              {l.label}
              <span className="text-muted-foreground font-mono tabular-nums">{l.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
