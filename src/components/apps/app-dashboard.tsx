'use client';

import Link from 'next/link';
import { KeyFigures } from '@/components/dashboards/key-figures';
import { resultMeta, WidgetBody } from '@/components/dashboards/widget-card';
import { HeadCard, PageHeader } from '@/components/shell/page-header';
import { WIDGET_TYPES, type WidgetConfig } from '@/engine/dashboards';
import { cn } from '@/lib/utils';
import type { DashboardView } from '@/server/repositories/dashboards';

// An app's dashboard screen (docs/13): the pack's dashboard, read only, as the same cards as Dashboards (editing
// stays on the dashboard itself, linked from the header).

export function AppDashboard({
  org,
  title,
  description,
  widgets,
  view,
  retryHref,
  fullHref,
}: {
  org: string;
  title: string;
  description?: string;
  widgets: WidgetConfig[];
  view: DashboardView | null;
  retryHref: string;
  fullHref: string;
}) {
  return (
    <main className="flex w-full flex-col gap-5 px-4 pt-5 pb-8 [--hero-gap:20px] sm:px-12 sm:pt-[26px]">
      <PageHeader
        title={title}
        description={description}
        actions={
          <Link
            href={fullHref}
            className="text-14 text-ink font-medium underline underline-offset-4"
          >
            Open in Dashboards
          </Link>
        }
      />
      <HeadCard>
        {!view ? (
          <div
            role="alert"
            className="border-line bg-surface flex flex-col items-start gap-2 rounded-lg border p-5"
          >
            <p className="m-0">The widgets could not be loaded.</p>
            <a
              href={retryHref}
              className="border-line hover:bg-soft bg-surface text-14 inline-flex h-[40px] items-center rounded-md border px-3.5 font-medium transition-colors duration-150"
            >
              Retry
            </a>
          </div>
        ) : widgets.length === 0 ? (
          <div className="border-line bg-surface rounded-lg border border-dashed p-6">
            <p className="text-muted-foreground m-0">This dashboard has no widgets yet.</p>
          </div>
        ) : (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-x-4 gap-y-8 p-0">
            {widgets.map((w) => {
              const result = view.results[w.id];
              if (result?.kind === 'figures')
                return (
                  <li key={w.id} className="col-span-full min-w-0">
                    <KeyFigures result={result} title={w.title} org={org} />
                  </li>
                );
              const def = WIDGET_TYPES[w.type];
              const scope = w.sheetId ? (view.sheetNames[w.id] ?? 'Sheet removed') : 'All sheets';
              const headingId = `w-${w.id}`;
              return (
                <li
                  key={w.id}
                  aria-labelledby={headingId}
                  className={cn(
                    'border-line bg-surface flex min-w-0 flex-col rounded-lg border',
                    def?.wide && 'col-span-full',
                  )}
                >
                  <div className="border-line flex min-h-[52px] items-center justify-between gap-2.5 border-b px-[16px] py-2">
                    <h2 id={headingId} className="text-14 m-0 min-w-0 font-semibold">
                      {w.title}
                    </h2>
                    <span className="text-muted-foreground text-13 truncate text-right">
                      {resultMeta(result) ?? `${def?.label ?? 'Widget'} · ${scope}`}
                    </span>
                  </div>
                  <div className="flex-1">
                    <WidgetBody result={result} org={org} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </HeadCard>
    </main>
  );
}
