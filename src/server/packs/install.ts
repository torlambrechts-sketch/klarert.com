// Packs on the server (docs/11): read the catalogue, take a snapshot of a workspace, plan with the pure planner
// (src/engine/packs/plan.ts) and write the plan with install_pack, one transaction. Given a Supabase client, so the
// commands (the person's client, RLS) and the seed (service role, scripts/seed.ts) share it; no 'server-only' import.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  foreignKey,
  foreignSheets,
  neededLevel,
  STANDARDS_KEY,
  type ForeignSheet,
} from '@/engine/packs/extend';
import { defaultLevel, levelRank } from '@/engine/packs/levels';
import {
  planPackInstall,
  type InstallFirst,
  type PackPlan,
  type PackSnapshot,
} from '@/engine/packs/plan';
import { satisfies } from '@/engine/packs/semver';
import type { PackManifest } from '@/engine/packs/types';
import { todayIn } from '@/engine/sheet-data';
import type { Json } from '@/engine/types';
import type { Database } from '@/lib/database.types';
import { parsePack } from '@/lib/packs/manifest';
import { packHash } from '@/lib/packs/hash';

type Db = SupabaseClient<Database>;

function must<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

export interface CataloguePack {
  key: string;
  version: string;
  title: string;
  description: string;
  hash: string;
  manifest: PackManifest;
}

