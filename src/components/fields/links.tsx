'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Item } from '@/engine/types';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Empty, Muted } from './kit';
import { EditorFrame, inputClass, SaveCancel } from './shared';
import type { CellProps, EditorProps } from './types';

// Link, requirement and control link cells and editors (docs/03 §3.3, §3.4). Links live in item_links; the editor
// searches the target sheet and returns the chosen item ids.

type Target = { id: string; displayId: string; name: string };

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
          className="border-line bg-soft inline-flex max-w-[11rem] min-w-0 shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
          title={t ? `${t.displayId} ${t.name}` : 'Archived or hidden item'}
        >
          <span className="font-mono text-[11px] font-medium">{t?.displayId ?? '—'}</span>
          {t ? <span className="truncate">{t.name}</span> : null}
        </span>
      ))}
      {ids.length > 2 ? (
        <span className="text-muted-foreground text-xs font-semibold">+{ids.length - 2}</span>
      ) : null}
    </span>
  );
}

function useTargets(sheetId: string | undefined, query: string) {
  const [rows, setRows] = useState<Target[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const db = useMemo(() => createClient(), []);
  useEffect(() => {
    if (!sheetId) return;
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      let q = db
        .from('items')
        .select('id, display_id, name')
        .eq('sheet_id', sheetId)
        .is('archived_at', null)
        .order('seq')
        .limit(20);
      const s = query.trim().replace(/[%,()]/g, ' ');
      if (s) q = q.or(`name.ilike.%${s}%,display_id.ilike.%${s}%`);
      const { data, error: e } = await q;
      if (!live) return;
      setLoading(false);
      setError(!!e);
      setRows((data ?? []).map((r) => ({ id: r.id, displayId: r.display_id, name: r.name })));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [db, sheetId, query]);
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
  const { rows, loading, error } = useTargets(cfg.targetSheetId, query);
  const ref = useRef<HTMLInputElement>(null);
  const listId = useId();
  useEffect(() => ref.current?.focus(), []);
  if (!cfg.targetSheetId)
    return (
      <EditorFrame
        title={field.name}
        footer={
          <Button size="sm" variant="outline" onClick={onCancel}>
            Close
          </Button>
        }
      >
        <Muted className="text-sm">
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
                className="bg-soft border-line flex max-w-full items-center gap-1 rounded-full border py-0.5 pr-1 pl-2 text-xs"
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
        placeholder="Search by name or ID"
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
          <li className="text-crit text-xs">Items could not be loaded. Try again.</li>
        ) : null}
        {!loading && !error && rows.length === 0 ? (
          <li className="text-muted-foreground text-xs">No matching items</li>
        ) : null}
        {rows
          .filter((r) => r.id !== item.id)
          .map((r) => (
            <li key={r.id}>
              <label className="hover:bg-sel flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm">
                <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r)} />
                <span className="font-mono text-xs">{r.displayId}</span>
                <span className="truncate">{r.name}</span>
              </label>
            </li>
          ))}
      </ul>
    </EditorFrame>
  );
}
