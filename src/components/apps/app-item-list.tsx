import Link from 'next/link';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import type { AppRow } from '@/engine/apps/list';
import { cn } from '@/lib/utils';

// An app's item screen (docs/13): the items to act on as rows that work at 390 px (name, its parent, the fields the
// screen shows), each opening the item panel on its sheet. Overdue dates say so in words and with a symbol.

export type AppItemRow = AppRow & { href: string; parent: string | null };

export function AppItemList({
  title,
  description,
  empty,
  rows,
}: {
  title: string;
  description?: string;
  empty: string;
  rows: AppItemRow[];
}) {
  return (
    <main className="flex w-full flex-col gap-4 px-4 pt-5 pb-8 sm:px-[28px]">
      <PageHeader
        title={title}
        description={description}
        actions={
          <span
            className="text-muted-foreground text-label-13 tabular-nums"
            data-testid="app-count"
          >
            {rows.length} {rows.length === 1 ? 'item' : 'items'}
          </span>
        }
      />
      {rows.length === 0 ? (
        <div className="border-line bg-background-100 rounded-lg border border-dashed p-6">
          <p className="text-muted-foreground m-0">{empty}</p>
        </div>
      ) : (
        <ul
          aria-label={title}
          className="border-line bg-background-100 m-0 flex list-none flex-col rounded-lg border p-0"
        >
          {rows.map((r) => (
            <li key={r.id} className="border-line border-b last:border-b-0">
              <Link
                href={r.href}
                className="hover:bg-soft flex min-h-[56px] items-center gap-3 px-4 py-3 outline-offset-[-2px]"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="text-muted-foreground text-label-12-mono shrink-0">
                      {r.displayId}
                    </span>
                    <span className="text-label-14 text-ink min-w-0 truncate font-medium">
                      {r.name}
                    </span>
                  </span>
                  {r.parent ? (
                    <span className="text-muted-foreground text-copy-13 truncate">
                      For {r.parent}
                    </span>
                  ) : null}
                  {r.fields.length ? (
                    <span className="text-copy-13 flex flex-wrap gap-x-4 gap-y-0.5">
                      {r.fields.map((f) => (
                        <span
                          key={f.key}
                          className={cn(
                            'flex items-center gap-1',
                            f.overdue ? 'text-crit' : 'text-muted-foreground',
                          )}
                        >
                          <span className="sr-only">{f.name}: </span>
                          {f.overdue ? <AlertTriangle className="size-3.5" aria-hidden /> : null}
                          {f.text || `No ${f.name.toLowerCase()}`}
                          {f.overdue ? <span>(overdue)</span> : null}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
                <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
