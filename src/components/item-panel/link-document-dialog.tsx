'use client';

import { useEffect, useId, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { searchDocumentsAction } from '@/app/[org]/s/panel-actions';
import type { FoundDocument } from '@/server/commands/documents';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// "Link a document" (docs/05 §3.4 Files tab): a command-palette search over the workspace's documents registers by
// title or ID, showing each document's version and status. Several can be chosen; documents already linked are dimmed.

export function LinkDocumentDialog({
  org,
  linked,
  onClose,
  onLink,
}: {
  org: string;
  /** Ids of documents the item already links to. */
  linked: Set<string>;
  onClose(): void;
  onLink(docs: FoundDocument[]): Promise<void>;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [results, setResults] = useState<FoundDocument[]>([]);
  const [chosen, setChosen] = useState<Map<string, FoundDocument>>(new Map());
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setState('loading');
    const t = setTimeout(async () => {
      const r = await searchDocumentsAction({ org, query });
      if (!live) return;
      if (!r.ok) return setState('error');
      setResults(r.data.documents);
      setState('ready');
    }, 180);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [org, query, tick]);

  const toggle = (d: FoundDocument) =>
    setChosen((m) => {
      const next = new Map(m);
      if (next.has(d.itemId)) next.delete(d.itemId);
      else next.set(d.itemId, d);
      return next;
    });

  const link = async () => {
    setBusy(true);
    await onLink([...chosen.values()]);
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        aria-describedby={`${id}-desc`}
        className="top-[12vh] w-[min(560px,calc(100vw-32px))] translate-y-0 gap-3"
      >
        <DialogTitle className="text-heading-16 m-0">Link a document</DialogTitle>
        <DialogDescription id={`${id}-desc`} className="text-muted-foreground text-copy-13 m-0">
          Controlled documents from the documents sheets. The item always shows their last
          approved version.
        </DialogDescription>
        <label className="border-input focus-within:border-focus flex items-center gap-2 rounded-md border px-2.5">
          <Search className="text-muted-foreground size-4" aria-hidden />
          <input
            autoFocus
            className="text-copy-14 h-10 min-w-0 flex-1 bg-transparent outline-none"
            placeholder="Search by title or ID"
            aria-label="Search documents"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="max-h-[50vh] min-h-24 overflow-y-auto" aria-busy={state === 'loading'}>
          {state === 'loading' && results.length === 0 ? (
            <div className="flex flex-col gap-1.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-soft h-12 animate-pulse rounded-md" />
              ))}
            </div>
          ) : state === 'error' ? (
            <p className="text-copy-13 m-0 flex items-center gap-2">
              The documents could not be searched.
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setTick((t) => t + 1)}
              >
                Retry
              </Button>
            </p>
          ) : results.length === 0 ? (
            <p className="text-muted-foreground text-copy-13 m-0">
              {query
                ? 'No document matches. Try another title or ID.'
                : 'No documents yet. Create a "Documents and policies" sheet and add your policies there.'}
            </p>
          ) : (
            <ul
              role="listbox"
              aria-multiselectable="true"
              aria-label="Documents"
              className="m-0 flex list-none flex-col gap-1 p-0"
            >
              {results.map((d) => {
                const already = linked.has(d.itemId);
                const on = chosen.has(d.itemId);
                return (
                  <li
                    key={d.itemId}
                    role="option"
                    aria-selected={on}
                    aria-disabled={already}
                    tabIndex={0}
                    className={cn(
                      'hover:bg-gray-alpha-100 focus-visible:outline-focus flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 focus-visible:outline-2',
                      on && 'bg-sel',
                      already && 'cursor-default opacity-50',
                    )}
                    onClick={() => !already && toggle(d)}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && !already) {
                        e.preventDefault();
                        toggle(d);
                      }
                    }}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'border-line-strong flex size-4 shrink-0 items-center justify-center rounded border',
                        (on || already) && 'bg-ink border-ink text-background-100',
                      )}
                    >
                      {on || already ? <Check className="size-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-label-13 block truncate font-semibold">{d.name}</span>
                      <span className="text-muted-foreground text-label-12 block truncate">
                        {d.documentId ?? d.displayId} · {d.sheetName}
                      </span>
                    </span>
                    <span className="text-label-12 shrink-0">
                      {d.view.symbol} {d.view.chip}
                    </span>
                    {already ? (
                      <span className="text-muted-foreground text-label-12">Linked</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={chosen.size === 0 || busy} onClick={() => void link()}>
            {busy
              ? 'Linking…'
              : chosen.size > 1
                ? `Link ${chosen.size} documents`
                : 'Link document'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
