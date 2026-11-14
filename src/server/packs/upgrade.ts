// Pack upgrades on the server (docs/11 Upgrades): read the installed version's manifest and the newest one from the
// catalogue, read what the install made as the workspace holds it now, plan with the pure upgrade planner
// (src/engine/packs/upgrade.ts) and write the plan with upgrade_pack, one transaction. Given a Supabase client (the
// person's, RLS applies); no 'server-only' import so scripts can share it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { compareVersions, parseVersion } from '@/engine/packs/semver';
import { planPackUpgrade, type InstalledState, type UpgradePlan } from '@/engine/packs/upgrade';
import { todayIn } from '@/engine/sheet-data';
import type { Json } from '@/engine/types';
import type { Database } from '@/lib/database.types';
import { parsePack } from '@/lib/packs/manifest';
import {
  loadRequirementItems,
  loadSnapshot,
  manifestRequirementKeys,
  type CataloguePack,
} from './install';

type Db = SupabaseClient<Database>;

function must<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const MAX_ROWS = 9999;

/** One version of a pack from the catalogue (the catalogue keeps every version an install may point at). */
export async function readPackVersion(
  db: Db,
  key: string,
  version: string,
): Promise<CataloguePack | null> {
  const row = must(
    await db
      .from('packs')
      .select('key, version, title, description, hash, manifest')
      .eq('key', key)
      .eq('version', version)
      .maybeSingle(),
    'pack version',
  );
  if (!row) return null;
  return { ...row, manifest: parsePack(row.manifest) };
}

/**
 * The version an install updates to: the newest catalogue version of its pack with the same major version (docs/11
 * Upgrades). A new major version is a rebuild of the pack (Phase 2: a standard rebuilt as an add-on to the Core
 * registers) and is installed fresh, never offered as an update. Null when the install is at that version already.
 */
export function updateTarget(
  install: { pack_key: string; version: string },
  versions: readonly Pick<CataloguePack, 'key' | 'version'>[],
): string | null {
  const major = parseVersion(install.version)?.[0];
  let best: string | null = null;
  for (const c of versions) {
    if (c.key !== install.pack_key || parseVersion(c.version)?.[0] !== major) continue;
    if (
      compareVersions(c.version, install.version) > 0 &&
      (!best || compareVersions(c.version, best) > 0)
    )
      best = c.version;
  }
  return best;
}

/** The newer catalogue version of each live install, by install id (installs already at the newest are left out). */
export function updatesFor(
  installs: { id: string; pack_key: string; version: string; status: string }[],
  versions: readonly Pick<CataloguePack, 'key' | 'version'>[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const i of installs) {
    const v = i.status === 'installed' ? updateTarget(i, versions) : null;
    if (v) out.set(i.id, v);
  }
  return out;
}

/** Every pack version in the catalogue (key and version only): updates pick theirs with updateTarget. */
export async function readPackVersions(db: Db): Promise<{ key: string; version: string }[]> {
  return must(await db.from('packs').select('key, version'), 'pack versions') ?? [];
}

const position = (rows: { position: string }[]) =>
  rows
    .map((r) => r.position)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .at(-1);

function lastBy<T extends { position: string }>(rows: T[], key: (r: T) => string) {
  const by = new Map<string, T[]>();
  for (const r of rows) by.set(key(r), [...(by.get(key(r)) ?? []), r]);
  return Object.fromEntries([...by].map(([k, list]) => [k, position(list)!]));
}

/** A sheet's tab set as stored (settings.tabs and defaultViewId), null when it has none. */
function tabsOf(settings: unknown): { tabs: Json; defaultViewId: Json } | null {
  const st = (settings ?? {}) as { tabs?: Json; defaultViewId?: Json };
  if (st.tabs === undefined && st.defaultViewId === undefined) return null;
  return { tabs: st.tabs ?? null, defaultViewId: st.defaultViewId ?? null };
}

