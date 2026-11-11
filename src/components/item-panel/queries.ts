'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityEntry } from '@/engine/activity';
import type { FileRow, Item } from '@/engine/types';
import type { Database } from '@/lib/database.types';
import { fetchItemsById } from '@/lib/sheet-query';
import { FIELD_COLUMNS, toField, toFile } from '@/lib/sheet-rows';
import { createClient } from '@/lib/supabase/client';

// The item panel's own reads (docs/05 §3.4), under the person's RLS: updates (with realtime per open item, docs/02
// §9), the activity log, incoming links and every file version. Writes go through the panel's server actions.

export type UpdateRow = Database['public']['Tables']['item_updates']['Row'];
export type FileVersion = FileRow & { createdAt: string; uploadedBy: string | null };

export const panelKeys = {
  updates: (itemId: string) => ['item-updates', itemId] as const,
  activity: (itemId: string) => ['item-activity', itemId] as const,
  incoming: (itemId: string) => ['item-incoming', itemId] as const,
  files: (itemId: string) => ['item-files', itemId] as const,
};

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export function useUpdates(itemId: string) {
  const qc = useQueryClient();
  const db = useMemo(() => createClient(), []);
  useEffect(() => {
    let channel: ReturnType<typeof db.channel> | null = null;
    let cancelled = false;
    (async () => {
      const { data } = await db.auth.getSession();
      if (cancelled) return;
      if (data.session) db.realtime.setAuth(data.session.access_token);
      channel = db
        .channel(`item-updates:${itemId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'item_updates', filter: `item_id=eq.${itemId}` },
          () => void qc.invalidateQueries({ queryKey: panelKeys.updates(itemId) }),
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) void db.removeChannel(channel);
    };
  }, [db, itemId, qc]);
  return useQuery({
    queryKey: panelKeys.updates(itemId),
    queryFn: async () =>
      must(
        await db
          .from('item_updates')
          .select('*')
          .eq('item_id', itemId)
          .order('created_at', { ascending: false })
          .limit(200),
      ) as UpdateRow[],
    staleTime: 30_000,
  });
}

export interface ActivityData {
  entries: ActivityEntry[];
  /** Fields of the sheet including deleted ones (old entries name them). */
  fields: ReturnType<typeof toField>[];
  /** Items that link entries mention, for their display ids. */
  items: Item[];
}

/** The item's chain, newest first. `version` changes whenever the item may have new entries. */
export function useActivity(itemId: string, sheetId: string, version: string) {
  const db = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: [...panelKeys.activity(itemId), version],
    queryFn: async (): Promise<ActivityData> => {
      const [log, fields] = await Promise.all([
        db
          .from('activity_log')
          .select(
            'id, at, actor_kind, actor_id, action, field_id, old_value, new_value, note, hash',
          )
          .eq('item_id', itemId)
          .order('id', { ascending: false })
          .limit(500),
        db.from('fields').select(FIELD_COLUMNS).eq('sheet_id', sheetId),
      ]);
      const entries: ActivityEntry[] = must(log).map((r) => ({
        id: r.id,
        at: r.at,
        actorKind: r.actor_kind as ActivityEntry['actorKind'],
        actorId: r.actor_id,
        action: r.action,
        fieldId: r.field_id,
        oldValue: (r.old_value ?? null) as ActivityEntry['oldValue'],
        newValue: (r.new_value ?? null) as ActivityEntry['newValue'],
        note: r.note,
        hash: r.hash,
      }));
      const linkIds = new Set<string>();
      for (const e of entries)
        if (e.action === 'link.changed')
          for (const v of [e.oldValue, e.newValue])
            if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && linkIds.add(x));
      const items = linkIds.size ? await fetchItemsById(db, [...linkIds]) : [];
      return { entries, fields: must(fields).map(toField), items };
    },
    staleTime: 0,
    placeholderData: (prev) => prev,
  });
}

/** item_links rows that point at this item (incoming links, docs/05 §3.4). */
export function useIncoming(itemId: string) {
  const db = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: panelKeys.incoming(itemId),
    queryFn: async () =>
      must(
        await db
          .from('item_links')
          .select('field_id, from_item')
          .eq('to_item', itemId)
          .order('created_at')
          .limit(500),
      ).map((r) => ({ fieldId: r.field_id, fromItem: r.from_item })),
    staleTime: 0,
  });
}

/** Every version of every file of the item, for "Older versions". */
export function useFileVersions(itemId: string, version: string) {
  const db = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: [...panelKeys.files(itemId), version],
    queryFn: async (): Promise<FileVersion[]> =>
      must(
        await db
          .from('files')
          .select('*')
          .eq('item_id', itemId)
          .order('created_at', { ascending: false }),
      ).map((r) => ({ ...toFile(r), createdAt: r.created_at, uploadedBy: r.uploaded_by })),
    staleTime: 0,
    placeholderData: (prev) => prev,
  });
}
