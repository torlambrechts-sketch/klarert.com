import 'server-only';
import { randomUUID } from 'node:crypto';
import { isFrameworkPack } from '@/engine/frameworks/pack';
import { packLogText, PACK_ACTIONS } from '@/engine/packs/audit';
import { levelRank, levelSummaries, type LevelSummary } from '@/engine/packs/levels';
import {
  countsText,
  manifestCounts,
  previewLines,
  type PackCounts,
  type PackOperation,
  type PackPreview,
} from '@/engine/packs/plan';
import type { Json } from '@/engine/types';
import {
  archivePackInput,
  installPackInput,
  listPacksInput,
  packSetupsInput,
  previewPackInput,
} from '@/lib/schemas/packs';
import { isAdminRole } from '@/server/auth';
import { planInstall, readCatalogue, readPack, writeInstall } from '@/server/packs/install';
import { readSetups, type InstalledSetup } from '@/server/packs/setup';
import { readFrameworks } from '@/server/frameworks/catalogue';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { withOrg } from './context';
import { adoptForPack } from './frameworks';

// Packs (docs/11, docs/02 §15). The catalogue is global and read-only; owners and admins preview a pack against the
// workspace as it is now and install it through install_pack (one transaction, provenance on every row, a
// pack.installed entry). The plan is always made here, on the server, from the catalogue's manifest: the browser
// only names the pack and the hash it previewed. Archiving archives what the install made; items and the log stay.

export interface PackCard {
  key: string;
  version: string;
  title: string;
  description: string;
  hash: string;
  counts: PackCounts;
  /** "2 sheets, 25 fields and 9 automations" */
  inside: string;
  sheets: string[];
  /** The live install of this pack in the workspace, if any. */
  installedVersion: string | null;
  /** Levels to choose from at install (docs/11 Levels), lowest first; empty for a pack without levels. */
  levels: LevelSummary[];
  /** The level installed here, if the pack has levels and is installed. */
  installedLevel: string | null;
  /** Titles of the frameworks the pack builds on, adopted at install when missing. */
  frameworks: string[];
}

export interface InstalledPack {
  id: string;
  key: string;
  title: string;
  version: string;
  status: 'installed' | 'archived';
  installedBy: string;
  installedAt: string;
  archivedBy: string | null;
  archivedAt: string | null;
  /** The first live sheet the install made (for "Open"). */
  firstSheetId: string | null;
  /** The level installed (packs with levels) and the next one that can be added. */
  level: { key: string; name: string } | null;
  nextLevel: { key: string; name: string } | null;
}

export interface PackLogEntry {
  id: number;
  at: string;
  actor: string;
  text: string;
}

export interface PackList {
  canInstall: boolean;
  available: PackCard[];
  installed: InstalledPack[];
  log: PackLogEntry[];
}

const who = (kind: string, id: string | null, names: Map<string, string>) =>
  kind === 'user'
    ? (id && names.get(id)) || 'Former member'
    : kind === 'system'
      ? 'System'
      : 'Automation';