/** What an install made, as the workspace holds it now. */
export async function loadInstalledState(
  db: Db,
  orgId: string,
  install: { id: string; version: string; level: string | null; ref_map: unknown },
): Promise<InstalledState> {
  const [folders, sheets, automations, dashboards] = await Promise.all([
    db.from('folders').select('id, pack_ref, name, archived_at').eq('pack_install_id', install.id),
    db
      .from('sheets')
      .select(
        'id, pack_ref, name, description, item_label, folder_id, parent_sheet_id, archived_at, settings',
      )
      .eq('org_id', orgId)
      .eq('pack_install_id', install.id),
    db
      .from('automations')
      .select('id, pack_ref, sheet_id, name, enabled, trigger, conditions, actions')
      .eq('pack_install_id', install.id),
    db
      .from('dashboards')
      .select('id, pack_ref, name, config, archived_at')
      .eq('pack_install_id', install.id),
  ]);
  const sheetRows = must(sheets, 'sheets') ?? [];
  const sheetIds = sheetRows.map((s) => s.id);
  const none = ['00000000-0000-0000-0000-000000000000'];
  // its own rows on other packs' sheets (docs/11 Extends) are read on those sheets too
  const [extFields, extItems] = await Promise.all([
    db.from('fields').select('sheet_id').eq('pack_install_id', install.id).range(0, MAX_ROWS),
    db.from('items').select('sheet_id').eq('pack_install_id', install.id).range(0, MAX_ROWS),
  ]);
  const extSheets = [
    ...new Set(
      [...(must(extFields, 'fields') ?? []), ...(must(extItems, 'items') ?? [])].map(
        (r) => r.sheet_id,
      ),
    ),
  ].filter((id) => !sheetIds.includes(id));
  const ids = sheetIds.length || extSheets.length ? [...sheetIds, ...extSheets] : none;
  const [fields, groups, views, items, created] = await Promise.all([
    db
      .from('fields')
      .select(
        'id, pack_ref, pack_install_id, sheet_id, key, name, type, description, required, locked, config, archived_at, position',
      )
      .in('sheet_id', ids)
      .range(0, MAX_ROWS),
    db
      .from('groups')
      .select('id, pack_ref, pack_install_id, sheet_id, name, color, position')
      .in('sheet_id', ids)
      .range(0, MAX_ROWS),
    db
      .from('views')
      .select('id, pack_ref, pack_install_id, sheet_id, name, type, config, position')
      .in('sheet_id', ids)
      .range(0, MAX_ROWS),
    db
      .from('items')
      .select(
        'id, pack_ref, pack_install_id, sheet_id, group_id, name, values, archived_at, requirement_ref, position',
      )
      .in('sheet_id', ids)
      .range(0, MAX_ROWS),
    db
      .from('activity_log')
      .select('item_id, new_value, id')
      .eq('org_id', orgId)
      .eq('action', 'item.created')
      .in('sheet_id', ids)
      .order('id')
      .range(0, MAX_ROWS),
  ]);
  const own = <T extends { pack_install_id: string | null }>(rows: T[] | null) =>
    (rows ?? []).filter((r) => r.pack_install_id === install.id);
  const fieldRows = must(fields, 'fields') ?? [];
  const groupRows = must(groups, 'groups') ?? [];
  const viewRows = must(views, 'views') ?? [];
  const itemRows = must(items, 'items') ?? [];
  const createdBy = new Map<string, Record<string, Json>>();
  for (const e of must(created, 'activity') ?? [])
    if (e.item_id && !createdBy.has(e.item_id) && e.new_value && typeof e.new_value === 'object')
      createdBy.set(e.item_id, e.new_value as Record<string, Json>);
  const clientItems = new Map<string, number>();
  for (const i of itemRows)
    if (!i.pack_install_id && !i.archived_at && sheetIds.includes(i.sheet_id))
      clientItems.set(i.sheet_id, (clientItems.get(i.sheet_id) ?? 0) + 1);
  const liveItems = itemRows.filter((i) => !i.archived_at);

  return {
    installId: install.id,
    version: install.version,
    level: install.level,
    refMap: (install.ref_map ?? {}) as Record<string, string>,
    folders: (must(folders, 'folders') ?? []).map((f) => ({
      id: f.id,
      ref: f.pack_ref ?? '',
      name: f.name,
      archived: !!f.archived_at,
    })),
    sheets: sheetRows.map((s) => ({
      id: s.id,
      ref: s.pack_ref ?? '',
      name: s.name,
      description: s.description ?? null,
      itemLabel: s.item_label,
      folderId: s.folder_id,
      parentSheetId: s.parent_sheet_id,
      archived: !!s.archived_at,
      clientItems: clientItems.get(s.id) ?? 0,
      workflows: ((s.settings as { workflows?: Json } | null)?.workflows ?? []) as Json,
      tabs: tabsOf(s.settings),
    })),
    fields: own(fieldRows).map((f) => ({
      id: f.id,
      ref: f.pack_ref ?? '',
      sheetId: f.sheet_id,
      key: f.key,
      name: f.name,
      type: f.type,
      description: f.description ?? null,
      required: f.required,
      locked: f.locked,
      config: f.config as Json,
      archived: !!f.archived_at,
    })),
    groups: own(groupRows).map((g) => ({
      id: g.id,
      ref: g.pack_ref ?? '',
      sheetId: g.sheet_id,
      name: g.name,
      color: g.color,
    })),
    views: own(viewRows).map((v) => ({
      id: v.id,
      ref: v.pack_ref ?? '',
      sheetId: v.sheet_id,
      name: v.name,
      type: v.type,
      config: v.config as Json,
    })),
    items: own(itemRows).map((i) => {
      const c = createdBy.get(i.id);
      return {
        id: i.id,
        ref: i.pack_ref ?? '',
        sheetId: i.sheet_id,
        groupId: i.group_id,
        name: i.name,
        values: (i.values ?? {}) as Record<string, Json>,
        archived: !!i.archived_at,
        requirementRef: i.requirement_ref ?? null,
        installed: c
          ? {
              name: String(c.name ?? ''),
              groupId: String(c.group_id ?? ''),
              values: (c.values ?? {}) as Record<string, Json>,
            }
          : null,
      };
    }),
    automations: (must(automations, 'automations') ?? []).map((a) => ({
      id: a.id,
      ref: a.pack_ref ?? '',
      sheetId: a.sheet_id,
      name: a.name,
      enabled: a.enabled,
      trigger: a.trigger as Json,
      conditions: a.conditions as Json,
      actions: a.actions as Json,
    })),
    dashboards: (must(dashboards, 'dashboards') ?? []).map((d) => ({
      id: d.id,
      ref: d.pack_ref ?? '',
      name: d.name,
      config: d.config as Json,
      archived: !!d.archived_at,
    })),
    lastPosition: {
      fields: lastBy(
        fieldRows.filter((f) => !f.archived_at),
        (f) => f.sheet_id,
      ),
      groups: lastBy(groupRows, (g) => g.sheet_id),
      views: lastBy(viewRows, (v) => v.sheet_id),
      items: lastBy(liveItems, (i) => i.group_id),
    },
  };
}

