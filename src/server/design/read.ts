import 'server-only';
import { appScreens } from '@/engine/apps/resolve';
import type { LiveRows } from '@/engine/flow/drift';
import type {
  AutomationHealth,
  FlowAutomation,
  FlowForm,
  FlowHealth,
  FlowSheet,
  FlowWorld,
  Provenance,
} from '@/engine/flow/types';
import { maskWorld } from '@/engine/flow/words';
import type { Automation, Condition, Json, Role } from '@/engine/types';
import { parseViewConfig } from '@/engine/views/config';
import { fetchDirectory, type Db } from '@/lib/sheet-query';
import { FIELD_COLUMNS, SHEET_COLUMNS, toField, toSheet } from '@/lib/sheet-rows';
import { getApps } from '@/server/apps/read';
import { readDrift } from './drift';

// The configuration the Design area derives from (docs/05 §3.8, §4), read with the person's client so RLS decides:
// sheets they can read, their fields (restricted ones flagged by field_hidden), shared forms, automations, approval
// workflows (sheet settings), folders, live pack installs and the installed apps. Health comes from run-log and
// webhook-queue aggregates (design_health, bounded in the database); form answers only for one sheet (form_stats).
// NEVER item rows: a sheet with 60 000 items costs the same as an empty one. The world is masked before it leaves the
// server: a restricted field's name never reaches someone who may not see it.

function must<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const prov = (r: {
  pack_install_id?: string | null;
  pack_ref?: string | null;
}): Provenance | null =>
  r.pack_install_id && r.pack_ref ? { installId: r.pack_install_id, ref: r.pack_ref } : null;

/** What Sheet settings edits (the side window's sheet step), for the sheet the read was for. */
export interface DesignSheetDetail {
  id: string;
  name: string;
  description: string | null;
  itemLabel: string;
  idPrefix: string;
  prefixLocked: boolean;
  folderId: string | null;
  isLibrary: boolean;
  holdAutomations: boolean;
  archived: boolean;
}

export interface DesignRead {
  world: FlowWorld;
  /** The sheet the read was for, when it was for one. */
  sheetId: string | null;
  sheet: DesignSheetDetail | null;
}

