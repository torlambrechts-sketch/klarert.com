import 'server-only';
import { randomUUID } from 'node:crypto';
import { isFrameworkPack } from '@/engine/frameworks/pack';
import { packLogText, PACK_ACTIONS } from '@/engine/packs/audit';
import { levelRank, levelSummaries, type LevelSummary } from '@/engine/packs/levels';
import {
  cleanSettings,
  settingDefaults,
  settingsSummary,
  type PackSettingValues,
} from '@/engine/packs/settings';
import type { PackSetting } from '@/engine/packs/types';
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
  packAutomationsModeInput,
  packSetupsInput,
  previewPackInput,
  previewUpgradeInput,
  setPackSettingsInput,
  upgradePackInput,
} from '@/lib/schemas/packs';
import { upgradeLines, type UpgradePreview } from '@/engine/packs/upgrade';
import { isAdminRole } from '@/server/auth';
import {
  planInstall,
  readCatalogue,
  readPack,
  requiredFirst,
  writeInstall,
} from '@/server/packs/install';
import type { InstallFirst } from '@/engine/packs/plan';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { planUpgrade, readPackVersions, updatesFor, writeUpgrade } from '@/server/packs/upgrade';
import { readSetups, type InstalledSetup } from '@/server/packs/setup';
import { readFrameworks } from '@/server/frameworks/catalogue';
import { parsePack } from '@/lib/packs/manifest';
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
  /** Titles of the frameworks the pack links to only where they are adopted (optional). */
  linksTo: string[];
  /** Choices made at install that set defaults in the pack's sheets (docs/11 Pack settings). */
  settings: PackSetting[];
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
  /** The catalogue's newer version, when there is one (docs/11 Upgrades). */
  updateTo: string | null;
  /** A framework's requirement library (adopted from Frameworks). */
  isFramework: boolean;
  /**
   * An add-on (docs/11 Extends): the titles of the packs whose sheets it adds to, and the standard it tags them with.
   * Archiving it takes back only what it added.
   */
  addOn: { onto: string[]; standard: string | null } | null;
  /** The pack's settings with the workspace's choices (docs/11 Pack settings); null when it has none. */
  settings: { defs: PackSetting[]; values: PackSettingValues; summary: string[] } | null;
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
        const [catalogue, installs, members, sheets, log, fws, versions] = await Promise.all([
          readCatalogue(supabase),
          supabase
            .from('pack_installs')
            .select(
              'id, pack_key, version, status, level, installed_by, installed_at, archived_by, archived_at, settings',
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
          readPackVersions(supabase),
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
        const updates = updatesFor(installs.data ?? [], versions);
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
                frameworks: (c.manifest.frameworks ?? [])
                  .filter((f) => !f.optional)
                  .map((f) => fwTitle(f.key, f.version)),
                linksTo: (c.manifest.frameworks ?? [])
                  .filter((f) => f.optional)
                  .map((f) => fwTitle(f.key, f.version)),
                settings: c.manifest.settings ?? [],
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
            updateTo: updates.get(i.id) ?? null,
            isFramework: (() => {
              const c = byKey.get(i.pack_key);
              return c ? isFrameworkPack(c.manifest) : i.pack_key.startsWith('framework-');
            })(),
            addOn: (() => {
              const c = byKey.get(i.pack_key)?.manifest;
              if (!c?.extends?.length) return null;
              const onto = [...new Set(c.extends.map((e) => titles.get(e.pack) ?? e.pack))];
              return { onto, standard: c.standard?.label ?? null };
            })(),
            settings: (() => {
              // the catalogue's newest manifest names the settings; the install keeps its choices
              const c = byKey.get(i.pack_key)?.manifest;
              if (!c?.settings?.length) return null;
              const values = cleanSettings(c, (i.settings ?? {}) as PackSettingValues);
              return { defs: c.settings, values, summary: settingsSummary(c, values) };
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
          // required packs (the Core registers) are installed first: install order does not matter
          installFirst: await requiredFirst(
            supabase,
            orgId,
            pack.manifest,
            undefined,
            p.data.level ?? null,
          ),
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
  /** Required packs installed (or raised to a level) first, in words (docs/11 Extends). */
  installedFirst: string[];
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
        allowOutbound: p.data.allowOutbound === true,
        // only the pack's own settings and choices (docs/11 Pack settings)
        settings: cleanSettings(pack.manifest, p.data.settings ?? {}),
      };
      // the packs it requires first (the Core registers, at the level it needs): install order does not matter
      const firsts = await requiredFirst(supabase, orgId, pack.manifest, undefined, env.level);
      let plan = await planInstall(supabase, orgId, pack, { ...env, installFirst: firsts });
      if (plan.state === 'installed')
        return fail('conflict', 'This pack is already installed in this workspace.');
      if (plan.state === 'blocked')
        return fail('conflict', plan.preview.conflicts[0] ?? 'This pack cannot be installed.');
      const installedFirst = await installRequired(supabase, orgId, user.id, firsts);
      if (!installedFirst.ok) return installedFirst;
      plan = await planInstall(supabase, orgId, pack, env);
      if (plan.state === 'installed')
        return fail('conflict', 'This pack is already installed in this workspace.');
      if (plan.state === 'blocked')
        return fail('conflict', plan.preview.conflicts[0] ?? 'This pack cannot be installed.');
      // the frameworks it builds on are adopted first (each its own transaction), then the pack is planned again so
      // its sheets and widgets find the libraries
      const adopted: string[] = [];
      // optional frameworks are never adopted for you: their links are written only where they are adopted
      for (const f of plan.preview.frameworks.filter((x) => !x.adopted && !x.optional)) {
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
      // the choices are recorded on the install (the plan already wrote the defaults they set)
      if (Object.keys(env.settings).length) {
        const { error } = await supabase.rpc('set_pack_settings', {
          p_install: written.data.installId,
          p_settings: env.settings,
          p_fields: [],
        });
        if (error) return fromDbError(error);
      }
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
        installedFirst: installedFirst.data,
      });
    },
    'installPack',
  );
}

