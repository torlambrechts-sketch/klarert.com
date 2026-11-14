'use client';

import { ERASED_VALUE, isMaskedValue } from '@/engine/access';
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityEntry } from '@/engine/activity';
import { fileCategories, type FileVersionRow } from '@/engine/item-files';
import type { Item, Json } from '@/engine/types';
import { itemDocumentsAction } from '@/app/[org]/s/panel-actions';
import type { Database } from '@/lib/database.types';
import { fetchItemsById } from '@/lib/sheet-query';
import { FIELD_COLUMNS, toField, toFileVersion } from '@/lib/sheet-rows';
import { createClient } from '@/lib/supabase/client';

// The item panel's own reads (docs/05 §3.4), under the person's RLS: updates (with realtime per open item, docs/02
// §9), the activity log, incoming links and every file version. Writes go through the panel's server actions.

export type UpdateRow = Database['public']['Tables']['item_updates']['Row'];
export type FileVersion = FileVersionRow;

export const panelKeys = {
  updates: (itemId: string) => ['item-updates', itemId] as const,
  activity: (itemId: string) => ['item-activity', itemId] as const,
  incoming: (itemId: string) => ['item-incoming', itemId] as const,
  files: (itemId: string) => ['item-files', itemId] as const,
  documents: (itemId: string) => ['item-documents', itemId] as const,
  downloads: (fileIds: string) => ['file-downloads', fileIds] as const,
  categories: (org: string) => ['file-categories', org] as const,
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
      // restricted values (docs/02 §16): the log keeps markers; people who may see the field read the values
      const masked = entries.filter(
        (e) =>
          isMaskedValue(e.oldValue) ||
          isMaskedValue(e.newValue) ||
          hasMaskedValues(e) ||
          hasMaskedKeys(e.oldValue) ||
          hasMaskedKeys(e.newValue),
      );
      // personal data (docs/02 §18): values not erased yet are read from personal_activity; erased ones say so
      if (masked.length) {
        const { data: personal } = await db
          .from('personal_activity')
          .select('activity_id, slot, field_id, old_value, new_value, erased_at')
          .in(
            'activity_id',
            masked.map((e) => e.id),
          );
        for (const r of personal ?? []) {
          const e = entries.find((x) => x.id === r.activity_id);
          if (!e) continue;
          const erased = !!r.erased_at;
          const pick = (v: Json | null) => (erased ? (ERASED_VALUE as unknown as Json) : v);
          if (r.slot === 'file') {
            // the file entry's name, description and version note, key by key
            const merge = (base: Json | null, real: Json | null) => {
              if (!base || typeof base !== 'object' || Array.isArray(base)) return base;
              const out: Record<string, Json> = { ...base };
              for (const k of ['filename', 'description', 'version_note'])
                if (isMaskedValue(out[k]))
                  out[k] = erased
                    ? (ERASED_VALUE as unknown as Json)
                    : (((real as Record<string, Json> | null)?.[k] ?? null) as Json);
              return out;
            };
            e.oldValue = merge(
              e.oldValue,
              (r.old_value ?? null) as Json,
            ) as ActivityEntry['oldValue'];
            e.newValue = merge(
              e.newValue,
              (r.new_value ?? null) as Json,
            ) as ActivityEntry['newValue'];
          } else if (r.slot === 'name' && e.action === 'item.created') {
            if (e.newValue && typeof e.newValue === 'object' && !Array.isArray(e.newValue))
              e.newValue = { ...e.newValue, name: pick((r.new_value ?? null) as Json) };
          } else if (r.slot === 'field' && !e.fieldId) {
            if (e.newValue && typeof e.newValue === 'object' && !Array.isArray(e.newValue)) {
              const values = { ...((e.newValue.values ?? {}) as Record<string, Json>) };
              values[r.field_id!] = pick((r.new_value ?? null) as Json);
              e.newValue = { ...e.newValue, values };
            }
          } else {
            e.oldValue = (
              e.oldValue === null ? null : pick((r.old_value ?? null) as Json)
            ) as ActivityEntry['oldValue'];
            e.newValue = (
              e.newValue === null ? null : pick((r.new_value ?? null) as Json)
            ) as ActivityEntry['newValue'];
          }
        }
      }
      if (masked.length) {
        const { data: real } = await db
          .from('restricted_activity')
          .select('activity_id, field_id, old_value, new_value')
          .in(
            'activity_id',
            masked.map((e) => e.id),
          );
        for (const r of real ?? []) {
          const e = entries.find((x) => x.id === r.activity_id);
          if (!e) continue;
          if (e.fieldId) {
            e.oldValue = (r.old_value ?? null) as ActivityEntry['oldValue'];
            e.newValue = (r.new_value ?? null) as ActivityEntry['newValue'];
          } else if (e.newValue && typeof e.newValue === 'object' && !Array.isArray(e.newValue)) {
            const values = { ...((e.newValue.values ?? {}) as Record<string, Json>) };
            values[r.field_id] = (r.new_value ?? null) as Json;
            e.newValue = { ...e.newValue, values };
          }
        }
      }
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
      ).map(toFileVersion),
    staleTime: 0,
    placeholderData: (prev) => prev,
  });
}

/** The documents the item links to (link fields pointing at a documents register), with their status. */
export function useItemDocuments(org: string, itemId: string, version: string, enabled = true) {
  return useQuery({
    queryKey: [...panelKeys.documents(itemId), version],
    enabled,
    queryFn: async () => {
      const r = await itemDocumentsAction({ org, itemId });
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    staleTime: 0,
    placeholderData: (prev) => prev,
  });
}

export interface DownloadRow {
  fileId: string;
  userId: string | null;
  at: string;
}

/** Who downloaded these file versions and when (file_access_log, newest first). */
export function useDownloads(fileIds: string[], enabled: boolean) {
  const db = useMemo(() => createClient(), []);
  const key = fileIds.join(',');
  return useQuery({
    queryKey: panelKeys.downloads(key),
    enabled: enabled && fileIds.length > 0,
    queryFn: async (): Promise<DownloadRow[]> =>
      must(
        await db
          .from('file_access_log')
          .select('file_id, user_id, at')
          .in('file_id', key.split(','))
          .order('at', { ascending: false })
          .limit(200),
      ).map((r) => ({ fileId: r.file_id, userId: r.user_id, at: r.at })),
    staleTime: 0,
  });
}

/** The workspace's file categories (orgs.settings.fileCategories, else the defaults). */
export function useFileCategories(org: string) {
  const db = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: panelKeys.categories(org),
    queryFn: async () => {
      const { data } = await db.from('orgs').select('settings').eq('slug', org).maybeSingle();
      return fileCategories(data?.settings);
    },
    staleTime: 5 * 60_000,
  });
}

/** A file entry whose name, description or version note is a personal-data marker. */
function hasMaskedKeys(v: Json | null): boolean {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    ['filename', 'description', 'version_note'].some((k) => isMaskedValue(v[k]))
  );
}

/** An item.created entry whose values hold a restricted value's marker. */
function hasMaskedValues(e: ActivityEntry): boolean {
  const v = e.newValue;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const values = v.values;
  return (
    !!values &&
    typeof values === 'object' &&
    !Array.isArray(values) &&
    Object.values(values).some((x) => isMaskedValue(x))
  );
}
