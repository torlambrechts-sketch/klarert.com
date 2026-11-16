import 'server-only';
import { cache } from 'react';
import { activityLine, isItemEntry, type ActivityEntry } from '@/engine/activity';
import { checklist, type ChecklistStep, type InstalledPack } from '@/engine/home';
import { buildMyWork, type MyWork, type OpenRequest, type WorkSource } from '@/engine/my-work';
import { emptySheetData, sheetCtx, todayIn } from '@/engine/sheet-data';
import type { Item } from '@/engine/types';
import type { Json } from '@/lib/database.types';
import {
  fetchAttached,
  fetchAllPages,
  fetchDirectory,
  fetchItemsById,
  fetchLiveSheets,
  fetchRelated,
  fetchSheetMeta,
  type Db,
  fetchSubitemContext,
  mergeSubitemContext,
} from '@/lib/sheet-query';
import { SHEET_COLUMNS, toField, toItem } from '@/lib/sheet-rows';
import { getSession } from '@/server/auth';
import { getMyApprovals } from './approvals';
import { newId } from '@/server/sheet-context';

// Reads for My work, the rail badge and Home (docs/05 §4). Run under the person's session and RLS: the items are the
// ones a people field gives them (items_for_people, SECURITY INVOKER) and those with an open request to them.

/** Items a person can be in at most; My work lists the most recently changed first beyond this. */
const MAX_ITEMS = 500;

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export interface WorkContext {
  work: MyWork;
  today: string;
  timeZone: string;
}

/** My work of one person, read with the given client (exported for its paging test). */
export async function loadMyWork(db: Db, orgId: string, userId: string, timeZone: string) {
  const now = new Date();
  const [assigned, requestRows, liveSheets] = await Promise.all([
    db.rpc('items_for_people', { p_org: orgId, p_people: [userId], p_limit: MAX_ITEMS }).then(must),
    db
      .from('notifications')
      .select('id, item_id, body, created_at')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .eq('kind', 'request')
      .is('done_at', null)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(must),
    fetchLiveSheets(db, orgId),
  ]);
  const live = new Set(liveSheets.map((s) => s.id));
  const items = new Map<string, Item>();
  for (const r of assigned) items.set(r.id, toItem(r));
  const requests: OpenRequest[] = requestRows
    .filter((r): r is typeof r & { item_id: string } => !!r.item_id)
    .map((r) => ({ id: r.id, itemId: r.item_id, body: r.body, createdAt: r.created_at }));
  const missing = [...new Set(requests.map((r) => r.itemId))].filter((id) => !items.has(id));
  for (const it of await fetchItemsById(db, missing)) items.set(it.id, it);

  const bySheet = new Map<string, Item[]>();
  for (const it of items.values()) {
    if (it.archivedAt || !live.has(it.sheetId)) continue;
    bySheet.set(it.sheetId, [...(bySheet.get(it.sheetId) ?? []), it]);
  }
  const directory = await fetchDirectory(db, orgId);
  const sources: WorkSource[] = [];
  await Promise.all(
    [...bySheet].map(async ([sheetId, list]) => {
      const meta = await fetchSheetMeta(db, sheetId);
      if (!meta || meta.sheet.orgId !== orgId) return;
      const attached = await fetchAttached(
        db,
        meta.fields,
        list.map((i) => i.id),
      );
      const related = await fetchRelated(
        db,
        sheetId,
        new Set(list.map((i) => i.id)),
        attached.links.map((l) => l.toItem),
      );
      // sub-items show their parent as context (docs/05 §3.6)
      const data = mergeSubitemContext(
        { ...meta, ...directory, items: list, ...attached, related },
        meta.sheet.parentSheetId
          ? await fetchSubitemContext(db, meta.sheet, list)
          : {
              links: [],
              files: [],
              protectedValues: [],
              related: { sheets: [], fields: [], items: [] },
            },
      );
      const ctx = sheetCtx(data, { now, timeZone, userId, newId });
      for (const item of list) sources.push({ item, ctx });
    }),
  );
  return { work: buildMyWork(sources, userId, requests), today: todayIn(now, timeZone) };
}