/**
 * Install (or raise to a level) the packs another pack requires, each in its own transaction, before that pack
 * (docs/11 Extends). Returns what was done, in words ("Core registers 1.1.0 (Starter)").
 */
export async function installRequired(
  supabase: SupabaseClient<Database>,
  orgId: string,
  userId: string,
  firsts: InstallFirst[],
): Promise<Result<string[]>> {
  const done: string[] = [];
  for (const d of firsts) {
    const dep = await readPack(supabase, d.key);
    if (!dep) return fail('not_found', `${d.title} is no longer available.`);
    const plan = await planInstall(supabase, orgId, dep, {
      userId,
      now: new Date(),
      newId: randomUUID,
      level: d.level,
    });
    if (plan.state === 'installed') continue;
    if (plan.state !== 'ready' || !plan.payload)
      return fail(
        'conflict',
        `${d.title}: ${plan.preview.conflicts[0] ?? 'it cannot be installed.'}`,
      );
    const written = await writeInstall(supabase, orgId, plan);
    if (!written.ok) return fromDbError(written.error);
    done.push(`${d.title} ${d.version}${d.levelName ? ` (${d.levelName})` : ''}`);
  }
  return ok(done);
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
      // a pack another install builds on (the Core registers under an add-on) goes last
      const first = error?.message.match(/archive (.+) first, it builds on this pack/);
      if (first) return fail('conflict', `Archive ${first[1]} first: it builds on this pack.`);
      if (error) return fromDbError(error);
      return ok({ installId: row.id, counts: data as Record<string, number> });
    },
    'archivePack',
  );
}

/**
 * Change a pack install's settings (docs/11 Pack settings): the choices are recorded on the install and the defaults
 * they set are written to the install's own fields, in one transaction (set_pack_settings). Owners and admins.
 */
export async function setPackSettings(
  input: unknown,
): Promise<Result<{ installId: string; fields: number; lines: string[] }>> {
  const p = setPackSettingsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { data: row, error: e1 } = await supabase
        .from('pack_installs')
        .select('id, pack_key, version, status, ref_map')
        .eq('id', p.data.installId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (e1) return fromDbError(e1);
      if (!row || row.status !== 'installed')
        return fail('not_found', 'This pack is no longer installed.');
      const { data: pk, error: e2 } = await supabase
        .from('packs')
        .select('manifest')
        .eq('key', row.pack_key)
        .eq('version', row.version)
        .maybeSingle();
      if (e2) return fromDbError(e2);
      if (!pk) return fail('not_found', 'This pack is no longer in the catalogue.');
      const manifest = parsePack(pk.manifest);
      if (!manifest.settings?.length) return fail('invalid', 'This pack has no settings.');
      const values = cleanSettings(manifest, p.data.settings);
      if (Object.keys(values).length !== Object.keys(p.data.settings).length)
        return fail('invalid', 'Choose one of the listed options.');
      const refMap = (row.ref_map ?? {}) as Record<string, string>;
      const defaults = settingDefaults(manifest, values).filter((d) => refMap[d.ref]);
      const { data, error } = await supabase.rpc('set_pack_settings', {
        p_install: row.id,
        p_settings: values,
        p_fields: defaults.map((d) => ({ id: refMap[d.ref]!, default: d.default })),
      });
      if (error) return fromDbError(error);
      return ok({
        installId: row.id,
        fields: typeof data === 'number' ? data : 0,
        lines: defaults.map((d) => d.line),
      });
    },
    'setPackSettings',
  );
}

export interface UpgradePreviewResult {
  installId: string;
  /** The catalogue hash of the new version: the update refuses a catalogue that changed since. */
  hash: string;
  preview: UpgradePreview;
  lines: string[];
}

