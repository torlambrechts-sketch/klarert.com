'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { buttonKey, useRunningButtons } from '@/components/automations/running-buttons';
import {
  addFieldAction,
  addFieldOptionAction,
  archiveItemsAction,
  duplicateItemsAction,
  bulkSetValuesAction,
  changeFieldTypeAction,
  clickButtonAction,
  createItemAction,
  createSubitemAction,
  moveSubitemAction,
  subitemsFromTemplateAction,
  finishItemAction,
  deleteFieldAction,
  duplicateFieldAction,
  lockItemAction,
  moveFieldAction,
  moveItemsAction,
  restoreFieldAction,
  setLinksAction,
  setValuesAction,
  updateFieldAction,
} from '@/app/[org]/s/grid-actions';
import { keyBetween } from '@/engine/ordering';
import { resolveFieldType } from '@/engine/fields/resolve';
import type { SheetData } from '@/engine/sheet-data';
import type { Field, FileRow, Item, Json } from '@/engine/types';
import {
  addFile,
  addRelated,
  missingItems,
  moveItem,
  patchRelated,
  patchItem,
  removeField,
  removeGroup,
  removeItems,
  removeLink,
  setLinks as setLinksIn,
  setProtected,
  shouldApplyRemote,
  upsertField,
  upsertGroup,
  upsertItem,
  upsertLink,
} from '@/lib/sheet-cache';
import { fetchAllPages, fetchItemsById, fetchRelated, fetchSheetData } from '@/lib/sheet-query';
import {
  toField,
  toGroup,
  toItem,
  toLink,
  type FieldDbRow,
  type GroupDbRow,
  type ItemDbRow,
  type LinkDbRow,
} from '@/lib/sheet-rows';
import { createClient } from '@/lib/supabase/client';
import type { CommandError, Result } from '@/server/result';

// Server state for one open sheet: the TanStack Query cache (SheetData), realtime patches (docs/02 §9) and the
// write actions with optimistic updates, rollback and toasts. Mutations never retry (docs/02 §5).

export const sheetKey = (sheetId: string) => ['sheet', sheetId] as const;

type Pending = { add(id: string): void; done(id: string): void; has(id: string): boolean };

function usePending(): Pending {
  const ref = useRef(new Map<string, number>());
  return useMemo(
    () => ({
      add: (id) => ref.current.set(id, (ref.current.get(id) ?? 0) + 1),
      done: (id) => {
        const n = (ref.current.get(id) ?? 1) - 1;
        if (n <= 0) ref.current.delete(id);
        else ref.current.set(id, n);
      },
      has: (id) => (ref.current.get(id) ?? 0) > 0,
    }),
    [],
  );
}

