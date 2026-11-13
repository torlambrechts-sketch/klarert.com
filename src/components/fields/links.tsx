'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { X } from 'lucide-react';
import { searchItemsAction } from '@/app/[org]/s/panel-actions';
import type { Item } from '@/engine/types';
import { Button } from '@/components/ui/button';
import { Empty, Muted } from './kit';
import { EditorFrame, inputClass, SaveCancel } from './shared';
import type { CellProps, EditorProps } from './types';

// Link, requirement and control link cells and editors (docs/03 §3.3, §3.4). Links live in item_links; the editor
// searches the target sheet through the search command and returns the chosen item ids.

type Target = { id: string; displayId: string; name: string; sheetName?: string };

/** Requirement and control link fields with no target sheet link to any library sheet (docs/12). */
const anyLibrary = (field: { type: string; config: unknown }) =>
  (field.type === 'requirement' || field.type === 'controllink') &&
  !(field.config as { targetSheetId?: string | null }).targetSheetId;

export function LinkCell({ item, field, ctx }: CellProps) {
  const ids = ctx.links(item.id, field.id);
  if (ids.length === 0) return <Empty />;
  const targets = ids.map((id) => ctx.item(id));
  const shown = targets.slice(0, 2);
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
      {shown.map((t, i) => (
        <span
          key={ids[i]}
          className="border-line bg-soft text-label-12 inline-flex max-w-[11rem] min-w-0 shrink-0 items-center gap-1 rounded-full border px-2 py-0.5"
          title={t ? `${t.displayId} ${t.name}` : 'Archived or hidden item'}
        >
          <span className="text-label-12-mono shrink-0 font-medium whitespace-nowrap">
            {t?.displayId ?? '—'}
          </span>
          {t ? <span className="truncate">{t.name}</span> : null}
        </span>
      ))}
      {ids.length > 2 ? (
        <span className="text-muted-foreground text-label-12 font-semibold">+{ids.length - 2}</span>
      ) : null}
    </span>
  );
}

/**
 * Items of the target sheet matching the query, from the search command (debounced, display id or name); with
 * `library`, items of every library sheet, also by reference number.
 */
function useTargets(sheetId: string | undefined, query: string, library = false) {
  const { org } = useParams<{ org: string }>();
  const [rows, setRows] = useState<Target[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if ((!sheetId && !library) || !org) return;
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchItemsAction(
          library ? { org, library: true, query } : { org, sheetId, query },
        );
        if (!live) return;
        setError(!r.ok);
        setRows(
          r.ok
            ? r.data.items.map((i) => ({
                id: i.id,
                displayId: i.displayId,
                name: i.name,
                ...(library ? { sheetName: r.data.sheetNames[i.sheetId] } : {}),
              }))
            : [],
        );
      } catch {
        if (live) setError(true);
      } finally {
        if (live) setLoading(false);
      }
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [org, sheetId, query, library]);
  return { rows, loading, error };
}

export function LinkEditor({ item, field, ctx, onCommit, onCancel }: EditorProps) {
  const cfg = field.config as { targetSheetId?: string; multiple?: boolean };
  const [picked, setPicked] = useState<string[]>(() => ctx.links(item.id, field.id));
  const [known, setKnown] = useState<Map<string, Target>>(() => {
    const m = new Map<string, Target>();
    for (const id of ctx.links(item.id, field.id)) {
      const t: Item | undefined = ctx.item(id);
      if (t) m.set(id, { id, displayId: t.displayId, name: t.name });
    }
    return m;
  });
  const [query, setQuery] = useState('');
  const library = anyLibrary(field);
  const { rows, loading, error } = useTargets(cfg.targetSheetId, query, library);
  const ref = useRef<HTMLInputElement>(null);
  const listId = useId();
  useEffect(() => ref.current?.focus(), []);
  if (!cfg.targetSheetId && !library)
    return (
      <EditorFrame
        title={field.name}
        footer={
          <Button size="sm" variant="outline" onClick={onCancel}>
            Close
          </Button>
        }
      >
        <Muted className="text-label-13">
          Choose the sheet this field links to in the field settings first.
        </Muted>
      </EditorFrame>
    );
  const toggle = (t: Target) => {
    setKnown((k) => new Map(k).set(t.id, t));
    setPicked((p) =>
      p.includes(t.id)
        ? p.filter((x) => x !== t.id)
        : cfg.multiple === false
          ? [t.id]
          : [...p, t.id],
    );
  };
  return (
    <EditorFrame
      title={field.name}
      footer={<SaveCancel onSave={() => onCommit(picked)} onCancel={onCancel} />}
    >
      {picked.length ? (
        <ul className="flex flex-wrap gap-1" aria-label="Linked items">
          {picked.map((id) => {
            const t = known.get(id);
            return (
              <li
                key={id}
                className="bg-soft border-line text-label-12 flex max-w-full items-center gap-1 rounded-full border py-0.5 pr-1 pl-2"
              >
                <span className="font-mono">{t?.displayId ?? '—'}</span>
                <span className="truncate">{t?.name ?? 'Item'}</span>
                <button
                  type="button"
                  className="hover:bg-line rounded-full p-0.5"
                  aria-label={`Remove ${t?.displayId ?? 'item'}`}
                  onClick={() => setPicked((p) => p.filter((x) => x !== id))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <input
        ref={ref}
        className={inputClass}
        placeholder={library ? 'Search by name, ID or reference' : 'Search by name or ID'}
        aria-label={`Search items for ${field.name}`}
        aria-controls={listId}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (rows[0]) toggle(rows[0]);
          }
        }}
      />
      <ul id={listId} className="flex max-h-56 flex-col gap-0.5 overflow-auto" aria-busy={loading}>
        {error ? (
          <li className="text-crit text-label-12">Items could not be loaded. Try again.</li>
        ) : null}
        {!loading && !error && rows.length === 0 ? (
          <li className="text-muted-foreground text-label-12">No matching items</li>
        ) : null}
        {rows
          .filter((r) => r.id !== item.id)
          .map((r) => (
            <li key={r.id}>
              <label className="hover:bg-sel text-label-13 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1">
                <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r)} />
                <span className="text-label-12-mono">{r.displayId}</span>
                <span className="truncate">{r.name}</span>
                {r.sheetName ? (
                  <span className="text-muted-foreground text-label-12 ml-auto shrink-0">
                    {r.sheetName}
                  </span>
                ) : null}
              </label>
            </li>
          ))}
      </ul>
    </EditorFrame>
  );
}
