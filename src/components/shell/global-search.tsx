'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileSpreadsheet, Search, X } from 'lucide-react';
import { searchAction } from '@/app/[org]/shell-actions';
import { normaliseQuery, type SearchResults } from '@/engine/search';
import { cn } from '@/lib/utils';
import { useShell } from './shell-context';

// Global search (docs/01 FR-5, docs/05 §2.3, §5): "/" focuses the box; results grouped "Sheets" and "Items"; arrows
// move, Enter opens, Esc closes. On phones the box takes the whole top bar while it is in use. The server command
// searches under the person's RLS; typing is debounced and stale answers are dropped.

const DEBOUNCE_MS = 200;

type Option =
  | { kind: 'sheet'; id: string; href: string; label: string }
  | { kind: 'item'; id: string; href: string; label: string; meta: string };

type State =
  | { status: 'idle' }
  | { status: 'loading'; q: string; results: SearchResults | null }
  | { status: 'error'; q: string }
  | { status: 'ready'; q: string; results: SearchResults };

export function GlobalSearch({ org }: { org: string }) {
  const { searchRef } = useShell();
  const router = useRouter();
  const listId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ status: 'idle' });
  const [active, setActive] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);
  const box = useRef<HTMLFormElement>(null);
  const q = normaliseQuery(text);

  useEffect(() => {
    if (!q) {
      setState({ status: 'idle' });
      return;
    }
    const ticket = ++latest.current;
    setState((s) => ({ status: 'loading', q, results: s.status === 'ready' ? s.results : null }));
    const timer = setTimeout(async () => {
      try {
        const r = await searchAction({ org, q });
        if (ticket !== latest.current) return;
        if (!r.ok) setState({ status: 'error', q });
        else {
          setState({ status: 'ready', q, results: r.data });
          setActive(0);
        }
      } catch {
        if (ticket === latest.current) setState({ status: 'error', q });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, org, attempt]);

  // close when focus or a click leaves the box
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const results =
    state.status === 'ready' || state.status === 'loading' ? (state.results ?? null) : null;
  const options: Option[] = useMemo(
    () =>
      results
        ? [
            ...results.sheets.map((s): Option => ({
              kind: 'sheet',
              id: s.id,
              href: `/${org}/s/${s.id}`,
              label: s.name,
            })),
            ...results.items.map((i): Option => ({
              kind: 'item',
              id: i.id,
              href: `/${org}/s/${i.sheetId}?item=${encodeURIComponent(i.displayId)}`,
              label: i.name,
              meta: `${i.displayId} · ${i.sheetName}${i.person ? ` · ${i.person}` : ''}`,
            })),
          ]
        : [],
    [results, org],
  );

  const go = (o: Option) => {
    setOpen(false);
    setText('');
    searchRef.current?.blur();
    router.push(o.href);
  };

  const close = () => {
    setOpen(false);
    searchRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (text) setText('');
      close();
      return;
    }
    if (!open) setOpen(true);
    if (options.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = options[Math.min(active, options.length - 1)];
      if (o) go(o);
    }
  };

  const showList = open && q.length > 0;
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const sheetCount = results?.sheets.length ?? 0;

  return (
    <form
      ref={box}
      role="search"
      className="search-box relative min-w-0 flex-1 min-[760px]:w-[260px] min-[760px]:flex-none"
      data-open={open ? '' : undefined}
      onSubmit={(e) => e.preventDefault()}
    >
      <Search
        className="search-icon text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        aria-hidden
      />
      <input
        ref={searchRef}
        type="text"
        role="combobox"
        aria-label="Search sheets, items and people"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && options.length > 0 ? optionId(active) : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="border-line placeholder:text-muted-foreground bg-background-100 text-label-14 focus-visible:border-focus h-8 w-full min-w-0 rounded-md border pr-8 pl-8 outline-none focus-visible:shadow-[0_0_0_3px_rgb(161_161_170/0.25)]"
      />
      {open ? (
        <button
          type="button"
          className="search-cancel hover:bg-soft text-label-13 ml-1 hidden h-9 shrink-0 items-center rounded-md px-2 font-semibold"
          onClick={() => {
            setText('');
            close();
          }}
        >
          Cancel
        </button>
      ) : (
        <kbd
          className="text-muted-foreground border-line bg-subtle desk-only text-label-12-mono pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border px-1.5 leading-[18px]"
          aria-hidden
        >
          /
        </kbd>
      )}
      {open && text ? (
        <button
          type="button"
          aria-label="Clear search"
          className="hover:bg-soft desk-only absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-md"
          onClick={() => {
            setText('');
            searchRef.current?.focus();
          }}
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
      {showList ? (
        <div className="search-results border-line bg-background-100 shadow-menu absolute top-[calc(100%+6px)] right-0 left-0 z-50 max-h-[min(70vh,480px)] overflow-y-auto rounded-lg border p-1 min-[760px]:left-auto min-[760px]:w-[420px]">
          <p className="sr-only" role="status" aria-live="polite">
            {state.status === 'ready'
              ? `${options.length} ${options.length === 1 ? 'result' : 'results'}`
              : ''}
          </p>
          {state.status === 'error' ? (
            <div role="alert" className="text-label-13 flex items-center justify-between gap-2 p-2">
              <span>Search failed.</span>
              <button
                type="button"
                className="border-line rounded-md border px-2 py-1 font-semibold"
                onClick={() => setAttempt((a) => a + 1)}
              >
                Retry
              </button>
            </div>
          ) : state.status === 'loading' && options.length === 0 ? (
            <div aria-busy="true" aria-label="Searching" className="flex flex-col gap-1 p-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-soft h-9 animate-pulse rounded" />
              ))}
            </div>
          ) : options.length === 0 ? (
            <p className="text-muted-foreground text-copy-13 m-0 p-2">
              No sheets or items match “{q}”.
            </p>
          ) : null}
          <ul id={listId} role="listbox" aria-label="Search results" className="m-0 list-none p-0">
            {options.map((o, i) => (
              <li key={`${o.kind}:${o.id}`} role="presentation">
                {i === 0 && o.kind === 'sheet' ? <GroupLabel>Sheets</GroupLabel> : null}
                {i === sheetCount && o.kind === 'item' ? <GroupLabel>Items</GroupLabel> : null}
                <div
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  tabIndex={-1}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
                    i === active
                      ? 'bg-[var(--sel)] outline-2 outline-[var(--focus)]'
                      : 'hover:bg-soft',
                  )}
                  onPointerDown={(e) => e.preventDefault()}
                  onPointerMove={() => setActive(i)}
                  onClick={() => go(o)}
                >
                  {o.kind === 'sheet' ? (
                    <>
                      <FileSpreadsheet className="size-4 shrink-0" aria-hidden />
                      <span className="truncate font-semibold">{o.label}</span>
                    </>
                  ) : (
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold">{o.label}</span>
                      <span className="text-muted-foreground text-label-12-mono truncate">
                        {o.meta}
                      </span>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground text-label-12 px-2 pt-2 pb-1 font-medium" aria-hidden>
      {children}
    </div>
  );
}