export function useSheetQuery(sheetId: string, enabled = true) {
  const db = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: sheetKey(sheetId),
    enabled,
    queryFn: async () => {
      const d = await fetchSheetData(db, sheetId);
      if (!d) throw new Error('This sheet no longer exists or you cannot see it.');
      return d;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/** The workspace's sheets (link targets in field settings): every page, not just the API's first 1000 rows. */
export function useSheetsList(orgId: string | undefined) {
  return useQuery({
    queryKey: ['sheets-list', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const db = createClient();
      const data = await fetchAllPages((from, to) =>
        db
          .from('sheets')
          .select('id, name, is_library')
          .eq('org_id', orgId!)
          .is('archived_at', null)
          .order('name')
          .order('id')
          .range(from, to),
      );
      return data.map((s) => ({ id: s.id, name: s.name, isLibrary: s.is_library }));
    },
    staleTime: 60_000,
  });
}

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

/** Subscribe to the sheet's rows and patch the cache; reconnects refetch so nothing is missed. */
export function useSheetRealtime(sheetId: string | null, pending: Pending): RealtimeStatus {
  const qc = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  useEffect(() => {
    // a sheet without sub-items has no child sheet to follow
    if (!sheetId) return;
    const db = createClient();
    const key = sheetKey(sheetId);
    const patch = (fn: (d: SheetData) => SheetData) =>
      qc.setQueryData<SheetData>(key, (d) => (d ? fn(d) : d));
    let wasLive = false;
    let cancelled = false;
    let channel: ReturnType<typeof db.channel> | null = null;
    (async () => {
      const { data } = await db.auth.getSession();
      if (cancelled) return;
      if (data.session) db.realtime.setAuth(data.session.access_token);
      channel = db
        .channel(`sheet:${sheetId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'items', filter: `sheet_id=eq.${sheetId}` },
          (p) => {
            const row = p.new as ItemDbRow | undefined;
            if (!row?.id) return;
            const item = toItem(row);
            // the echo of my own new item can arrive before the command answers: it replaces the temporary row
            patch((d) => {
              if (p.eventType !== 'INSERT' || d.items.some((i) => i.id === item.id)) return d;
              const temp = d.items.find(
                (i) =>
                  i.id.startsWith('temp-') && i.groupId === item.groupId && i.name === item.name,
              );
              return temp ? removeItems(d, [temp.id]) : d;
            });
            patch((d) =>
              shouldApplyRemote(
                d.items.find((i) => i.id === item.id),
                item,
                pending,
              )
                ? upsertItem(d, item)
                : d,
            );
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'fields', filter: `sheet_id=eq.${sheetId}` },
          (p) => {
            const row = p.new as FieldDbRow | undefined;
            if (p.eventType === 'DELETE')
              return patch((d) => removeField(d, (p.old as { id: string }).id));
            if (row?.id)
              patch((d) => upsertField(d, { ...toField(row), archivedAt: row.archived_at }));
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'groups', filter: `sheet_id=eq.${sheetId}` },
          (p) => {
            if (p.eventType === 'DELETE')
              return patch((d) => removeGroup(d, (p.old as { id: string }).id));
            const row = p.new as GroupDbRow | undefined;
            if (row?.id) patch((d) => upsertGroup(d, toGroup(row)));
          },
        )
        // item_links has no sheet_id: RLS limits events to the workspace and upsertLink keeps this sheet's fields
        .on('postgres_changes', { event: '*', schema: 'public', table: 'item_links' }, (p) => {
          if (p.eventType === 'DELETE')
            return patch((d) => removeLink(d, (p.old as { id: string }).id));
          const row = p.new as LinkDbRow | undefined;
          if (!row?.id || pending.has(row.from_item)) return;
          const cached = qc.getQueryData<SheetData>(key);
          patch((d) => upsertLink(d, toLink(row)));
          // a target this sheet has not loaded: fetch it so the chip, lookups and rollups can read it
          if (
            cached &&
            cached.fields.some((f) => f.id === row.field_id) &&
            missingItems(cached, [row.to_item]).length > 0
          )
            void loadRelatedInto(qc, db, sheetId, [row.to_item]);
        })
        .subscribe((s) => {
          if (s === 'SUBSCRIBED') {
            setStatus('live');
            if (wasLive) void qc.invalidateQueries({ queryKey: key });
            wasLive = true;
          } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
            setStatus('offline');
          }
        });
    })();
    return () => {
      cancelled = true;
      if (channel) void db.removeChannel(channel);
    };
  }, [qc, sheetId, pending]);
  return status;
}

/**
 * Items of the sheets this sheet links to (docs/07 B4: "Actions done" follows an action closed elsewhere without a
 * refresh). One channel for all of them; it is rebuilt when the set of related sheets changes.
 */
export function useRelatedRealtime(sheetId: string, relatedSheetIds: string[]) {
  const qc = useQueryClient();
  const ids = [...new Set(relatedSheetIds)]
    .filter((id) => id !== sheetId)
    .sort()
    .join(',');
  useEffect(() => {
    if (!ids) return;
    const db = createClient();
    const key = sheetKey(sheetId);
    let cancelled = false;
    let channel: ReturnType<typeof db.channel> | null = null;
    // read the related items again: when the channel (re)joins, an update made before it joined was not sent, and
    // every 30 s while the page is visible, because the realtime service can drop events (docs/02 §9)
    const refresh = async () => {
      const related = qc.getQueryData<SheetData>(key)?.related.items.map((i) => i.id) ?? [];
      if (cancelled || related.length === 0) return;
      try {
        const fresh = await fetchItemsById(db, related.slice(0, 500));
        qc.setQueryData<SheetData>(key, (d) => (d ? fresh.reduce(patchRelated, d) : d));
      } catch {
        // the next event or refresh brings them
      }
    };
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30_000);
    (async () => {
      const { data } = await db.auth.getSession();
      if (cancelled) return;
      if (data.session) db.realtime.setAuth(data.session.access_token);
      channel = db
        .channel(`related:${sheetId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'items', filter: `sheet_id=in.(${ids})` },
          (p) => {
            const row = p.new as ItemDbRow | undefined;
            if (!row?.id) return;
            qc.setQueryData<SheetData>(key, (d) => (d ? patchRelated(d, toItem(row)) : d));
          },
        )
        .subscribe((s) => {
          if (s === 'SUBSCRIBED') void refresh();
        });
    })();
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (channel) void db.removeChannel(channel);
    };
  }, [qc, sheetId, ids]);
}

/** Fetch the given items (and their sheets and fields) into `related` when the cache lacks them. */
async function loadRelatedInto(
  qc: ReturnType<typeof useQueryClient>,
  db: ReturnType<typeof createClient>,
  sheetId: string,
  ids: string[],
) {
  const data = qc.getQueryData<SheetData>(sheetKey(sheetId));
  if (!data) return;
  const missing = missingItems(data, ids);
  if (missing.length === 0) return;
  try {
    const more = await fetchRelated(db, sheetId, new Set(data.items.map((i) => i.id)), missing);
    qc.setQueryData<SheetData>(sheetKey(sheetId), (d) => (d ? addRelated(d, more) : d));
  } catch {
    // the chip shows "—" until the next full load; nothing to undo
  }
}

const newMutationId = () => Math.random().toString(36).slice(2, 12);

function showError(error: CommandError) {
  toast.error(error.message);
}

function showMessages(messages: string[] | undefined) {
  for (const m of messages ?? []) toast(m);
}

export type CellResult = { ok: true } | { ok: false; error: CommandError };

/** The write actions of the grid, bound to one sheet. */
export function useSheetActions(org: string, sheetId: string) {
  const qc = useQueryClient();
  const pending = usePending();
  const key = sheetKey(sheetId);
  const get = useCallback(() => qc.getQueryData<SheetData>(key), [qc, key]);
  const patch = useCallback(
    (fn: (d: SheetData) => SheetData) => qc.setQueryData<SheetData>(key, (d) => (d ? fn(d) : d)),
    [qc, key],
  );
  /** Put back the cached versions of these items (rollback of an optimistic change). */
  const restoreItems = useCallback(
    (before: Item[]) => patch((d) => before.reduce((acc, it) => upsertItem(acc, it), d)),
    [patch],
  );

  const { mutateAsync } = useMutation({
    mutationFn: (fn: () => Promise<Result<unknown>>) => fn(),
    retry: false,
  });
  const run = useCallback(
    <T>(fn: () => Promise<Result<T>>) => mutateAsync(fn) as Promise<Result<T>>,
    [mutateAsync],
  );

  /** Load linked items of other sheets that the cache cannot show yet (lookups, rollups, chips). */
  const loadRelated = useCallback(
    (ids: Iterable<string>) => loadRelatedInto(qc, createClient(), sheetId, [...ids]),
    [qc, sheetId],
  );

  /** A file version saved by the upload command (docs/02 §8). */
  const addFileVersion = useCallback(
    (file: FileRow, replaces?: string | null) => patch((d) => addFile(d, file, replaces)),
    [patch],
  );

  // ───────────── edit holds ─────────────
  // Rows edited in the Table or the panel are held: their automations run once when the person finishes the row
  // (another row, Done, panel closed, page hidden, 2 minutes without edits). The scheduler covers closed tabs.
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const heldRef = useRef(new Map<string, number>());
  const markHeld = useCallback((itemId: string) => {
    heldRef.current.set(itemId, Date.now());
    setHeld(new Set(heldRef.current.keys()));
  }, []);
  const finishItem = useCallback(
    async (itemId: string) => {
      if (!heldRef.current.delete(itemId)) return;
      setHeld(new Set(heldRef.current.keys()));
      try {
        const r = await finishItemAction({ org, sheetId, itemId });
        if (!r.ok || !r.data) return;
        patch((d) => upsertItem(d, r.data!.item));
        const [first, ...rest] = r.data.messages;
        if (first && r.data.ran?.length)
          toast(first, {
            action: {
              label: 'View log',
              onClick: () =>
                window.location.assign(`/${org}/automations?sheet=${sheetId}&tab=runs`),
            },
          });
        else if (first) toast(first);
        showMessages(rest);
      } catch {
        // the scheduler releases the hold later
      }
    },
    [org, patch, sheetId],
  );
  /** Finish every held row except `keep` (the row the person is on now). */
  const finishAll = useCallback(
    (keep?: string | null) => {
      for (const id of [...heldRef.current.keys()]) if (id !== keep) void finishItem(id);
    },
    [finishItem],
  );
  // listeners live for the whole page: they read the latest callbacks through a ref, so a re-render (for example the
  // "Editing" marker appearing) never runs the cleanup and releases rows early
  const finishRef = useRef({ finishItem, finishAll });
  finishRef.current = { finishItem, finishAll };
  useEffect(() => {
    const idle = setInterval(() => {
      const now = Date.now();
      for (const [id, at] of heldRef.current)
        if (now - at > 2 * 60 * 1000) void finishRef.current.finishItem(id);
    }, 15_000);
    const hidden = () => {
      if (document.visibilityState === 'hidden') finishRef.current.finishAll();
    };
    const leave = () => finishRef.current.finishAll();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leave);
    return () => {
      clearInterval(idle);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', leave);
      finishRef.current.finishAll();
    };
  }, []);

  /** One cell or the name of one item. Comment-required and conflicts come back to the caller. */
  const setCell = useCallback(
    async (
      item: Item,
      change: {
        fieldId?: string;
        value?: unknown;
        name?: string;
        note?: string;
        expectedUpdatedAt?: string;
        /** Hold the row's automations until the person finishes it. */
        hold?: boolean;
      },
    ): Promise<CellResult> => {
      const data = get();
      const field = change.fieldId ? data?.fields.find((f) => f.id === change.fieldId) : undefined;
      const def = field ? resolveFieldType(field.type) : undefined;
      const before = data?.items.find((i) => i.id === item.id);
      const beforeProtected = data?.protectedValues;
      pending.add(item.id);
      if (field && def?.storage === 'protected') {
        patch((d) =>
          setProtected(d, {
            itemId: item.id,
            fieldId: field.id,
            value: (change.value as string | null) ?? null,
          }),
        );
      } else {
        patch((d) =>
          patchItem(d, item.id, {
            values: field ? { [field.id]: (change.value ?? null) as Json | null } : undefined,
            name: change.name,
          }),
        );
      }
      const mutationId = newMutationId();
      try {
        const r = await run(() =>
          setValuesAction({
            org,
            sheetId,
            itemId: item.id,
            mutationId,
            ...(field ? { values: { [field.id]: change.value ?? null } } : {}),
            ...(change.name !== undefined ? { name: change.name } : {}),
            ...(change.note ? { note: change.note } : {}),
            ...(change.expectedUpdatedAt ? { expectedUpdatedAt: change.expectedUpdatedAt } : {}),
            ...(change.hold ? { hold: true } : {}),
          }),
        );
        if (!r.ok) {
          if (before) restoreItems([before]);
          if (beforeProtected) patch((d) => ({ ...d, protectedValues: beforeProtected }));
          if (r.error.code !== 'comment_required' && r.error.code !== 'conflict')
            showError(r.error);
          return { ok: false, error: r.error };
        }
        patch((d) => upsertItem(d, r.data.item));
        if (r.data.held) markHeld(item.id);
        showMessages(r.data.messages);
        return { ok: true };
      } catch {
        if (before) restoreItems([before]);
        const error: CommandError = {
          code: 'failed',
          message: 'The change was not saved. Check your connection and try again.',
        };
        showError(error);
        return { ok: false, error };
      } finally {
        pending.done(item.id);
      }
    },
    [get, markHeld, org, patch, pending, restoreItems, run, sheetId],
  );

  /** Paste, clear and bulk edit. Undo puts the previous values back. */
  const bulkSet = useCallback(
    async (
      changes: { itemId: string; values?: Record<string, Json | null>; name?: string }[],
      opts: { message?: string; undo?: boolean } = {},
    ) => {
      if (changes.length === 0) {
        if (opts.message) toast(opts.message);
        return;
      }
      const data = get();
      const before = (data?.items ?? []).filter((i) => changes.some((c) => c.itemId === i.id));
      const undo = before.map((it) => {
        const c = changes.find((x) => x.itemId === it.id)!;
        return {
          itemId: it.id,
          values: Object.fromEntries(
            Object.keys(c.values ?? {}).map((k) => [k, it.values[k] ?? null]),
          ),
          ...(c.name !== undefined ? { name: it.name } : {}),
        };
      });
      changes.forEach((c) => pending.add(c.itemId));
      patch((d) =>
        changes.reduce((acc, c) => patchItem(acc, c.itemId, { values: c.values, name: c.name }), d),
      );
      try {
        const r = await run(() =>
          bulkSetValuesAction({ org, sheetId, items: changes, mutationId: newMutationId() }),
        );
        if (!r.ok) {
          restoreItems(before);
          return showError(r.error);
        }
        const saved = new Set(r.data.items.map((i) => i.id));
        restoreItems(before.filter((b) => !saved.has(b.id)));
        patch((d) => r.data.items.reduce((acc, it) => upsertItem(acc, it), d));
        const skipped = r.data.skipped.length
          ? ` ${r.data.skipped.length} ${r.data.skipped.length === 1 ? 'item was' : 'items were'} not changed: ${r.data.skipped[0]!.message}`
          : '';
        const text = `${opts.message ?? `${r.data.items.length} ${r.data.items.length === 1 ? 'item' : 'items'} changed.`}${skipped}`;
        // the automations that ran go in the same toast (docs/18 §5: how many changed and which automations ran)
        const ran = r.data.messages.length ? { description: r.data.messages.join(' ') } : {};
        if (opts.undo !== false && r.data.items.length > 0) {
          toast(text, {
            ...ran,
            action: {
              label: 'Undo',
              onClick: () =>
                void bulkSet(
                  undo.filter((u) => saved.has(u.itemId)),
                  { message: 'Change undone.', undo: false },
                ),
            },
          });
        } else toast(text, ran);
      } catch {
        restoreItems(before);
        toast.error('The changes were not saved. Check your connection and try again.');
      } finally {
        changes.forEach((c) => pending.done(c.itemId));
      }
    },
    [get, org, patch, pending, restoreItems, run, sheetId],
  );

  const createItem = useCallback(
    async (
      groupId: string,
      name: string,
      position: string,
      onSaved?: (tempId: string, item: Item) => void,
      /** Values to start with (calendar day, kanban lane, the New item dialog's answers). */
      extra: {
        values?: Record<string, unknown>;
        hold?: boolean;
        /** How it was added (recorded in its activity entry): the New item dialog or an inline row. */
        source?: 'dialog' | 'inline';
        /** The sheet's new-item form the dialog asked (Phase B). */
        intakeFormId?: string;
        /** Handle a refusal (the dialog shows it at its answers) instead of the toast. */
        onError?: (error: CommandError) => void;
      } = {},
    ): Promise<Item | null> => {
      const tempId = `temp-${newMutationId()}`;
      const now = new Date().toISOString();
      const temp: Item = {
        id: tempId,
        sheetId,
        groupId,
        seq: 0,
        displayId: '…',
        name,
        values: {},
        position,
        locked: false,
        createdAt: now,
        updatedAt: now,
      };
      patch((d) => upsertItem(d, temp));
      try {
        const r = await run(() =>
          createItemAction({
            org,
            sheetId,
            groupId,
            name,
            position,
            mutationId: tempId,
            ...(extra.values ? { values: extra.values } : {}),
            ...(extra.hold ? { hold: true } : {}),
            ...(extra.source ? { source: extra.source } : {}),
            ...(extra.intakeFormId ? { intakeFormId: extra.intakeFormId } : {}),
          }),
        );
        patch((d) => removeItems(d, [tempId]));
        if (!r.ok) {
          if (extra.onError) extra.onError(r.error);
          else showError(r.error);
          return null;
        }
        patch((d) => upsertItem(d, r.data.item));
        if (r.data.held) markHeld(r.data.item.id);
        onSaved?.(tempId, r.data.item);
        showMessages(r.data.messages);
        return r.data.item;
      } catch {
        patch((d) => removeItems(d, [tempId]));
        const message = 'The item was not added. Check your connection and try again.';
        if (extra.onError) extra.onError({ code: 'failed', message });
        else toast.error(message);
        return null;
      }
    },
    [markHeld, org, patch, run, sheetId],
  );

  // ───────────── sub-items (this hook bound to a child sheet) ─────────────

  /** Add a sub-item under a parent, inline: held like a new row until the person finishes it. */
  const createSubitem = useCallback(
    async (
      parentId: string,
      name: string,
      position: string,
      extra: { values?: Record<string, unknown>; hold?: boolean } = {},
    ): Promise<Item | null> => {
      const tempId = `temp-${newMutationId()}`;
      const now = new Date().toISOString();
      const groupId = get()?.groups[0]?.id ?? '';
      patch((d) =>
        upsertItem(d, {
          id: tempId,
          sheetId,
          groupId,
          seq: 0,
          displayId: '…',
          name,
          values: {},
          position,
          locked: false,
          createdAt: now,
          updatedAt: now,
          parentId,
        }),
      );
      try {
        const r = await run(() =>
          createSubitemAction({
            org,
            sheetId,
            parentId,
            name,
            position,
            mutationId: tempId,
            ...(extra.values ? { values: extra.values } : {}),
            ...(extra.hold ? { hold: true } : {}),
          }),
        );
        patch((d) => removeItems(d, [tempId]));
        if (!r.ok) {
          showError(r.error);
          return null;
        }
        patch((d) => upsertItem(d, r.data.item));
        if (r.data.held) markHeld(r.data.item.id);
        showMessages(r.data.messages);
        return r.data.item;
      } catch {
        patch((d) => removeItems(d, [tempId]));
        toast.error('The sub-item was not added. Check your connection and try again.');
        return null;
      }
    },
    [get, markHeld, org, patch, run, sheetId],
  );

  /** "From template": the parent sheet's sub-item set under one item. */
  const subitemsFromTemplate = useCallback(
    async (parentSheetId: string, parentId: string): Promise<boolean> => {
      try {
        const r = await run(() =>
          subitemsFromTemplateAction({ org, sheetId: parentSheetId, parentId }),
        );
        if (!r.ok) {
          showError(r.error);
          return false;
        }
        patch((d) => r.data.items.reduce((acc, it) => upsertItem(acc, it), d));
        const n = r.data.items.length;
        toast(`${n} ${n === 1 ? 'sub-item' : 'sub-items'} added from the template.`);
        showMessages(r.data.messages);
        return true;
      } catch {
        toast.error('The sub-items were not added. Check your connection and try again.');
        return false;
      }
    },
    [org, patch, run],
  );

  /** Move a sub-item to another parent (its id stays) or to another place under its own. */
  const moveSubitem = useCallback(
    async (item: Item, parentId: string, position: string, message?: string) => {
      pending.add(item.id);
      patch((d) => upsertItem(d, { ...item, parentId, position }));
      try {
        const r = await run(() =>
          moveSubitemAction({ org, sheetId, itemId: item.id, parentId, position }),
        );
        if (!r.ok) {
          patch((d) => upsertItem(d, item));
          return showError(r.error);
        }
        patch((d) => upsertItem(d, r.data.item));
        if (message) toast(message);
      } catch {
        patch((d) => upsertItem(d, item));
        toast.error('The move was not saved. Check your connection and try again.');
      } finally {
        pending.done(item.id);
      }
    },
    [org, patch, pending, run, sheetId],
  );

  const moveItems = useCallback(
    async (moves: { itemId: string; groupId: string; position: string }[], message?: string) => {
      const before = (get()?.items ?? []).filter((i) => moves.some((m) => m.itemId === i.id));
      moves.forEach((m) => pending.add(m.itemId));
      patch((d) => moves.reduce((acc, m) => moveItem(acc, m.itemId, m.groupId, m.position), d));
      try {
        const r = await run(() =>
          moveItemsAction({ org, sheetId, moves, mutationId: newMutationId() }),
        );
        if (!r.ok) {
          restoreItems(before);
          return showError(r.error);
        }
        const saved = new Set(r.data.items.map((i) => i.id));
        restoreItems(before.filter((b) => !saved.has(b.id)));
        patch((d) => r.data.items.reduce((acc, it) => upsertItem(acc, it), d));
        if (r.data.skipped.length) toast.error(r.data.skipped[0]!.message);
        else if (message) toast(message);
        showMessages(r.data.messages);
      } catch {
        restoreItems(before);
        toast.error('The move was not saved. Check your connection and try again.');
      } finally {
        moves.forEach((m) => pending.done(m.itemId));
      }
    },
    [get, org, patch, pending, restoreItems, run, sheetId],
  );

  /** Duplicate items (docs/18 §5): one copy each, in its item's group, right after it. */
  const duplicateItems = useCallback(
    async (items: Item[]) => {
      const data = get();
      if (!data || items.length === 0) return;
      const sorted = (groupId: string) =>
        data.items
          .filter((i) => i.groupId === groupId && !i.parentId)
          .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
      const copies = items.map((it) => {
        const list = sorted(it.groupId);
        const at = list.findIndex((i) => i.id === it.id);
        const next = list[at + 1]?.position ?? null;
        return { itemId: it.id, position: keyBetween(it.position, next) };
      });
      try {
        const r = await run(() =>
          duplicateItemsAction({ org, sheetId, items: copies, mutationId: newMutationId() }),
        );
        if (!r.ok) return showError(r.error);
        patch((d) => r.data.items.reduce((acc, it) => upsertItem(acc, it), d));
        const n = r.data.items.length;
        const skipped = r.data.skipped.length
          ? ` ${r.data.skipped.length} ${r.data.skipped.length === 1 ? 'item was' : 'items were'} not copied: ${r.data.skipped[0]!.message}`
          : '';
        toast(
          `${n} ${n === 1 ? 'item' : 'items'} duplicated.${skipped}`,
          r.data.messages.length ? { description: r.data.messages.join(' ') } : undefined,
        );
      } catch {
        toast.error('The items were not duplicated. Check your connection and try again.');
      }
    },
    [get, org, patch, run, sheetId],
  );

  const setArchived = useCallback(
    async (itemIds: string[], archived: boolean): Promise<void> => {
      const before = (get()?.items ?? []).filter((i) => itemIds.includes(i.id));
      itemIds.forEach((id) => pending.add(id));
      if (archived) patch((d) => removeItems(d, itemIds));
      try {
        const r = await run(() =>
          archiveItemsAction({ org, sheetId, itemIds, archived, mutationId: newMutationId() }),
        );
        if (!r.ok) {
          if (archived) restoreItems(before);
          return showError(r.error);
        }
        const done = r.data.items.map((i) => i.id);
        if (archived) {
          restoreItems(before.filter((b) => !done.includes(b.id)));
          const n = done.length;
          if (n > 0)
            toast(`${n} ${n === 1 ? 'item' : 'items'} archived.`, {
              action: { label: 'Undo', onClick: () => void setArchived(done, false) },
            });
        } else {
          patch((d) => r.data.items.reduce((acc, it) => upsertItem(acc, it), d));
          toast(`${done.length} ${done.length === 1 ? 'item' : 'items'} restored.`);
        }
        if (r.data.skipped.length) toast.error(r.data.skipped[0]!.message);
        showMessages(r.data.messages);
      } catch {
        if (archived) restoreItems(before);
        toast.error('The change was not saved. Check your connection and try again.');
      } finally {
        itemIds.forEach((id) => pending.done(id));
      }
    },
    [get, org, patch, pending, restoreItems, run, sheetId],
  );

  const setLinks = useCallback(
    async (item: Item, field: Field, to: string[]) => {
      const before =
        get()
          ?.links.filter((l) => l.fieldId === field.id && l.fromItem === item.id)
          .map((l) => l.toItem) ?? [];
      pending.add(item.id);
      patch((d) => setLinksIn(d, field.id, item.id, to));
      try {
        const r = await run(() =>
          setLinksAction({
            org,
            sheetId,
            itemId: item.id,
            fieldId: field.id,
            to,
            mutationId: newMutationId(),
          }),
        );
        if (!r.ok) {
          patch((d) => setLinksIn(d, field.id, item.id, before));
          return showError(r.error);
        }
        patch((d) =>
          r.data.links.reduce((acc, l) => upsertLink(acc, l), setLinksIn(d, field.id, item.id, [])),
        );
        void loadRelated(to);
        showMessages(r.data.messages);
      } catch {
        patch((d) => setLinksIn(d, field.id, item.id, before));
        toast.error('The links were not saved. Check your connection and try again.');
      } finally {
        pending.done(item.id);
      }
    },
    [get, loadRelated, org, patch, pending, run, sheetId],
  );

  const lockItem = useCallback(
    async (item: Item, locked: boolean, reason?: string) => {
      const r = await run(() => lockItemAction({ org, sheetId, itemId: item.id, locked, reason }));
      if (!r.ok) return showError(r.error);
      patch((d) => upsertItem(d, r.data.item));
      toast(locked ? 'Item locked.' : 'Item unlocked.');
    },
    [org, patch, run, sheetId],
  );

  const clickButton = useCallback(
    async (item: Item, field: Field) => {
      const key = buttonKey(item.id, field.id);
      const buttons = useRunningButtons.getState();
      if (buttons.running.has(key)) return;
      buttons.start(key);
      try {
        const r = await run(() =>
          clickButtonAction({ org, sheetId, itemId: item.id, fieldId: field.id }),
        );
        if (!r.ok) return showError(r.error);
        const settled = r.data.item;
        if (settled && !settled.archivedAt) patch((d) => upsertItem(d, settled));
        showMessages(r.data.messages);
      } finally {
        useRunningButtons.getState().stop(key);
      }
    },
    [org, patch, run, sheetId],
  );

  // ───────────── fields ─────────────

  const fieldResult = useCallback(
    (r: Result<{ field: Field }>, success?: string) => {
      if (!r.ok) {
        showError(r.error);
        return null;
      }
      patch((d) => upsertField(d, r.data.field));
      if (success) toast(success);
      return r.data.field;
    },
    [patch],
  );

  const addField = useCallback(
    async (type: string, at?: { beforeFieldId?: string; afterFieldId?: string }, name?: string) =>
      fieldResult(
        await run(() => addFieldAction({ org, sheetId, type, ...at, ...(name ? { name } : {}) })),
        'Field added.',
      ),
    [fieldResult, org, run, sheetId],
  );

  const updateField = useCallback(
    async (field: Field, change: Record<string, unknown>, success?: string) => {
      const before = get()?.fields.find((f) => f.id === field.id);
      const optimistic = { ...field, ...change } as Field;
      patch((d) => upsertField(d, optimistic));
      const r = await run(() => updateFieldAction({ org, fieldId: field.id, ...change }));
      if (!r.ok && before) patch((d) => upsertField(d, before));
      return fieldResult(r, success);
    },
    [fieldResult, get, org, patch, run],
  );

  /** Add an option typed in a picker; the cache holds the field with it before this returns. */
  const addFieldOption = useCallback(
    async (field: Field, label: string) => {
      const r = await run(() =>
        addFieldOptionAction({
          org,
          sheetId,
          fieldId: field.id,
          label,
          mutationId: newMutationId(),
        }),
      );
      if (!r.ok) {
        showError(r.error);
        return null;
      }
      patch((d) => upsertField(d, r.data.field));
      return r.data;
    },
    [org, patch, run, sheetId],
  );

  const moveField = useCallback(
    async (field: Field, toIndex: number) =>
      fieldResult(await run(() => moveFieldAction({ org, fieldId: field.id, toIndex }))),
    [fieldResult, org, run],
  );

  const duplicateField = useCallback(
    async (field: Field) =>
      fieldResult(
        await run(() => duplicateFieldAction({ org, fieldId: field.id })),
        'Field duplicated.',
      ),
    [fieldResult, org, run],
  );

  const restoreField = useCallback(
    async (fieldId: string) =>
      fieldResult(await run(() => restoreFieldAction({ org, fieldId })), 'Field restored.'),
    [fieldResult, org, run],
  );

  const deleteField = useCallback(
    async (field: Field) => {
      patch((d) => removeField(d, field.id));
      const r = await run(() => deleteFieldAction({ org, fieldId: field.id }));
      if (!r.ok) {
        patch((d) => upsertField(d, field));
        return showError(r.error);
      }
      toast(`${field.name} deleted. You can restore it for 30 days.`, {
        action: { label: 'Undo', onClick: () => void restoreField(field.id) },
      });
    },
    [org, patch, restoreField, run],
  );

  const changeType = useCallback(
    async (field: Field, to: string, apply: boolean, replace?: boolean) => {
      const r = await run(() =>
        changeFieldTypeAction({
          org,
          fieldId: field.id,
          to,
          apply,
          ...(replace ? { replace } : {}),
        }),
      );
      if (!r.ok) {
        showError(r.error);
        return null;
      }
      if (apply) {
        await qc.invalidateQueries({ queryKey: key });
        const kept = r.data.failed ? ` ${r.data.failed} locked items kept their old value.` : '';
        const label = r.data.field
          ? (resolveFieldType(r.data.field.type)?.label ?? '').toLowerCase()
          : '';
        if (r.data.mode === 'copy' && r.data.replaced)
          toast(
            `${field.name} is now a ${label} field. The old field can be restored for 30 days.${kept}`,
            { action: { label: 'Undo', onClick: () => void restoreField(field.id) } },
          );
        else if (r.data.mode === 'copy')
          toast(`Added ${r.data.field?.name ?? 'a new field'} next to ${field.name}.${kept}`);
        else toast(`Type changed.${kept}`);
      }
      return r.data;
    },
    [key, org, qc, restoreField, run],
  );

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: key }), [key, qc]);

  return {
    pending,
    held,
    finishItem,
    finishAll,
    /** The cached sheet as it is now (newer than a render's `data` right after a write). */
    current: get,
    refresh,
    loadRelated,
    addFileVersion,
    setCell,
    bulkSet,
    createItem,
    createSubitem,
    subitemsFromTemplate,
    moveSubitem,
    moveItems,
    setArchived,
    duplicateItems,
    setLinks,
    lockItem,
    clickButton,
    addField,
    updateField,
    addFieldOption,
    moveField,
    duplicateField,
    deleteField,
    restoreField,
    changeType,
  };
}

export type SheetActions = ReturnType<typeof useSheetActions>;