/** My work for the signed-in person in a workspace (cached per request: the rail badge and the page share it). */
export const getMyWork = cache(
  async (orgId: string, timeZone: string): Promise<WorkContext | null> => {
    const session = await getSession();
    if (!session) return null;
    const { work, today } = await loadMyWork(session.supabase, orgId, session.user.id, timeZone);
    return { work, today, timeZone };
  },
);

/** The rail badge: overdue items, open requests to me and approvals waiting for me. Never fails the page. */
export const getMyWorkBadge = cache(async (orgId: string, timeZone: string): Promise<number> => {
  try {
    const [work, approvals] = await Promise.all([
      getMyWork(orgId, timeZone),
      getMyApprovals(orgId),
    ]);
    return (work?.work.badge ?? 0) + (approvals?.length ?? 0);
  } catch (e) {
    console.error(
      JSON.stringify({
        level: 'error',
        source: 'my-work',
        message: e instanceof Error ? e.message : String(e),
      }),
    );
    return 0;
  }
});

// ───────────────────────── Home ─────────────────────────

const count = (r: { count: number | null; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.count ?? 0;
};

export interface HomeData {
  checklist: ChecklistStep[];
  firstSheetId: string | null;
  firstItem: { sheetId: string; displayId: string } | null;
  recent: RecentActivity[];
  /** The workspace's live pack installs: Getting started hides once a standard is among them (showGettingStarted). */
  packs: InstalledPack[];
}

export interface RecentActivity {
  id: number;
  at: string;
  who: string;
  text: string;
  item: { sheetId: string; sheetName: string; displayId: string; name: string };
}

export const RECENT_MAX = 10;

export const getHome = cache(async (orgId: string, timeZone: string): Promise<HomeData | null> => {
  const session = await getSession();
  if (!session) return null;
  const db = session.supabase;
  const head = { count: 'exact' as const, head: true };
  const [sheets, items, statusFields, members, invites, automations, firstSheet, recent, packs] =
    await Promise.all([
      db.from('sheets').select('id', head).eq('org_id', orgId).is('archived_at', null).then(count),
      db.from('items').select('id', head).eq('org_id', orgId).is('archived_at', null).then(count),
      db
        .from('fields')
        .select('id', head)
        .eq('org_id', orgId)
        .eq('type', 'status')
        .is('archived_at', null)
        .then(count),
      db.from('memberships').select('user_id', head).eq('org_id', orgId).then(count),
      // admins only (RLS); others see 0 and rely on members
      db.from('invites').select('id', head).eq('org_id', orgId).is('accepted_at', null).then(count),
      db.from('automations').select('id', head).eq('org_id', orgId).then(count),
      db
        .from('sheets')
        .select('id')
        .eq('org_id', orgId)
        .is('archived_at', null)
        .order('position')
        .limit(1)
        .then(must),
      db
        .from('activity_log')
        .select(
          'id, at, actor_kind, actor_id, action, field_id, old_value, new_value, note, hash, item_id, sheet_id',
        )
        .eq('org_id', orgId)
        .not('item_id', 'is', null)
        .order('id', { ascending: false })
        .limit(RECENT_MAX * 3)
        .then(must),
      installedPacks(db, orgId),
    ]);
  const firstSheetId = firstSheet[0]?.id ?? null;
  let firstItem: HomeData['firstItem'] = null;
  if (firstSheetId) {
    const { data } = await db
      .from('items')
      .select('display_id')
      .eq('sheet_id', firstSheetId)
      .is('archived_at', null)
      .order('seq')
      .limit(1);
    if (data?.[0]) firstItem = { sheetId: firstSheetId, displayId: data[0].display_id };
  }
  const meta = session.user.user_metadata as { opened_activity_log?: unknown } | undefined;
  return {
    checklist: checklist({
      sheets,
      items,
      statusFields,
      colleagues: Math.max(0, members - 1) + invites,
      automations,
      openedActivityLog: meta?.opened_activity_log === true,
    }),
    firstSheetId,
    firstItem,
    packs,
    recent: await recentActivity(
      db,
      orgId,
      timeZone,
      recent.filter(isItemEntry).slice(0, RECENT_MAX),
    ),
  };
});

/** The live pack installs, each with its installed manifest's system flag and whether it has a guided setup. */
async function installedPacks(db: Db, orgId: string): Promise<InstalledPack[]> {
  const installs = must(
    await db
      .from('pack_installs')
      .select('pack_key, version')
      .eq('org_id', orgId)
      .eq('status', 'installed'),
  );
  if (!installs.length) return [];
  const rows = must(
    await db
      .from('packs')
      .select('key, version, system:manifest->system, setup:manifest->setup->>title')
      .in('key', [...new Set(installs.map((i) => i.pack_key))]),
  );
  return installs.map((i) => {
    const row = rows.find((r) => r.key === i.pack_key && r.version === i.version);
    return { key: i.pack_key, system: row?.system === true, setup: !!row?.setup };
  });
}

type LogRow = {
  id: number;
  at: string;
  actor_kind: string;
  actor_id: string | null;
  action: string;
  field_id: string | null;
  old_value: Json | null;
  new_value: Json | null;
  note: string | null;
  hash: string;
  item_id: string | null;
  sheet_id: string | null;
};

/** Readable lines for the latest entries across sheets (the same sentences as the item panel's log). */
async function recentActivity(
  db: Db,
  orgId: string,
  timeZone: string,
  rows: LogRow[],
): Promise<RecentActivity[]> {
  if (rows.length === 0) return [];
  const itemIds = [...new Set(rows.map((r) => r.item_id!))];
  const sheetIds = [...new Set(rows.map((r) => r.sheet_id).filter((s): s is string => !!s))];
  const [items, sheets, fields, groups, autos, directory] = await Promise.all([
    fetchItemsById(db, itemIds),
    db.from('sheets').select(SHEET_COLUMNS).in('id', sheetIds).then(must),
    fetchAllPages((from, to) =>
      db
        .from('fields')
        .select(
          'id, org_id, sheet_id, key, name, type, position, width, required, locked, description, config, validation, rules, visibility, archived_at',
        )
        .in('sheet_id', sheetIds)
        .order('id')
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      db.from('groups').select('id, name').in('sheet_id', sheetIds).order('id').range(from, to),
    ),
    fetchAllPages((from, to) =>
      db.from('automations').select('id, name').eq('org_id', orgId).order('id').range(from, to),
    ),
    fetchDirectory(db, orgId),
  ]);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const sheetById = new Map(sheets.map((s) => [s.id, s]));
  const allFields = fields.map(toField);
  const liveFields = new Set(fields.filter((f) => !f.archived_at).map((f) => f.id));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const autoName = new Map(autos.map((a) => [a.id, a.name]));
  const now = new Date();
  const out: RecentActivity[] = [];
  for (const r of rows) {
    const item = itemById.get(r.item_id!);
    const sheet = item ? sheetById.get(item.sheetId) : undefined;
    if (!item || !sheet) continue;
    const ctx = sheetCtx(
      {
        ...emptySheetData({
          id: sheet.id,
          orgId: sheet.org_id,
          name: sheet.name,
          itemLabel: sheet.item_label,
          idPrefix: sheet.id_prefix ?? '',
          isLibrary: sheet.is_library,
        }),
        ...directory,
        fields: allFields.filter((f) => f.sheetId === sheet.id && liveFields.has(f.id)),
        items: [item],
      },
      { now, timeZone, userId: '', newId },
    );
    const entry: ActivityEntry = {
      id: r.id,
      at: r.at,
      actorKind: r.actor_kind as ActivityEntry['actorKind'],
      actorId: r.actor_id,
      action: r.action,
      fieldId: r.field_id,
      oldValue: r.old_value as ActivityEntry['oldValue'],
      newValue: r.new_value as ActivityEntry['newValue'],
      note: r.note,
      hash: r.hash,
    };
    const line = activityLine(entry, {
      ctx,
      field: (id) => allFields.find((f) => f.id === id),
      groupName: (id) => groupName.get(id),
      displayId: (id) => itemById.get(id)?.displayId,
      personName: (id) => ctx.people.get(id)?.name,
      automationName: (id) => autoName.get(id),
    });
    out.push({
      id: r.id,
      at: r.at,
      who: line.who,
      text: line.text,
      item: {
        sheetId: sheet.id,
        sheetName: sheet.name,
        displayId: item.displayId,
        name: item.name,
      },
    });
  }
  return out;
}