export async function readDesignWorld(
  db: Db,
  orgId: string,
  person: { userId: string; role: Role },
  opts: { sheetId?: string | null } = {},
): Promise<DesignRead> {
  const [sheetRows, folderRows, fieldRows, formRows, autoRows, installRows, directory] =
    await Promise.all([
      db
        .from('sheets')
        .select(`${SHEET_COLUMNS}, folder_id, pack_install_id, pack_ref, position`)
        .eq('org_id', orgId)
        .is('archived_at', null)
        .is('parent_sheet_id', null)
        .order('position'),
      db
        .from('folders')
        .select('id, name, domain, position, pack_install_id')
        .eq('org_id', orgId)
        .is('archived_at', null)
        .order('position'),
      db
        .from('fields')
        .select(`${FIELD_COLUMNS}, pack_install_id, pack_ref`)
        .eq('org_id', orgId)
        .is('archived_at', null)
        .order('position'),
      db
        .from('views')
        .select('id, sheet_id, name, config, position, pack_install_id, pack_ref')
        .eq('org_id', orgId)
        .eq('type', 'form')
        .is('owner_id', null)
        .order('position'),
      db
        .from('automations')
        .select(
          'id, sheet_id, name, enabled, mode, trigger, conditions, actions, locked, last_run_at, run_count, created_at, pack_install_id, pack_ref',
        )
        .eq('org_id', orgId)
        .order('created_at'),
      db
        .from('pack_installs')
        .select('id, pack_key, version, level, ref_map')
        .eq('org_id', orgId)
        .eq('status', 'installed'),
      fetchDirectory(db, orgId),
    ]);
  const sheetsRaw = must(sheetRows, 'sheets') ?? [];
  const folders = (must(folderRows, 'folders') ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    domain: f.domain ?? null,
    position: f.position,
  }));
  // domain folders first, as the side menu
  folders.sort(
    (a, b) => Number(!a.domain) - Number(!b.domain) || (a.position < b.position ? -1 : 1),
  );
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const sheetIds = new Set(sheetsRaw.map((s) => s.id));
  const sheets: FlowSheet[] = sheetsRaw.map((r) => {
    const folder = r.folder_id ? folderById.get(r.folder_id) : undefined;
    return {
      ...toSheet(r),
      folderId: folder?.id ?? null,
      folderName: folder?.name ?? null,
      domain: folder?.domain ?? null,
      pack: prov(r),
    };
  });
  const fieldsRaw = (must(fieldRows, 'fields') ?? []).filter((f) => sheetIds.has(f.sheet_id));
  const fields = fieldsRaw.map((r) => ({ ...toField(r), pack: prov(r) }));
  const formsRaw = (must(formRows, 'forms') ?? []).filter((v) => sheetIds.has(v.sheet_id));
  const forms: FlowForm[] = formsRaw.flatMap((v) => {
    const layout = parseViewConfig(v.config).form;
    return layout
      ? [
          {
            id: v.id,
            sheetId: v.sheet_id,
            name: v.name,
            layout,
            position: v.position,
            pack: prov(v),
          },
        ]
      : [];
  });
  const autosRaw = (must(autoRows, 'automations') ?? []).filter((a) => sheetIds.has(a.sheet_id));
  const automations: FlowAutomation[] = autosRaw.map((a) => ({
    id: a.id,
    sheetId: a.sheet_id,
    name: a.name,
    enabled: a.enabled,
    mode: a.mode === 'test' ? 'test' : 'live',
    trigger: a.trigger as Automation['trigger'],
    conditions: (a.conditions ?? []) as unknown as Condition[],
    actions: (a.actions ?? []) as Automation['actions'],
    locked: a.locked,
    lastRunAt: a.last_run_at,
    runCount: a.run_count,
    createdAt: a.created_at,
    pack: prov(a),
  }));
  const installs = must(installRows, 'pack installs') ?? [];

  const [titles, apps, health, stats, detail] = await Promise.all([
    installs.length
      ? db
          .from('packs')
          .select('key, version, title')
          .in('key', [...new Set(installs.map((i) => i.pack_key))])
          .then((r) => must(r, 'packs') ?? [])
      : Promise.resolve([] as { key: string; version: string; title: string }[]),
    getApps(orgId, person.role).catch(() => []),
    readHealth(db, orgId),
    opts.sheetId && sheetIds.has(opts.sheetId)
      ? db.rpc('form_stats', { p_sheet: opts.sheetId }).then((r) => (r.error ? [] : (r.data ?? [])))
      : Promise.resolve([] as { view_id: string; responses: number; last_at: string }[]),
    opts.sheetId && sheetIds.has(opts.sheetId)
      ? db
          .from('sheets')
          .select(
            'id, name, description, item_label, id_prefix, next_seq, folder_id, is_library, settings, archived_at',
          )
          .eq('id', opts.sheetId)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
  ]);
  for (const s of stats) {
    const f = forms.find((x) => x.id === s.view_id);
    if (f) {
      f.responses = Number(s.responses);
      f.lastAt = s.last_at;
    }
  }

  const live: LiveRows = {
    automations: autosRaw.map((a) => ({
      id: a.id,
      pack: prov(a),
      name: a.name,
      trigger: a.trigger as Json,
      conditions: (a.conditions ?? []) as Json,
      actions: a.actions as Json,
    })),
    forms: formsRaw.map((v) => ({
      id: v.id,
      pack: prov(v),
      name: v.name,
      config: v.config as Json,
    })),
    fields: fieldsRaw
      .filter((f) => f.pack_install_id)
      .map((f) => ({
        id: f.id,
        pack: prov(f),
        name: f.name,
        description: f.description,
        required: f.required,
        locked: f.locked,
        config: f.config as Json,
      })),
    sheets: sheetsRaw.map((s) => ({
      id: s.id,
      pack: prov(s),
      workflows: ((s.settings as { workflows?: Json } | null)?.workflows ?? []) as Json,
    })),
  };
  const ownFolders = new Map<string, string[]>();
  for (const f of must(folderRows, 'folders') ?? [])
    if (f.pack_install_id)
      ownFolders.set(f.pack_install_id, [...(ownFolders.get(f.pack_install_id) ?? []), f.id]);
  const drift = await readDrift(db, orgId, person.userId, installs, ownFolders, live);

  const world: FlowWorld = {
    folders,
    sheets,
    fields,
    forms,
    automations,
    packs: installs.map((i) => ({
      installId: i.id,
      key: i.pack_key,
      version: i.version,
      title:
        titles.find((t) => t.key === i.pack_key && t.version === i.version)?.title ??
        titles.find((t) => t.key === i.pack_key)?.title ??
        i.pack_key,
    })),
    apps: apps.map((a) => ({
      key: a.key,
      title: a.title,
      sheetIds: [
        ...new Set(
          appScreens(a).flatMap((s) =>
            [s.parentSheetId ?? s.sheetId].filter((x): x is string => !!x),
          ),
        ),
      ],
    })),
    people: directory.people,
    teams: directory.teams,
    jobRoles: directory.jobRoles,
    health,
    drift,
  };
  return {
    world: maskWorld(world),
    sheetId: opts.sheetId ?? null,
    sheet: detail
      ? {
          id: detail.id,
          name: detail.name,
          description: detail.description,
          itemLabel: detail.item_label,
          idPrefix: detail.id_prefix ?? '',
          prefixLocked: detail.next_seq > 1,
          folderId: detail.folder_id,
          isLibrary: detail.is_library,
          holdAutomations:
            (detail.settings as { holdAutomations?: boolean } | null)?.holdAutomations !== false,
          archived: !!detail.archived_at,
        }
      : null,
  };
}

/** design_health (0048): aggregates only. A database without the function yet says what configuration knows. */
async function readHealth(db: Db, orgId: string): Promise<FlowHealth> {
  const { data, error } = await db.rpc('design_health', { p_org: orgId });
  if (error) return { automations: {}, available: false };
  const automations: Record<string, AutomationHealth> = {};
  for (const r of data ?? [])
    automations[r.automation_id] = {
      failed: r.failed_runs,
      partial: r.partial_runs,
      lastFailedAt: r.last_failed_at,
      deadLetters: r.dead_letters,
      retrying: r.retrying,
    };
  return { automations, available: true };
}