/** What updating an install to the catalogue's newest version would do here now (a dry run). Owners and admins. */
export async function previewPackUpgrade(input: unknown): Promise<Result<UpgradePreviewResult>> {
  const p = previewUpgradeInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId, user }) => {
      try {
        const r = await planUpgrade(supabase, orgId, p.data.installId, {
          userId: user.id,
          now: new Date(),
          newId: randomUUID,
        });
        if (!r.ok) return fail(r.code, r.message);
        return ok({
          installId: p.data.installId,
          hash: r.to.hash,
          preview: r.plan.preview,
          lines: upgradeLines(r.plan.preview),
        });
      } catch (e) {
        console.error(JSON.stringify({ level: 'error', source: 'packs', error: String(e) }));
        return fail('failed', 'The update could not be previewed. Try again.');
      }
    },
    'previewPackUpgrade',
  );
}

export interface UpgradeResult {
  installId: string;
  title: string;
  from: string;
  to: string;
  counts: Record<string, Json>;
  /** "3 added, 5 changed, 1 archived; 2 conflicts kept as you had them" */
  summary: string;
}

/** Update an install: planned again with the person's choices, written by upgrade_pack in one transaction. */
export async function upgradePack(input: unknown): Promise<Result<UpgradeResult>> {
  const p = upgradePackInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId, user }) => {
      const r = await planUpgrade(supabase, orgId, p.data.installId, {
        userId: user.id,
        now: new Date(),
        newId: randomUUID,
        choices: p.data.choices,
      });
      if (!r.ok) return fail(r.code, r.message);
      if (r.to.hash !== p.data.hash)
        return fail(
          'conflict',
          'This pack changed since you previewed the update. Preview it again.',
        );
      if (r.plan.state === 'current') return fail('conflict', 'This pack is up to date.');
      if (r.plan.state === 'blocked')
        return fail('conflict', r.plan.preview.blockers[0] ?? 'This pack cannot be updated.');
      const written = await writeUpgrade(supabase, r.plan);
      if (!written.ok) return fromDbError(written.error);
      const c = r.plan.preview.counts;
      const kept = r.plan.preview.conflicts.filter((x) => x.choice === 'mine').length;
      const parts = [
        `${c.added} added`,
        `${c.changed} changed`,
        `${c.archived} archived or turned off`,
      ];
      return ok({
        installId: p.data.installId,
        title: r.to.title,
        from: r.from.version,
        to: written.data.version,
        counts: written.data.counts,
        summary: `${parts.join(', ')}${kept ? `; ${kept} ${kept === 1 ? 'conflict' : 'conflicts'} kept as you had ${kept === 1 ? 'it' : 'them'}` : ''}.`,
      });
    },
    'upgradePack',
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

/** A pack install whose automations wait in test mode (docs/04 §14): the banner on Home and Workspace admin › Packs. */
export interface TestModePack {
  installId: string;
  title: string;
  /** Automations of the install in test mode (on sheets the person can read). */
  count: number;
}

/**
 * Installed packs with automations in test mode, for owners and admins (they turn them on). Empty for everyone else
 * and when nothing waits.
 */
export async function testModePacks(input: unknown): Promise<Result<TestModePack[]>> {
  const p = packSetupsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'member',
    async ({ supabase, orgId, role }) => {
      if (!isAdminRole(role)) return ok([]);
      const { data: autos, error } = await supabase
        .from('automations')
        .select('pack_install_id')
        .eq('org_id', orgId)
        .eq('mode', 'test')
        .not('pack_install_id', 'is', null);
      if (error) return fromDbError(error);
      const counts = new Map<string, number>();
      for (const a of autos ?? [])
        if (a.pack_install_id)
          counts.set(a.pack_install_id, (counts.get(a.pack_install_id) ?? 0) + 1);
      if (!counts.size) return ok([]);
      const { data: installs, error: e2 } = await supabase
        .from('pack_installs')
        .select('id, pack_key, version, installed_at')
        .eq('org_id', orgId)
        .eq('status', 'installed')
        .in('id', [...counts.keys()])
        .order('installed_at');
      if (e2) return fromDbError(e2);
      const titles = new Map<string, string>();
      const keys = [...new Set((installs ?? []).map((i) => i.pack_key))];
      if (keys.length) {
        const { data: packs } = await supabase
          .from('packs')
          .select('key, version, title')
          .in('key', keys);
        for (const k of packs ?? []) titles.set(`${k.key}@${k.version}`, k.title);
      }
      return ok(
        (installs ?? []).map((i) => ({
          installId: i.id,
          title: titles.get(`${i.pack_key}@${i.version}`) ?? i.pack_key,
          count: counts.get(i.id) ?? 0,
        })),
      );
    },
    'testModePacks',
  );
}

/** Turn every automation of a pack install live (or back to test mode) at once. Owners and admins; logged. */
export async function setPackAutomationsMode(input: unknown): Promise<Result<{ changed: number }>> {
  const p = packAutomationsModeInput.safeParse(input);
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
      const { data, error } = await supabase.rpc('set_pack_automations_mode', {
        p_install: row.id,
        p_mode: p.data.mode,
      });
      if (error) return fromDbError(error);
      return ok({ changed: typeof data === 'number' ? data : 0 });
    },
    'setPackAutomationsMode',
  );
}
