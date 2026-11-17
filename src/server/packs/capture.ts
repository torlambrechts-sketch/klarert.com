// "Save your setup" on the server (docs/11 Your own packs): read the workspace as the person sees it (their own
// client, so RLS and sheet access decide what can be captured: what they cannot read is never captured), with the
// manifests of the catalogue packs it has installed. The pure capture (src/engine/packs/capture.ts) does the rest.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceSnapshot } from '@/engine/packs/capture';
import type { PackManifest } from '@/engine/packs/types';
import type { Json } from '@/engine/types';
import type { Database } from '@/lib/database.types';
import { parsePack } from '@/lib/packs/manifest';
import { every } from './install';

type Db = SupabaseClient<Database>;

export interface OwnPackVersion {
  key: string;
  version: string;
  title: string;
  description: string;
  hash: string;
  manifest: PackManifest;
  publishedAt: string | null;
  publishedBy: string | null;
  withdrawnAt: string | null;
  ownerOrgId: string;
}

/** Every version of the private packs a workspace published (newest version last per key), manifests checked. */
export async function readOwnPacks(db: Db, orgId: string): Promise<OwnPackVersion[]> {
  const rows = await every('own packs', (a, b) =>
    db
      .from('packs')
      .select(
        'key, version, title, description, hash, manifest, owner_org_id, published_at, published_by, withdrawn_at',
      )
      .eq('owner_org_id', orgId)
      .not('key', 'like', 'framework-%')
      .order('key')
      .order('version')
      .range(a, b),
  );
  return rows.flatMap((r) => {
    try {
      return [
        {
          key: r.key,
          version: r.version,
          title: r.title,
          description: r.description,
          hash: r.hash,
          manifest: parsePack(r.manifest),
          publishedAt: r.published_at,
          publishedBy: r.published_by,
          withdrawnAt: r.withdrawn_at,
          ownerOrgId: r.owner_org_id ?? orgId,
        },
      ];
    } catch {
      return [];
    }
  });
}

