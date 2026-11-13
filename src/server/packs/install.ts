// Packs on the server (docs/11): read the catalogue, take a snapshot of a workspace, plan with the pure planner
// (src/engine/packs/plan.ts) and write the plan with install_pack, one transaction. Given a Supabase client, so the
// commands (the person's client, RLS) and the seed (service role, scripts/seed.ts) share it; no 'server-only' import.
import type { SupabaseClient } from '@supabase/supabase-js';
import { planPackInstall, type PackPlan, type PackSnapshot } from '@/engine/packs/plan';
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

/** What the planner needs to know about a workspace. */
export async function loadSnapshot(
  db: Db,
  orgId: string,
): Promise<{ snapshot: PackSnapshot; timeZone: string }> {
  const [org, sheets, folders, installs, members, emails, jobRoles, teams, dashboards] =
    await Promise.all([
      db.from('orgs').select('time_zone').eq('id', orgId).single(),
      db.from('sheets').select('id_prefix, position, parent_sheet_id').eq('org_id', orgId),
      db.from('folders').select('id, name, position, archived_at').eq('org_id', orgId),
      db.from('pack_installs').select('id, pack_key, version, status').eq('org_id', orgId),
      db
        .from('memberships')
        .select('user_id, profiles!inner(display_name, initials, color)')
        .eq('org_id', orgId),
      db.rpc('pack_member_emails', { p_org: orgId }),
      db.from('job_roles').select('id, name').eq('org_id', orgId),
      db.from('teams').select('id, name').eq('org_id', orgId),
      db.from('dashboards').select('position').eq('org_id', orgId),
    ]);
  const email = new Map((must(emails, 'member emails') ?? []).map((e) => [e.user_id, e.email]));
  const last = (rows: { position: string }[]) =>
    rows
      .map((r) => r.position)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .at(-1) ?? null;
  const sheetRows = must(sheets, 'sheets') ?? [];
  return {
    timeZone: must(org, 'workspace')?.time_zone ?? 'Europe/London',
    snapshot: {
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
      })),
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

/** Plan a catalogue pack into a workspace as it is now. */
export async function planInstall(
  db: Db,
  orgId: string,
  pack: Pick<CataloguePack, 'manifest' | 'hash'>,
  env: { userId: string; now: Date; newId: () => string },
): Promise<PackPlan> {
  const { snapshot, timeZone } = await loadSnapshot(db, orgId);
  return planPackInstall(pack.manifest, snapshot, {
    today: todayIn(env.now, timeZone),
    now: env.now,
    timeZone,
    newId: env.newId,
    hash: pack.hash,
    userId: env.userId,
  });
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
