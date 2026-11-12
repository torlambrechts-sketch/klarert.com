import { AlertTriangle } from 'lucide-react';
import type { Bar, WidgetResult } from '@/engine/dashboards';
import { Chip, solidVar } from '@/components/fields/shared';
import { TONE_FILL, ToneBadge } from '@/components/insights/tone';
import { cn } from '@/lib/utils';

// One widget's result (docs/05 §4). Rendered by result kind, never by widget type: a big number with its caption,
// labelled bars (each with its count in words and digits), or the problem in plain words.

export function WidgetBody({ result }: { result: WidgetResult | undefined }) {
  if (!result)
    return (
      <p className="text-muted-foreground m-0 text-[13px]">This widget could not be loaded.</p>
    );
  if (result.kind === 'problem')
    return (
      <p className="text-muted-foreground m-0 flex items-start gap-1.5 text-[13px]">
        <AlertTriangle className="text-warn mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{result.message} Edit or remove this widget.</span>
      </p>
    );
  if (result.kind === 'stat')
    return (
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'text-[34px] leading-[1.1] font-bold tracking-[-0.03em] tabular-nums',
              result.tone === 'crit' && result.value > 0 && 'text-crit',
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
        <span className="text-muted-foreground text-[13px]">{result.caption}</span>
      </div>
    );
  return <Bars bars={result.bars} total={result.total} caption={result.caption} />;
}

function Bars({ bars, total, caption }: { bars: Bar[]; total: number; caption: string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="flex flex-col gap-2.5">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {bars.map((b) => (
          <li
            key={b.key}
            className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] items-center gap-2.5 text-[13px]"
          >
            <span className="min-w-0 truncate" title={b.label}>
              {b.option ? (
                <Chip option={b.option} className="max-w-full" />
              ) : (
                <span className="text-ink-2">{b.label}</span>
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
            <span className="text-ink w-8 text-right font-mono text-[12.5px] tabular-nums">
              {b.value}
              <span className="sr-only"> of {total}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground m-0 text-[12.5px]">{caption}</p>
    </div>
  );
}