/** The catalogue, this workspace's installs and the pack entries of its log. Every member may read them. */
export async function listPacks(input: unknown): Promise<Result<PackList>> {
  const p = listPacksInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'member',
    async ({ supabase, orgId, role }) => {
      try {
        const [catalogue, installs, members, sheets, log, fws] = await Promise.all([
          readCatalogue(supabase),
          supabase
            .from('pack_installs')
            .select(
              'id, pack_key, version, status, level, installed_by, installed_at, archived_by, archived_at',
            )
            .eq('org_id', orgId)
            .order('installed_at', { ascending: false }),
          supabase
            .from('memberships')
            .select('user_id, profiles!inner(display_name)')
            .eq('org_id', orgId),
          supabase
            .from('sheets')
            .select('id, pack_install_id, position')
            .eq('org_id', orgId)
            .not('pack_install_id', 'is', null)
            .is('parent_sheet_id', null)
            .is('archived_at', null)
            .order('position'),
          supabase
            .from('activity_log')
            .select('id, at, actor_kind, actor_id, action, new_value')
            .eq('org_id', orgId)
            .in('action', [...PACK_ACTIONS])
            .order('id', { ascending: false })
            .limit(20),
          readFrameworks(supabase).catch(() => []),
        ]);
        const fwTitle = (k: string, v: string) =>
          fws.find((f) => f.key === k && f.version === v)?.title ?? `${k} ${v}`;
        for (const r of [installs, members, sheets, log]) if (r.error) return fromDbError(r.error);
        const names = new Map(
          (members.data ?? []).map((m) => [m.user_id, m.profiles.display_name]),
        );
        const titles = new Map(catalogue.map((c) => [c.key, c.title]));
        const byKey = new Map(catalogue.map((c) => [c.key, c]));
        const liveRows = (installs.data ?? []).filter((i) => i.status === 'installed');
        const live = new Map(liveRows.map((i) => [i.pack_key, i.version]));
        const liveLevel = new Map(liveRows.map((i) => [i.pack_key, i.level ?? null]));
        const levelOf = (key: string, version: string, level: string | null) => {
          const c = byKey.get(key);
          if (!c || c.version !== version || !c.manifest.levels?.length)
            return { level: null, next: null };
          const rank = levelRank(c.manifest, level);
          const at = (r: number) => {
            const l = c.manifest.levels![r];
            return l ? { key: l.key, name: l.name } : null;
          };
          return { level: at(Math.max(0, rank)), next: at(Math.max(0, rank) + 1) };
        };
        return ok({
          canInstall: isAdminRole(role),
          // a framework's library is adopted from Frameworks (docs/12), not listed here
          available: catalogue
            .filter((c) => !isFrameworkPack(c.manifest))
            .map((c) => {
              const counts = manifestCounts(c.manifest);
              return {
                key: c.key,
                version: c.version,
                title: c.title,
                description: c.description,
                hash: c.hash,
                counts,
                inside: countsText(counts),
                sheets: c.manifest.sheets.map((s) => s.name),
                installedVersion: live.get(c.key) ?? null,
                levels: levelSummaries(c.manifest),
                installedLevel: liveLevel.get(c.key) ?? null,
                frameworks: (c.manifest.frameworks ?? []).map((f) => fwTitle(f.key, f.version)),
              };
            }),
          installed: (installs.data ?? []).map((i) => ({
            id: i.id,
            key: i.pack_key,
            title: titles.get(i.pack_key) ?? i.pack_key,
            version: i.version,
            status: i.status === 'archived' ? 'archived' : 'installed',
            installedBy: i.installed_by ? (names.get(i.installed_by) ?? 'Former member') : 'System',
            installedAt: i.installed_at,
            archivedBy: i.archived_by ? (names.get(i.archived_by) ?? 'Former member') : null,
            archivedAt: i.archived_at,
            firstSheetId: (sheets.data ?? []).find((s) => s.pack_install_id === i.id)?.id ?? null,
            ...(() => {
              const l = levelOf(i.pack_key, i.version, i.level ?? null);
              return { level: l.level, nextLevel: i.status === 'installed' ? l.next : null };
            })(),
          })),
          log: (log.data ?? []).map((e) => ({
            id: e.id,
            at: e.at,
            actor: who(e.actor_kind, e.actor_id, names),
            text: packLogText(e.action, e.new_value as Json | null),
          })),
        });
      } catch (e) {
        console.error(JSON.stringify({ level: 'error', source: 'packs', error: String(e) }));
        return fail('failed', 'The packs could not be loaded. Try again.');
      }
    },
    'listPacks',
  );
}

export interface PackPreviewResult {
  hash: string;
  preview: PackPreview;
  lines: string[];
  /** Operations by action: how many objects are created, reused, skipped or in conflict. */
  actions: Record<PackOperation['action'], number>;
  /** `<framework>@<version>` → the framework's title, for the frameworks the pack builds on. */
  frameworkTitles: Record<string, string>;
}

/** What installing a pack would do in this workspace now. Owners and admins. */
export async function previewPack(input: unknown): Promise<Result<PackPreviewResult>> {
  const p = previewPackInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId, user }) => {
      const pack = await readPack(supabase, p.data.key);
      if (!pack) return fail('not_found', 'This pack is no longer available.');
      if (isFrameworkPack(pack.manifest))
        return fail('invalid', 'Adopt this framework from Workspace admin, Frameworks.');
      try {
        const plan = await planInstall(supabase, orgId, pack, {
          userId: user.id,
          now: new Date(),
          newId: randomUUID,
          level: p.data.level ?? null,
        });
        const actions = { create: 0, reuse: 0, skip: 0, conflict: 0 };
        for (const o of plan.operations) actions[o.action] += 1;
        const fws = plan.preview.frameworks.length ? await readFrameworks(supabase) : [];
        const frameworkTitles = Object.fromEntries(
          fws.map((f) => [`${f.key}@${f.version}`, f.title] as const),
        );
        return ok({
          frameworkTitles,
          hash: pack.hash,
          preview: plan.preview,
          lines: previewLines(plan.preview),
          actions,
        });
      } catch (e) {
        console.error(JSON.stringify({ level: 'error', source: 'packs', error: String(e) }));
        return fail('failed', 'The preview could not be made. Try again.');
      }
    },
    'previewPack',
  );
}

