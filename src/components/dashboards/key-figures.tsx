'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpRight, Minus } from 'lucide-react';
import type { Figure, WidgetResult } from '@/engine/dashboards';
import { formatDate } from '@/engine/fields/helpers';
import { cn } from '@/lib/utils';
import { linkHref } from './widget-card';

// Key figures (design "Compliance overview", the top card): one tab per figure (label, value, change over the period
// with an arrow and words), then the chosen figure's line over the months. The chart is drawn for the eye; the same
// points are in a table for screen readers, and every change is said in words, not by colour alone.

const DELTA_TONE = {
  good: 'text-good',
  crit: 'text-crit-ink',
  warn: 'text-warn',
  neutral: 'text-muted-foreground',
} as const;

const DELTA_ICON = { up: ArrowUp, down: ArrowDown, flat: Minus } as const;

/** The top of the chart's scale and its four steps. */
function scaleOf(f: Figure): { max: number; ticks: number[] } {
  const top = Math.max(0, ...f.series.map((p) => p.value));
  if (f.unit === 'percent') {
    const max = Math.min(100, Math.max(20, Math.ceil(top / 20) * 20));
    return { max, ticks: [0, 1, 2, 3, 4].map((i) => (max / 4) * i) };
  }
  const raw = Math.max(1, top) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const s = Math.max(1, Math.ceil(step));
  return { max: s * 4, ticks: [0, 1, 2, 3, 4].map((i) => s * i) };
}

export function KeyFigures({
  result,
  title,
  org,
  menu,
}: {
  result: Extract<WidgetResult, { kind: 'figures' }>;
  title: string;
  org: string;
  /** The widget's options menu (editors). */
  menu?: React.ReactNode;
}) {
  const headingId = useId();
  const [chosen, setChosen] = useState(0);
  const figures = result.figures;
  const f = figures[Math.min(chosen, figures.length - 1)];
  const unit = (v: number, fig: Figure) => (fig.unit === 'percent' ? `${v}%` : String(v));

  return (
    <section
      aria-labelledby={headingId}
      className="border-line bg-surface overflow-hidden rounded-lg border"
    >
      <h2 id={headingId} className="sr-only">
        {title}
      </h2>
      {!f ? (
        <div className="flex items-start justify-between gap-3 p-5">
          <p className="text-muted-foreground text-13 m-0">
            {result.empty ?? 'Nothing to show yet.'}
          </p>
          {menu}
        </div>
      ) : (
        <>
          <div
            role="group"
            aria-label={`${title}: choose a figure`}
            className="border-line grid grid-cols-2 border-b md:grid-cols-[repeat(var(--n),minmax(0,1fr))]"
            style={{ '--n': figures.length } as React.CSSProperties}
          >
            {figures.map((fig, i) => {
              const on = fig === f;
              const Icon = DELTA_ICON[fig.delta.direction];
              return (
                <button
                  key={fig.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setChosen(i)}
                  className={cn(
                    'border-line relative flex min-w-0 flex-col items-start gap-[6px] border-r px-[20px] pt-[16px] pb-[18px] text-left outline-offset-[-2px] max-md:border-b max-md:even:border-r-0 md:last:border-r-0',
                    on
                      ? 'text-ink bg-surface after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-[var(--ink)]'
                      : 'bg-subtle text-muted-foreground hover:bg-soft',
                  )}
                >
                  <span className="text-13 max-w-full truncate font-medium">{fig.label}</span>
                  <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                    <b
                      className={cn(
                        'text-figure leading-none tabular-nums',
                        on ? 'text-ink' : 'text-ink',
                      )}
                    >
                      {fig.display}
                    </b>
                    <em
                      className={cn(
                        'text-12 inline-flex items-center gap-0.5 font-mono font-medium not-italic',
                        DELTA_TONE[fig.delta.tone],
                      )}
                    >
                      <Icon className="size-3" aria-hidden />
                      <span aria-hidden>{fig.delta.text}</span>
                      <span className="sr-only">{fig.delta.spoken}</span>
                    </em>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="px-[20px] pt-[16px] pb-[14px]">
            <div className="text-muted-foreground text-13 mb-[12px] flex items-center justify-between gap-3">
              <span className="min-w-0">
                {f.note}
                <span className="sr-only"> · {result.period}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {linkHref(org, f.link) ? (
                  <Link
                    href={linkHref(org, f.link)!}
                    className="text-muted-foreground hover:text-ink inline-flex items-center gap-1 no-underline"
                  >
                    Open sheet
                    <ArrowUpRight className="size-[13px]" aria-hidden />
                  </Link>
                ) : null}
                {menu}
              </span>
            </div>
            <Chart figure={f} />
            <table className="sr-only">
              <caption>
                {f.label} by month, {result.period}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">{f.label}</th>
                </tr>
              </thead>
              <tbody>
                {f.series.map((p) => (
                  <tr key={p.date}>
                    <th scope="row">{formatDate(p.date)}</th>
                    <td>{unit(p.value, f)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Chart({ figure: f }: { figure: Figure }) {
  const { max, ticks } = scaleOf(f);
  const n = f.series.length;
  const x = (i: number) => (n <= 1 ? 1000 : (i / (n - 1)) * 1000);
  const y = (v: number) => 240 - (v / max) * 240;
  const pts = f.series.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  const every = n > 6 ? 2 : 1;
  return (
    <div aria-hidden className="relative mb-[26px] ml-[44px] h-[260px] max-sm:h-[200px]">
      {ticks
        .slice()
        .reverse()
        .map((t, i, all) => (
          <div
            key={t}
            className={cn(
              'absolute inset-x-0 border-t',
              i === all.length - 1 ? 'border-line border-solid' : 'border-line border-dashed',
            )}
            style={{ top: `${(i / (all.length - 1)) * 100}%` }}
          >
            <span className="text-muted-foreground text-12 absolute -top-2 right-full mr-2.5 font-mono whitespace-nowrap">
              {f.unit === 'percent' ? `${t}%` : t}
            </span>
          </div>
        ))}
      <svg
        viewBox="0 0 1000 240"
        preserveAspectRatio="none"
        className="absolute inset-0 size-full overflow-visible"
      >
        {n > 1 ? (
          <path d={`M0,240 L${pts.join(' L')} L1000,240Z`} fill="var(--ink)" fillOpacity={0.045} />
        ) : null}
        <polyline
          points={n > 1 ? pts.join(' ') : `0,${y(f.value)} 1000,${y(f.value)}`}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>
      <div className="absolute inset-x-0 top-full h-6">
        {f.series.map((p, i) =>
          i % every === 0 || i === n - 1 ? (
            <span
              key={p.date}
              className={cn(
                'text-muted-foreground text-12 absolute top-2 font-mono',
                i === 0 ? '' : i === n - 1 ? '-translate-x-full' : '-translate-x-1/2',
                // phones: half the labels, and none next to the last
                i !== n - 1 && (i % (every * 2) !== 0 || i === n - 2) && 'max-sm:hidden',
              )}
              style={{ left: `${n <= 1 ? 0 : (i / (n - 1)) * 100}%` }}
            >
              {p.label}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}