/** The newest version of every pack in the catalogue (the `packs` table), manifests checked again. */
export async function readCatalogue(db: Db): Promise<CataloguePack[]> {
  const rows = must(
    await db.from('packs').select('key, version, title, description, hash, manifest'),
    'packs',
  );
  const newest = new Map<string, NonNullable<typeof rows>[number]>();
  const v = (s: string) =>
    s
      .split('.')
      .map((n) => n.padStart(6, '0'))
      .join('.');
  for (const r of rows ?? []) {
    const cur = newest.get(r.key);
    if (!cur || v(r.version) > v(cur.version)) newest.set(r.key, r);
  }
  return [...newest.values()]
    .flatMap((r) => {
      try {
        return [{ ...r, manifest: parsePack(r.manifest) }];
      } catch (e) {
        // a manifest this code cannot read any more is left out of the catalogue, not the whole list
        console.warn(
          JSON.stringify({ level: 'warn', source: 'packs', pack: r.key, error: String(e) }),
        );
        return [];
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function readPack(db: Db, key: string): Promise<CataloguePack | null> {
  return (await readCatalogue(db)).find((p) => p.key === key) ?? null;
}

/** What the planner needs to know about a workspace (and, for `manifest`, the sheets of the packs it requires). */
export async function loadSnapshot(
  db: Db,
  orgId: string,
  manifest?: PackManifest,
): Promise<{ snapshot: PackSnapshot; timeZone: string }> {
  const [org, sheets, folders, installs, members, emails, jobRoles, teams, dashboards, libraries] =
    await Promise.all([
      db.from('orgs').select('time_zone').eq('id', orgId).single(),
      db.from('sheets').select('id_prefix, position, parent_sheet_id').eq('org_id', orgId),
      db.from('folders').select('id, name, position, archived_at').eq('org_id', orgId),
      db
        .from('pack_installs')
        .select('id, pack_key, version, status, level, ref_map')
        .eq('org_id', orgId),
      db
        .from('memberships')
        .select('user_id, profiles!inner(display_name, initials, color)')
        .eq('org_id', orgId),
      db.rpc('pack_member_emails', { p_org: orgId }),
      db.from('job_roles').select('id, name').eq('org_id', orgId),
      db.from('teams').select('id, name').eq('org_id', orgId),
      db.from('dashboards').select('position').eq('org_id', orgId),
      // adopted framework libraries (docs/12): a pack's widgets and setup steps may read them
      db
        .from('sheets')
        .select('id, settings')
        .eq('org_id', orgId)
        .eq('is_library', true)
        .is('archived_at', null)
        .is('parent_sheet_id', null),
    ]);
  const email = new Map((must(emails, 'member emails') ?? []).map((e) => [e.user_id, e.email]));
  const last = (rows: { position: string }[]) =>
    rows
      .map((r) => r.position)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .at(-1) ?? null;
  const sheetRows = must(sheets, 'sheets') ?? [];
  const installRows = must(installs, 'pack installs') ?? [];
  const foreign = manifest ? await loadForeign(db, orgId, manifest, installRows) : null;
  return {
    timeZone: must(org, 'workspace')?.time_zone ?? 'Europe/London',
    snapshot: {
      ...(foreign ?? {}),
      orgId,
      prefixes: sheetRows.flatMap((s) => (s.id_prefix ? [s.id_prefix] : [])),
      folders: (must(folders, 'folders') ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        archived: !!f.archived_at,
      })),
      installs: (must(installs, 'pack installs') ?? []).map((i) => ({
        id: i.id,
        packKey: i.pack_key,
        version: i.version,
        status: i.status === 'archived' ? 'archived' : 'installed',
        level: i.level ?? null,
        refMap: (i.ref_map ?? {}) as Record<string, string>,
      })),
      libraries: (must(libraries, 'libraries') ?? []).flatMap((s) => {
        const fw = (s.settings as { framework?: { key?: unknown; version?: unknown } } | null)
          ?.framework;
        return typeof fw?.key === 'string' && typeof fw.version === 'string'
          ? [{ library: `${fw.key}@${fw.version}`, sheetId: s.id }]
          : [];
      }),
      members: (must(members, 'members') ?? []).map((m) => ({
        id: m.user_id,
        name: m.profiles.display_name,
        initials: m.profiles.initials,
        color: m.profiles.color,
        email: email.get(m.user_id) ?? '',
      })),
      jobRoles: must(jobRoles, 'job roles') ?? [],
      teams: must(teams, 'teams') ?? [],
      lastSheetPosition: last(sheetRows.filter((s) => !s.parent_sheet_id)),
      lastFolderPosition: last(must(folders, 'folders') ?? []),
      lastDashboardPosition: last(must(dashboards, 'dashboards') ?? []),
    },
  };
}

/**
 * The live sheets and folders of the installed packs a manifest requires (docs/11 Extends): the sheets it extends or
 * links to, with their live fields, groups and last positions, and every folder of those installs by ref.
 */
async function loadForeign(
  db: Db,
  orgId: string,
  m: PackManifest,
  installs: { id: string; pack_key: string; status: string }[],
): Promise<Pick<PackSnapshot, 'foreign' | 'foreignFolders'> | null> {
  const deps = installs.filter(
    (i) => i.status === 'installed' && m.requires.some((r) => r.pack === i.pack_key),
  );
  if (!deps.length) return null;
  const depIds = deps.map((d) => d.id);
  const keyOf = new Map(deps.map((d) => [d.id, d.pack_key]));
  const [sheets, folders] = await Promise.all([
    db
      .from('sheets')
      .select('id, pack_ref, pack_install_id, name, item_label, id_prefix')
      .eq('org_id', orgId)
      .in('pack_install_id', depIds)
      .is('parent_sheet_id', null)
      .is('archived_at', null),
    db
      .from('folders')
      .select('id, pack_ref, pack_install_id')
      .eq('org_id', orgId)
      .in('pack_install_id', depIds)
      .is('archived_at', null),
  ]);
  const wanted = new Set(foreignSheets(m).map((f) => foreignKey(f.pack, f.sheet)));
  const targets = (must(sheets, 'sheets') ?? []).filter((s) =>
    wanted.has(foreignKey(keyOf.get(s.pack_install_id ?? '') ?? '', s.pack_ref ?? '')),
  );
  const foreignFolders: Record<string, string> = {};
  for (const f of must(folders, 'folders') ?? [])
    foreignFolders[foreignKey(keyOf.get(f.pack_install_id ?? '') ?? '', f.pack_ref ?? '')] = f.id;
  if (!targets.length) return { foreign: {}, foreignFolders };
  const ids = targets.map((s) => s.id);
  const [fields, groups, views, items] = await Promise.all([
    db
      .from('fields')
      .select(
        'id, sheet_id, key, name, type, config, required, locked, description, position, pack_install_id',
      )
      .in('sheet_id', ids)
      .is('archived_at', null),
    db
      .from('groups')
      .select('id, sheet_id, pack_ref, pack_install_id, name, color, position')
      .in('sheet_id', ids),
    db.from('views').select('sheet_id, position').in('sheet_id', ids),
    db.from('items').select('group_id, position').in('sheet_id', ids).is('archived_at', null),
  ]);
  const last = (rows: { position: string }[]) =>
    rows
      .map((r) => r.position)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .at(-1) ?? null;
  const fieldRows = must(fields, 'fields') ?? [];
  const groupRows = must(groups, 'groups') ?? [];
  const viewRows = must(views, 'views') ?? [];
  const itemRows = must(items, 'items') ?? [];
  const foreign: Record<string, ForeignSheet> = {};
  for (const s of targets) {
    const pack = keyOf.get(s.pack_install_id ?? '') ?? '';
    const ref = s.pack_ref ?? '';
    const gs = groupRows.filter((g) => g.sheet_id === s.id);
    const fs = fieldRows.filter((f) => f.sheet_id === s.id);
    foreign[foreignKey(pack, ref)] = {
      sheetId: s.id,
      pack,
      ref,
      name: s.name,
      itemLabel: s.item_label,
      idPrefix: s.id_prefix ?? '',
      fields: fs
        .sort((a, b) => (a.position < b.position ? -1 : 1))
        .map((f) => ({
          id: f.id,
          key: f.key,
          name: f.name,
          type: f.type,
          config: f.config as Json,
          required: f.required,
          locked: f.locked,
          description: f.description,
          installId: f.pack_install_id,
        })),
      groups: gs
        .sort((a, b) => (a.position < b.position ? -1 : 1))
        .map((g) => ({
          id: g.id,
          // the group's ref in its sheet, for groups of the sheet's own pack (`risk.open` → `open`)
          ref:
            g.pack_install_id === s.pack_install_id && g.pack_ref?.startsWith(`${ref}.`)
              ? g.pack_ref.slice(ref.length + 1)
              : null,
          name: g.name,
          color: g.color,
          installId: g.pack_install_id,
        })),
      lastFieldPosition: last(fs),
      lastGroupPosition: last(gs),
      lastViewPosition: last(viewRows.filter((v) => v.sheet_id === s.id)),
      lastItemPosition: Object.fromEntries(
        gs.flatMap((g) => {
          const at = last(itemRows.filter((i) => i.group_id === g.id));
          return at ? [[g.id, at]] : [];
        }),
      ),
    };
  }
  return { foreign, foreignFolders };
}

/**
 * The required packs that installing `m` installs first, or raises to the level it needs (docs/11 Extends): install
 * order does not matter. A requirement the catalogue cannot meet is left to the planner (it says so).
 */
export async function requiredFirst(
  db: Db,
  orgId: string,
  m: PackManifest,
  catalogue?: CataloguePack[],
): Promise<InstallFirst[]> {
  if (!m.requires.length) return [];
  const cat = catalogue ?? (await readCatalogue(db));
  const installs =
    must(
      await db
        .from('pack_installs')
        .select('pack_key, version, level, status')
        .eq('org_id', orgId)
        .eq('status', 'installed'),
      'pack installs',
    ) ?? [];
  const out: InstallFirst[] = [];
  for (const r of m.requires) {
    const dep = cat.find((c) => c.key === r.pack);
    if (!dep || !satisfies(dep.version, r.range)) continue;
    const need = neededLevel(m, dep.manifest) ?? defaultLevel(dep.manifest);
    const levelName = dep.manifest.levels?.find((l) => l.key === need)?.name ?? null;
    const sheets = Object.fromEntries(
      dep.manifest.sheets.map((s) => [
        s.ref,
        { name: s.name, standards: s.fields.some((f) => f.key === STANDARDS_KEY) },
      ]),
    );
    const live = installs.find((i) => i.pack_key === r.pack);
    if (!live)
      out.push({
        key: dep.key,
        title: dep.title,
        version: dep.version,
        level: need,
        levelName,
        raise: false,
        sheets,
      });
    else if (
      need &&
      live.version === dep.version &&
      levelRank(dep.manifest, live.level) < levelRank(dep.manifest, need)
    )
      out.push({
        key: dep.key,
        title: dep.title,
        version: dep.version,
        level: need,
        levelName,
        raise: true,
        sheets,
      });
  }
  return out;
}

/** The requirement keys a manifest's example items link to (`requirements`, docs/11 Frameworks). */
export function manifestRequirementKeys(m: CataloguePack['manifest']): string[] {
  return [
    ...new Set(
      m.sheets.flatMap((s) => s.items.flatMap((i) => Object.values(i.requirements ?? {}).flat())),
    ),
  ];
}

/** The adopted libraries' live items for these requirement keys (key → item id). */
export async function loadRequirementItems(
  db: Db,
  orgId: string,
  libraries: { library: string; sheetId: string }[],
  keys: string[],
): Promise<Record<string, string>> {
  if (!keys.length || !libraries.length) return {};
  const rows = must(
    await db
      .from('items')
      .select('id, requirement_ref')
      .eq('org_id', orgId)
      .in(
        'sheet_id',
        libraries.map((l) => l.sheetId),
      )
      .in('requirement_ref', keys)
      .is('archived_at', null),
    'library items',
  );
  return Object.fromEntries(
    (rows ?? []).flatMap((r) => (r.requirement_ref ? [[r.requirement_ref, r.id] as const] : [])),
  );
}

/** Plan a catalogue pack into a workspace as it is now. */
export async function planInstall(
  db: Db,
  orgId: string,
  pack: Pick<CataloguePack, 'manifest' | 'hash'>,
  env: {
    userId: string;
    now: Date;
    newId: () => string;
    level?: string | null;
    /** Required packs the command installs first (requiredFirst). */
    installFirst?: InstallFirst[];
    /** Automations that send anything out install on (the person opted in); off by default. */
    allowOutbound?: boolean;
    /** Every automation installs live (sample data only: the seed). */
    live?: boolean;
  },
): Promise<PackPlan> {
  const { snapshot, timeZone } = await loadSnapshot(db, orgId, pack.manifest);
  snapshot.requirementItems = await loadRequirementItems(
    db,
    orgId,
    snapshot.libraries ?? [],
    manifestRequirementKeys(pack.manifest),
  );
  return planPackInstall(
    pack.manifest,
    snapshot,
    {
      today: todayIn(env.now, timeZone),
      now: env.now,
      timeZone,
      newId: env.newId,
      hash: pack.hash,
      userId: env.userId,
    },
    {
      level: env.level ?? null,
      installFirst: env.installFirst,
      allowOutbound: env.allowOutbound,
      live: env.live,
    },
  );
}

export interface InstallOutcome {
  installId: string;
  refMap: Record<string, string>;
  counts: Record<string, number>;
}

/** Write a ready plan: install_pack, all or nothing. */
export async function writeInstall(
  db: Db,
  orgId: string,
  plan: PackPlan,
): Promise<
  { ok: true; data: InstallOutcome } | { ok: false; error: { message: string; code?: string } }
> {
  if (!plan.payload) return { ok: false, error: { message: 'This pack cannot be installed.' } };
  const { data, error } = await db.rpc('install_pack', {
    p_org: orgId,
    p_plan: plan.payload as unknown as Json,
  });
  if (error) return { ok: false, error };
  const out = data as {
    install_id: string;
    ref_map: Record<string, string>;
    counts: Record<string, number>;
  };
  return { ok: true, data: { installId: out.install_id, refMap: out.ref_map, counts: out.counts } };
}

/**
 * Write the repository's packs into the catalogue (service role: the seed). A version never changes once written:
 * a manifest that differs from the stored one under the same version is an error (bump the version).
 */
export async function syncCatalogue(
  db: Db,
  packs: PackManifest[],
): Promise<{ added: string[]; unchanged: string[] }> {
  const added: string[] = [];
  const unchanged: string[] = [];
  for (const m of packs) {
    const hash = packHash(m);
    const existing = must(
      await db.from('packs').select('hash').eq('key', m.key).eq('version', m.version).maybeSingle(),
      `pack ${m.key}`,
    );
    if (existing) {
      if (existing.hash !== hash)
        throw new Error(
          `Pack ${m.key} ${m.version} changed since it was written to the catalogue. Give it a new version.`,
        );
      unchanged.push(m.key);
      continue;
    }
    must(
      await db.from('packs').insert({
        key: m.key,
        version: m.version,
        title: m.title,
        description: m.description,
        manifest: m as unknown as Json,
        hash,
      } as never),
      `pack ${m.key}`,
    );
    added.push(m.key);
  }
  return { added, unchanged };
}