export interface InstallResult {
  installId: string;
  title: string;
  /** The first sheet the pack made, to open. */
  sheetId: string | null;
  counts: Record<string, number>;
  renamedPrefixes: PackPreview['renamedPrefixes'];
  warnings: string[];
  /** Frameworks adopted first because the pack builds on them (docs/12). */
  adopted: string[];
  /** The level installed, and whether it was added to an install that was already there. */
  level: string | null;
  extended: boolean;
}

/** Install a pack: planned again from the catalogue and the workspace as they are now, written in one transaction. */
export async function installPack(input: unknown): Promise<Result<InstallResult>> {
  const p = installPackInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId, user }) => {
      const pack = await readPack(supabase, p.data.key);
      if (!pack) return fail('not_found', 'This pack is no longer available.');
      if (isFrameworkPack(pack.manifest))
        return fail('invalid', 'Adopt this framework from Workspace admin, Frameworks.');
      if (pack.hash !== p.data.hash)
        return fail('conflict', 'This pack changed since you previewed it. Preview it again.');
      const env = {
        userId: user.id,
        now: new Date(),
        newId: randomUUID,
        level: p.data.level ?? null,
      };
      let plan = await planInstall(supabase, orgId, pack, env);
      if (plan.state === 'installed')
        return fail('conflict', 'This pack is already installed in this workspace.');
      if (plan.state === 'blocked')
        return fail('conflict', plan.preview.conflicts[0] ?? 'This pack cannot be installed.');
      // the frameworks it builds on are adopted first (each its own transaction), then the pack is planned again so
      // its sheets and widgets find the libraries
      const adopted: string[] = [];
      for (const f of plan.preview.frameworks.filter((x) => !x.adopted)) {
        const [key, version] = f.library.split('@') as [string, string];
        const r = await adoptForPack(supabase, orgId, user.id, { key, version });
        if (!r.ok)
          return fail(r.error.code, `${pack.title} needs ${f.library}: ${r.error.message}`);
        if (r.data.adopted) adopted.push(r.data.title);
      }
      if (adopted.length) {
        plan = await planInstall(supabase, orgId, pack, env);
        if (plan.state !== 'ready')
          return fail('conflict', plan.preview.conflicts[0] ?? 'This pack cannot be installed.');
      }
      const written = await writeInstall(supabase, orgId, plan);
      if (!written.ok) return fromDbError(written.error);
      // the first sheet this install made: for a new level, the first one that level added
      const first = plan.preview.sheets[0]?.ref ?? pack.manifest.sheets[0]?.ref;
      return ok({
        installId: written.data.installId,
        title: pack.title,
        sheetId: (first && written.data.refMap[`sheet:${first}`]) || null,
        counts: written.data.counts,
        renamedPrefixes: plan.preview.renamedPrefixes,
        warnings: plan.preview.warnings,
        adopted,
        level: plan.preview.level?.name ?? null,
        extended: !!plan.preview.extendsLevel,
      });
    },
    'installPack',
  );
}

/** Archive what an install made (sheets, folders, dashboards; automations off). Items and the log stay. */
export async function archivePack(
  input: unknown,
): Promise<Result<{ installId: string; counts: Record<string, number> }>> {
  const p = archivePackInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { data: row } = await supabase
        .from('pack_installs')
        .select('id')
        .eq('id', p.data.installId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!row) return fail('not_found', 'This pack is no longer installed.');
      const { data, error } = await supabase.rpc('archive_pack', { p_install: row.id });
      if (error) return fromDbError(error);
      return ok({ installId: row.id, counts: data as Record<string, number> });
    },
    'archivePack',
  );
}

/** The guided setup checklists of the packs installed here, with progress from the data (docs/11 Setup). */
export async function packSetups(input: unknown): Promise<Result<InstalledSetup[]>> {
  const p = packSetupsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'member',
    async ({ supabase, orgId, role, user }) => {
      try {
        const { data: org } = await supabase
          .from('orgs')
          .select('time_zone')
          .eq('id', orgId)
          .maybeSingle();
        return ok(
          await readSetups(supabase, orgId, {
            timeZone: org?.time_zone ?? 'Europe/London',
            userId: user.id,
            isAdmin: isAdminRole(role),
          }),
        );
      } catch (e) {
        console.error(JSON.stringify({ level: 'error', source: 'packs', error: String(e) }));
        return fail('failed', 'The setup checklist could not be loaded. Try again.');
      }
    },
    'packSetups',
  );
}
