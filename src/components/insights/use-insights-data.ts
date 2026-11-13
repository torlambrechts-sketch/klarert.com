'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { InsightsData, InsightSource, InsightsLayout } from '@/engine/insights';
import { sheetCtx, type SheetData } from '@/engine/sheet-data';
import type { Ctx, Item } from '@/engine/types';
import { sheetKey } from '@/components/grid/use-sheet';
import { fetchSheetData } from '@/lib/sheet-query';
import { createClient } from '@/lib/supabase/client';

// What the Insights widgets read (docs/05 §3.6): the view's own sheet (its items as the view shows them) and every
// other sheet a widget names, each read under the person's RLS with the same query the sheet page uses.

export function useInsightsData(input: {
  data: SheetData;
  ctx: Ctx;
  items: Item[];
  layout: InsightsLayout;
  /** Extra sheets to read (the widget being edited). */
  extra?: string[];
  env: { now: Date; timeZone: string; userId: string; isAdmin: boolean };
}): InsightsData {
  const { data, ctx, items, layout, extra, env } = input;
  const ids = useMemo(() => {
    const set = new Set<string>();
    for (const r of layout.rows)
      for (const w of r.widgets) if (w.src && w.src !== data.sheet.id) set.add(w.src);
    for (const id of extra ?? []) if (id !== data.sheet.id) set.add(id);
    return [...set].sort();
  }, [layout, extra, data.sheet.id]);
  const db = useMemo(() => createClient(), []);
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: sheetKey(id),
      queryFn: async () => {
        const d = await fetchSheetData(db, id);
        if (!d) throw new Error('This sheet no longer exists or you cannot see it.');
        return d;
      },
      staleTime: 60_000,
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });
  const others = useMemo(() => {
    const m = new Map<string, InsightSource | 'loading' | null>();
    ids.forEach((id, i) => {
      const r = results[i];
      if (!r || r.isPending) return void m.set(id, 'loading');
      if (!r.data) return void m.set(id, null);
      const d = r.data;
      const c = sheetCtx(d, {
        ...env,
        newId: (p) => `${p}${Math.random().toString(36).slice(2, 8)}`,
      });
      m.set(id, {
        sheet: d.sheet,
        fields: d.fields,
        items: d.items,
        allItems: d.items,
        ctx: c,
        current: false,
      });
    });
    return m;
  }, [ids, env, results]);
  return useMemo(
    () => ({
      current: {
        sheet: data.sheet,
        fields: data.fields,
        items,
        allItems: data.items,
        ctx,
        current: true,
      },
      sheet: (id: string) => others.get(id) ?? null,
    }),
    [data, items, ctx, others],
  );
}