/** The workspace's setup as the person can read it, for captureManifest. */
export async function loadWorkspaceSnapshot(db: Db, orgId: string): Promise<WorkspaceSnapshot> {
  const [
    org,
    installs,
    folders,
    sheets,
    fields,
    groups,
    views,
    automations,
    dashboards,
    roles,
    teams,
    members,
  ] = await Promise.all([
    db.from('orgs').select('id, name').eq('id', orgId).single(),
    every('pack installs', (a, b) =>
      db
        .from('pack_installs')
        .select('id, pack_key, version')
        .eq('org_id', orgId)
        .eq('status', 'installed')
        .order('id')
        .range(a, b),
    ),
    every('folders', (a, b) =>
      db
        .from('folders')
        .select('id, name, restricted, pack_install_id, pack_ref')
        .eq('org_id', orgId)
        .is('archived_at', null)
        .order('id')
        .range(a, b),
    ),
    every('sheets', (a, b) =>
      db
        .from('sheets')
        .select(
          'id, name, description, item_label, id_prefix, folder_id, restricted, is_library, parent_sheet_id, pack_install_id, pack_ref, settings',
        )
        .eq('org_id', orgId)
        .is('archived_at', null)
        .order('position')
        .order('id')
        .range(a, b),
    ),
    every('fields', (a, b) =>
      db
        .from('fields')
        .select(
          'id, sheet_id, key, name, type, description, required, locked, config, rules, visibility, restricted_to, position, pack_install_id',
        )
        .eq('org_id', orgId)
        .is('archived_at', null)
        .order('id')
        .range(a, b),
    ),
    every('groups', (a, b) =>
      db
        .from('groups')
        .select('id, sheet_id, name, color, position, pack_install_id, pack_ref')
        .eq('org_id', orgId)
        .order('id')
        .range(a, b),
    ),
    every('views', (a, b) =>
      db
        .from('views')
        .select('id, sheet_id, name, type, config, position, owner_id, pack_install_id, pack_ref')
        .eq('org_id', orgId)
        .order('id')
        .range(a, b),
    ),
    every('automations', (a, b) =>
      db
        .from('automations')
        .select('id, sheet_id, name, enabled, trigger, conditions, actions, pack_install_id')
        .eq('org_id', orgId)
        .order('id')
        .range(a, b),
    ),
    every('dashboards', (a, b) =>
      db
        .from('dashboards')
        .select('id, name, config, position, pack_install_id')
        .eq('org_id', orgId)
        .is('archived_at', null)
        .order('id')
        .range(a, b),
    ),
    every('job roles', (a, b) =>
      db.from('job_roles').select('id, name').eq('org_id', orgId).order('id').range(a, b),
    ),
    every('teams', (a, b) =>
      db.from('teams').select('id, name').eq('org_id', orgId).order('id').range(a, b),
    ),
    every('members', (a, b) =>
      db.from('memberships').select('user_id').eq('org_id', orgId).order('user_id').range(a, b),
    ),
  ]);
  if (org.error) throw new Error(`workspace: ${org.error.message}`);
  // the manifests of the installed versions: our catalogue's (owner null) are what a person may build on
  const keys = [...new Set(installs.map((i) => i.pack_key))];
  const packRows = keys.length
    ? await every('installed packs', (a, b) =>
        db
          .from('packs')
          .select('key, version, title, manifest, owner_org_id')
          .in('key', keys)
          .order('key')
          .order('version')
          .range(a, b),
      )
    : [];
  const manifestOf = (key: string, version: string) => {
    const r = packRows.find((p) => p.key === key && p.version === version);
    if (!r || r.owner_org_id) return { title: r?.title ?? key, manifest: null };
    try {
      return { title: r.title, manifest: parsePack(r.manifest) };
    } catch {
      return { title: r.title, manifest: null };
    }
  };
  const ownFrameworks = sheets.flatMap((s) => {
    const fw = (s.settings as { framework?: { key?: unknown; version?: unknown } } | null)
      ?.framework;
    return s.is_library &&
      !s.parent_sheet_id &&
      typeof fw?.key === 'string' &&
      typeof fw.version === 'string' &&
      /^w[0-9a-f]{8}-/.test(fw.key) &&
      fw.key.slice(1, 9) === orgId.replace(/-/g, '').slice(0, 8)
      ? [{ key: fw.key, version: fw.version }]
      : [];
  });
  return {
    org: { id: org.data.id, name: org.data.name },
    installs: installs.map((i) => ({
      id: i.id,
      packKey: i.pack_key,
      version: i.version,
      ...manifestOf(i.pack_key, i.version),
    })),
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      restricted: f.restricted,
      packInstallId: f.pack_install_id,
      packRef: f.pack_ref,
    })),
    sheets: sheets.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      itemLabel: s.item_label,
      idPrefix: s.id_prefix,
      folderId: s.folder_id,
      restricted: s.restricted,
      isLibrary: s.is_library,
      parentSheetId: s.parent_sheet_id,
      packInstallId: s.pack_install_id,
      packRef: s.pack_ref,
      settings: s.settings as Json,
    })),
    fields: fields.map((f) => ({
      id: f.id,
      sheetId: f.sheet_id,
      key: f.key,
      name: f.name,
      type: f.type,
      description: f.description,
      required: f.required,
      locked: f.locked,
      config: f.config as Json,
      rules: f.rules as Json,
      visibility: f.visibility as Json | null,
      restrictedTo: f.restricted_to as Json | null,
      position: f.position,
      packInstallId: f.pack_install_id,
    })),
    groups: groups.map((g) => ({
      id: g.id,
      sheetId: g.sheet_id,
      name: g.name,
      color: g.color,
      position: g.position,
      packInstallId: g.pack_install_id,
      packRef: g.pack_ref,
    })),
    views: views.map((v) => ({
      id: v.id,
      sheetId: v.sheet_id,
      name: v.name,
      type: v.type,
      config: v.config as Json,
      position: v.position,
      ownerId: v.owner_id,
      packInstallId: v.pack_install_id,
      packRef: v.pack_ref,
    })),
    automations: automations.map((a) => ({
      id: a.id,
      sheetId: a.sheet_id,
      name: a.name,
      enabled: a.enabled,
      trigger: a.trigger as Json,
      conditions: a.conditions as Json,
      actions: a.actions as Json,
      packInstallId: a.pack_install_id,
    })),
    dashboards: dashboards.map((d) => ({
      id: d.id,
      name: d.name,
      config: d.config as Json,
      position: d.position,
      packInstallId: d.pack_install_id,
    })),
    jobRoles: roles,
    teams,
    memberIds: members.map((m) => m.user_id),
    ownFrameworks,
  };
}
