'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';

// How many updates (comments people wrote) each item of a sheet has, for the bubble after the name in the Table.
// A read under the person's RLS; refreshed when the window regains focus. Empty while loading or on an error: the
// bubble is a hint, the item panel has the updates themselves.

const LIMIT = 10_000;

export function useUpdateCounts(sheetId: string): ReadonlyMap<string, number> {
  const db = useMemo(() => createClient(), []);
  const q = useQuery({
    queryKey: ['item-update-counts', sheetId],
    queryFn: async () => {
      const r = await db
        .from('item_updates')
        .select('item_id, items!inner(sheet_id)')
        .eq('items.sheet_id', sheetId)
        .eq('kind', 'update')
        .limit(LIMIT);
      if (r.error) throw new Error(r.error.message);
      const counts = new Map<string, number>();
      for (const row of (r.data ?? []) as { item_id: string }[])
        counts.set(row.item_id, (counts.get(row.item_id) ?? 0) + 1);
      return counts;
    },
    staleTime: 60_000,
    retry: false,
  });
  return q.data ?? EMPTY;
}

const EMPTY: ReadonlyMap<string, number> = new Map();