export type PlannedUpgrade =
  | { ok: true; plan: UpgradePlan; from: CataloguePack; to: CataloguePack }
  | { ok: false; code: 'not_found' | 'conflict'; message: string };

/** Plan the upgrade of a live install to the catalogue's newest version of its major, as the workspace is now. */
export async function planUpgrade(
  db: Db,
  orgId: string,
  installId: string,
  env: {
    userId: string;
    now: Date;
    newId: () => string;
    choices?: Record<string, 'mine' | 'theirs'>;
  },
): Promise<PlannedUpgrade> {
  const install = must(
    await db
      .from('pack_installs')
      .select('id, pack_key, version, status, level, ref_map, manifest_hash')
      .eq('org_id', orgId)
      .eq('id', installId)
      .maybeSingle(),
    'pack install',
  );
  if (!install || install.status !== 'installed')
    return { ok: false, code: 'not_found', message: 'This pack is no longer installed.' };
  const target = updateTarget(install, await readPackVersions(db));
  const to = target ? await readPackVersion(db, install.pack_key, target) : null;
  const from = await readPackVersion(db, install.pack_key, install.version);
  if (!to || !from)
    return { ok: false, code: 'not_found', message: 'This pack is no longer in the catalogue.' };
  const [{ snapshot, timeZone }, state, extenders] = await Promise.all([
    loadSnapshot(db, orgId, to.manifest),
    loadInstalledState(db, orgId, install),
    loadExtenders(db, orgId, install.pack_key),
  ]);
  snapshot.requirementItems = await loadRequirementItems(
    db,
    orgId,
    snapshot.libraries ?? [],
    manifestRequirementKeys(to.manifest),
  );
  const plan = planPackUpgrade({
    from: { manifest: from.manifest, hash: install.manifest_hash },
    to: { manifest: to.manifest, hash: to.hash },
    state,
    snapshot,
    env: {
      today: todayIn(env.now, timeZone),
      now: env.now,
      timeZone,
      newId: env.newId,
      userId: env.userId,
    },
    choices: env.choices,
    extenders,
  });
  return { ok: true, plan, from, to };
}

/** The live installs that build on a pack (name it in requires), with their installed manifests (docs/11 Extends). */
async function loadExtenders(
  db: Db,
  orgId: string,
  packKey: string,
): Promise<{ title: string; manifest: CataloguePack['manifest'] }[]> {
  const installs =
    must(
      await db
        .from('pack_installs')
        .select('pack_key, version')
        .eq('org_id', orgId)
        .eq('status', 'installed')
        .neq('pack_key', packKey),
      'pack installs',
    ) ?? [];
  if (!installs.length) return [];
  // only the catalogue rows that name this pack in requires, at the versions installed here
  const rows =
    must(
      await db
        .from('packs')
        .select('key, version, title, manifest')
        .in(
          'key',
          installs.map((i) => i.pack_key),
        )
        .contains('manifest', { requires: [{ pack: packKey }] }),
      'packs',
    ) ?? [];
  return rows
    .filter((r) => installs.some((i) => i.pack_key === r.key && i.version === r.version))
    .map((r) => ({ title: r.title, manifest: parsePack(r.manifest) }));
}

/** Write a ready upgrade plan: upgrade_pack and the sheets' approval workflows (apply_pack_upgrade), all or nothing. */
export async function writeUpgrade(
  db: Db,
  plan: UpgradePlan,
): Promise<
  | { ok: true; data: { version: string; counts: Record<string, Json> } }
  | { ok: false; error: { message: string; code?: string } }
> {
  if (!plan.payload) return { ok: false, error: { message: 'There is nothing to update.' } };
  const { data, error } = await db.rpc('apply_pack_upgrade', {
    p_install: plan.payload.install,
    p_plan: plan.payload as unknown as Json,
  });
  if (error) return { ok: false, error };
  const out = data as { version: string; counts: Record<string, Json> };
  return { ok: true, data: { version: out.version, counts: out.counts } };
}
