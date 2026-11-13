'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';

// The comments (updates people wrote) on each item of a sheet, for the comment marker on rows and cards: how many, and
// the latest one's opening words and author for its tooltip. One grouped read under the person's RLS
// (item_update_summaries, 0019), refreshed when an update is posted, edited or deleted here (the item panel
// invalidates `updateSummariesKey`) or anywhere else in the workspace (realtime). Empty while loading or on an error:
// the marker is a hint, the item panel has the updates themselves.

export interface UpdateSummary {
  count: number;
  /** The latest update, at most 200 characters. */
  lastBody: string | null;
  lastAuthor: string | null;
  lastAt: string | null;
}

/** Every sheet's summaries start with this key: invalidate it after posting an update. */
export const UPDATE_SUMMARIES = 'item-update-summaries';
export const updateSummariesKey = (sheetId: string) => [UPDATE_SUMMARIES, sheetId] as const;

export function useUpdateSummaries(
  sheetId: string,
  orgId: string | undefined,
): ReadonlyMap<string, UpdateSummary> {
  const db = useMemo(() => createClient(), []);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: updateSummariesKey(sheetId),
    queryFn: async () => {
      const r = await db.rpc('item_update_summaries', { p_sheet: sheetId });
      if (r.error) throw new Error(r.error.message);
      const out = new Map<string, UpdateSummary>();
      for (const row of r.data ?? [])
        out.set(row.item_id, {
          count: row.updates,
          lastBody: row.last_body ?? null,
          lastAuthor: row.last_author ?? null,
          lastAt: row.last_at ?? null,
        });
      return out;
    },
    staleTime: 60_000,
    retry: 1,
  });

  // updates written elsewhere (another person, an automation's post is not counted but refreshes harmlessly)
  useEffect(() => {
    if (!orgId) return;
    let channel: ReturnType<typeof db.channel> | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const { data } = await db.auth.getSession();
      if (cancelled) return;
      if (data.session) db.realtime.setAuth(data.session.access_token);
      channel = db
        .channel(`item-update-summaries:${sheetId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'item_updates', filter: `org_id=eq.${orgId}` },
          () => {
            clearTimeout(timer);
            timer = setTimeout(
              () => void qc.invalidateQueries({ queryKey: updateSummariesKey(sheetId) }),
              300,
            );
          },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (channel) void db.removeChannel(channel);
    };
  }, [db, orgId, qc, sheetId]);

  return q.data ?? EMPTY;
}

const EMPTY: ReadonlyMap<string, UpdateSummary> = new Map();
