'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { listAuditExportsAction } from '@/app/[org]/audit/actions';
import { Button } from '@/components/ui/button';
import type { ExportRow } from '@/engine/audit/exports';
import type { AuditExports } from '@/server/commands/audit';
import type { Result } from '@/server/result';

// The Exports list on Audit outputs (docs/11 Audit outputs, owner decision 15 Nov 2026): the workspace's audit
// exports, newest first, with what was exported, who, when and the filters used. The first page comes from the
// server; "Show more exports" reads the next one. The words come from the engine (exportRow).

type Load = { kind: 'idle' } | { kind: 'error'; message: string };

export function ExportsList({ org, initial }: { org: string; initial: Result<AuditExports> }) {
  const [rows, setRows] = useState<ExportRow[]>(initial.ok ? initial.data.rows : []);
  const [next, setNext] = useState<number | null>(initial.ok ? initial.data.next : null);
  const [loaded, setLoaded] = useState(initial.ok);
  const [load, setLoad] = useState<Load>(
    initial.ok ? { kind: 'idle' } : { kind: 'error', message: initial.error.message },
  );
  const [announce, setAnnounce] = useState('');
  const [pending, start] = useTransition();
  const focusId = useRef<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (focusId.current === null) return;
    listRef.current?.querySelector<HTMLElement>(`[data-export="${focusId.current}"]`)?.focus();
    focusId.current = null;
  }, [rows]);

  const read = (before: number | null) =>
    start(async () => {
      const r = await listAuditExportsAction({ org, ...(before ? { before } : {}) });
      if (!r.ok) {
        setLoad({ kind: 'error', message: r.error.message });
        return;
      }
      setLoad({ kind: 'idle' });
      setLoaded(true);
      setNext(r.data.next);
      if (before) {
        // keyboard users land on the first export that just arrived
        focusId.current = r.data.rows[0]?.id ?? null;
        setRows((old) => [...old, ...r.data.rows]);
        setAnnounce(
          `${r.data.rows.length} more ${r.data.rows.length === 1 ? 'export' : 'exports'} shown.`,
        );
      } else {
        setRows(r.data.rows);
        setAnnounce('');
      }
    });

  return (
    <div className="flex flex-col gap-3" data-testid="audit-exports-list">
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {!loaded && load.kind === 'error' ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="m-0">The exports could not be loaded. {load.message}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => read(null)}
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-copy-13 m-0" data-testid="audit-exports-empty">
          No exports yet. Statements of applicability, audit packs, management review inputs and
          data-flow records show here once someone in this workspace exports one.
        </p>
      ) : (
        <ol
          ref={listRef}
          aria-label="Exports, newest first"
          className="divide-line m-0 flex list-none flex-col divide-y p-0"
        >
          {rows.map((r) => (
            <li
              key={r.id}
              data-export={r.id}
              tabIndex={-1}
              className="focus-visible:outline-focus flex flex-col gap-1 py-3 outline-offset-2 focus-visible:outline-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-label-14 font-medium">{r.what}</span>
                <span className="text-copy-13 text-muted-foreground break-words">
                  <span className="sr-only">Filters: </span>
                  {r.filters.join(' · ')}
                </span>
                {r.covered ? (
                  <span className="text-label-12 text-muted-foreground">{r.covered}</span>
                ) : null}
              </div>
              <div className="text-copy-13 flex shrink-0 flex-wrap gap-x-2 sm:flex-col sm:items-end sm:gap-0 sm:text-right">
                <span>
                  <span className="sr-only">Exported by </span>
                  {r.who}
                </span>
                <time dateTime={r.atIso} className="text-muted-foreground tabular-nums">
                  {r.at}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
      {loaded && load.kind === 'error' ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="m-0">More exports could not be loaded. {load.message}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => read(next)}
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
            Retry
          </Button>
        </div>
      ) : next !== null ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => read(next)}
            disabled={pending}
            data-testid="audit-exports-more"
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {pending ? 'Loading more exports' : 'Show more exports'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The list's skeleton while the first page loads: rows the height of an export, so nothing moves. */
export function ExportsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the exports" className="flex flex-col gap-3 py-1">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2 py-1">
          <div className="bg-soft h-4 w-40 animate-pulse rounded" />
          <div className="bg-soft h-4 w-full max-w-[420px] animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}
