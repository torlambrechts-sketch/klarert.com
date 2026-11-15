// Reads for the audit outputs (docs/11 Audit outputs), all with the person's own client: RLS and sheet access decide
// what is seen, so a restricted sheet never reaches an export and a restricted field's values never leave the
// database for someone not listed on it. The engine (src/engine/audit) turns these rows into tables and text.
import 'server-only';
import {
  workspaceChainKey,
  type ActivityEntry,
  type ChainResult,
  type EvidenceFile,
  type Period,
} from '@/engine/audit';
import { buildSoa, type Soa, type SoaEvidence, type SoaLinked } from '@/engine/audit/soa';
import { LIBRARY_KEYS } from '@/engine/frameworks/pack';
import { addDays } from '@/engine/fields/helpers';
import { sheetCtx, type SheetData } from '@/engine/sheet-data';
import type { Condition, Ctx, Sheet } from '@/engine/types';
import { parseViewConfig } from '@/engine/views/config';
import { env } from '@/lib/env';
import { repoFrameworks } from '@/lib/frameworks/catalogue';
import { fetchAllPages, fetchItemsById, fetchSheetData, type Db } from '@/lib/sheet-query';
import { SHEET_COLUMNS, toSheet } from '@/lib/sheet-rows';
import { readFrameworks } from '@/server/frameworks/catalogue';
import { linksAround } from '@/server/frameworks/workspace';
import { newId } from '@/server/sheet-context';

const CHUNK = 150;

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

async function chunks<T>(ids: string[], run: (part: string[]) => PromiseLike<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await run(ids.slice(i, i + CHUNK))));
  return out;
}

export interface Who {
  orgId: string;
  slug: string;
  userId: string;
  isAdmin: boolean;
}

export async function workspaceInfo(db: Db, orgId: string) {
  const { data } = await db.from('orgs').select('name, time_zone').eq('id', orgId).maybeSingle();
  return { name: data?.name ?? 'Workspace', timeZone: data?.time_zone ?? 'Europe/London' };
}

/** A sheet with everything its values need, and a Ctx for the person (canSee: their restricted fields). */
export async function loadSheet(
  db: Db,
  who: Who,
  sheetId: string,
  timeZone: string,
  now: Date,
): Promise<{ data: SheetData; ctx: Ctx } | null> {
  const data = await fetchSheetData(db, sheetId);
  if (!data || data.sheet.orgId !== who.orgId) return null;
  const ctx = sheetCtx(data, {
    now,
    timeZone,
    userId: who.userId,
    newId,
    isAdmin: who.isAdmin,
  });
  return { data, ctx };
}

export const itemUrl = (slug: string, sheetId: string, displayId: string) =>
  `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/${slug}/s/${sheetId}?item=${encodeURIComponent(displayId)}`;

export interface SoaExport {
  sheet: Sheet;
  framework: { key: string; version: string; title: string; licence: string };
  /** "Statement of applicability" (the library's SoA view) or "All requirements". */
  scope: string;
  /** The library has a statement of applicability view (so "all" is a choice). */
  hasSoaView: boolean;
  soa: Soa;
}

/** The SoA rows of one library sheet the person can read. Null when it is not an adopted library of the workspace. */
export async function readSoa(
  db: Db,
  who: Who,
  sheetId: string,
  opts: { all?: boolean; timeZone: string; now: Date },
): Promise<SoaExport | null> {
  const loaded = await loadSheet(db, who, sheetId, opts.timeZone, opts.now);
  const fw = loaded?.data.sheet.framework;
  if (!loaded || !fw || !loaded.data.sheet.isLibrary) return null;
  const { data, ctx } = loaded;
  const ids = data.items.map((i) => i.id);
  const [catalogue, views, around] = await Promise.all([
    readFrameworks(db),
    db
      .from('views')
      .select('name, type, config')
      .eq('sheet_id', sheetId)
      .then((r) => must(r, 'views')),
    linksAround(db, ids),
  ]);
  const entry = catalogue.find((f) => f.key === fw.key && f.version === fw.version);
  // the SoA view the framework file names (docs/12): its filters as the workspace keeps them, else the shipped filter
  const soaDef = repoFrameworks().find((f) => f.key === fw.key && f.version === fw.version)?.library
    .soa;
  const view = soaDef ? views.find((v) => v.type === 'table' && v.name === soaDef.name) : undefined;
  let filters: Condition[] = [];
  if (soaDef && !opts.all) {
    filters = view
      ? parseViewConfig(view.config).filters
      : [{ fieldKey: fw.refFieldKey, op: 'starts_with', value: soaDef.refStartsWith }];
  }
  const libIds = new Set(ids);
  const others = new Map(around.others.map((o) => [o.item.id, o]));
  const linked = new Map<string, SoaLinked[]>();
  for (const l of around.links) {
    const [req, other] = libIds.has(l.to) ? [l.to, l.from] : [l.from, l.to];
    if (!libIds.has(req) || libIds.has(other)) continue;
    const o = others.get(other);
    if (!o || o.item.requirementRef || o.item.archivedAt) continue;
    const list = linked.get(req) ?? [];
    if (!list.some((x) => x.displayId === o.item.displayId))
      list.push({ displayId: o.item.displayId, name: o.item.name, sheetName: o.sheet.sheet.name });
    linked.set(req, list);
  }
  const evidenceField = data.fields.find((f) => f.key === LIBRARY_KEYS.evidence);
  const byId = new Map(data.items.map((i) => [i.id, i]));
  const evidence = new Map<string, SoaEvidence[]>();
  for (const f of data.files) {
    if (f.fieldId !== null && f.fieldId !== evidenceField?.id) continue;
    const it = byId.get(f.itemId);
    if (!it) continue;
    const list = evidence.get(f.itemId) ?? [];
    list.push({ name: f.filename, href: itemUrl(who.slug, sheetId, it.displayId) });
    evidence.set(f.itemId, list);
  }
  return {
    sheet: data.sheet,
    framework: {
      key: fw.key,
      version: fw.version,
      title: entry?.title ?? `${fw.key} ${fw.version}`,
      licence: entry?.licence ?? '',
    },
    scope: filters.length ? (soaDef?.name ?? 'Statement of applicability') : 'All requirements',
    hasSoaView: !!soaDef,
    soa: buildSoa({
      fields: data.fields,
      items: data.items,
      ctx,
      refFieldKey: fw.refFieldKey,
      filters,
      evidence,
      linked,
    }),
  };
}

// ───────────────────────── scope ─────────────────────────

export interface ScopeOption {
  value: string;
  label: string;
}

export interface AuditScopes {
  folders: ScopeOption[];
  installs: ScopeOption[];
  libraries: { sheetId: string; name: string }[];
}

/** What an audit pack can cover: the whole workspace, a folder, or a pack install. */
export async function readScopes(db: Db, orgId: string): Promise<AuditScopes> {
  const [folders, installs, packs, libraries] = await Promise.all([
    db
      .from('folders')
      .select('id, name')
      .eq('org_id', orgId)
      .is('archived_at', null)
      .order('position')
      .then((r) => must(r, 'folders')),
    db
      .from('pack_installs')
      .select('id, pack_key, version')
      .eq('org_id', orgId)
      .eq('status', 'installed')
      .order('installed_at')
      .then((r) => must(r, 'installs')),
    db
      .from('packs')
      .select('key, version, title')
      .then((r) => must(r, 'packs')),
    db
      .from('sheets')
      .select('id, name')
      .eq('org_id', orgId)
      .eq('is_library', true)
      .is('archived_at', null)
      .is('parent_sheet_id', null)
      .order('position')
      .then((r) => must(r, 'libraries')),
  ]);
  const title = (k: string, v: string) =>
    packs.find((p) => p.key === k && p.version === v)?.title ?? k;
  return {
    folders: folders.map((f) => ({ value: `folder:${f.id}`, label: f.name })),
    installs: installs
      .filter((i) => !i.pack_key.startsWith('framework-'))
      .map((i) => ({ value: `install:${i.id}`, label: title(i.pack_key, i.version) })),
    libraries: libraries.map((l) => ({ sheetId: l.id, name: l.name })),
  };
}

export interface ScopeSheets {
  label: string;
  /** Readable, live sheets in scope (sub-item sheets after their parents). */
  sheets: Sheet[];
  /** Adopted libraries whose SoA belongs in the pack. */
  libraryIds: string[];
  /** What the person cannot see, said without naming it. */
  leftOut: string[];
  /** For the export log. */
  log: Record<string, string>;
}

export async function readScopeSheets(
  db: Db,
  orgId: string,
  scope: string,
): Promise<ScopeSheets | null> {
  const [kind, id] = scope.split(':') as ['workspace' | 'folder' | 'install', string?];
  let q = db
    .from('sheets')
    .select(`${SHEET_COLUMNS}, folder_id, pack_install_id`)
    .eq('org_id', orgId)
    .is('archived_at', null)
    .is('parent_sheet_id', null)
    .order('position');
  let label = 'Whole workspace';
  const leftOut: string[] = [];
  const log: Record<string, string> = { scope: kind };
  let frameworkKeys: { key: string; version: string }[] = [];
  if (kind === 'folder') {
    const { data: folder } = await db
      .from('folders')
      .select('id, name')
      .eq('id', id!)
      .eq('org_id', orgId)
      .maybeSingle();
    if (!folder) return null;
    label = `Folder: ${folder.name}`;
    log.folder_id = folder.id;
    q = q.eq('folder_id', folder.id);
    const { data: hidden } = await db.rpc('folder_hidden_sheet_count', { p_folder: folder.id });
    if (typeof hidden === 'number' && hidden > 0)
      leftOut.push(
        `${hidden} restricted ${hidden === 1 ? 'sheet' : 'sheets'} in this folder you cannot open`,
      );
  } else if (kind === 'install') {
    const { data: inst } = await db
      .from('pack_installs')
      .select('id, pack_key, version, ref_map')
      .eq('id', id!)
      .eq('org_id', orgId)
      .eq('status', 'installed')
      .maybeSingle();
    if (!inst) return null;
    const { data: pack } = await db
      .from('packs')
      .select('title, manifest')
      .eq('key', inst.pack_key)
      .eq('version', inst.version)
      .maybeSingle();
    label = `Pack: ${pack?.title ?? inst.pack_key}`;
    log.install_id = inst.id;
    q = q.eq('pack_install_id', inst.id);
    const fws = (pack?.manifest as { frameworks?: { key: string; version: string }[] } | null)
      ?.frameworks;
    frameworkKeys = Array.isArray(fws) ? fws : [];
    const refs = Object.entries((inst.ref_map ?? {}) as Record<string, string>).filter(([k]) =>
      k.startsWith('sheet:'),
    );
    const visible = refs.length
      ? await chunks(
          refs.map(([, v]) => v),
          async (part) => must(await db.from('sheets').select('id').in('id', part), 'sheets'),
        )
      : [];
    const hidden = refs.length - visible.length;
    if (hidden > 0)
      leftOut.push(
        `${hidden} ${hidden === 1 ? 'sheet' : 'sheets'} of this pack you cannot open (restricted or not shared with you)`,
      );
  } else if (kind !== 'workspace') return null;
  const top = must(await q, 'sheets').map((r) => toSheet(r));
  const children = top.length
    ? must(
        await db
          .from('sheets')
          .select(SHEET_COLUMNS)
          .in(
            'parent_sheet_id',
            top.map((s) => s.id),
          )
          .is('archived_at', null),
        'sub-item sheets',
      ).map((r) => toSheet(r))
    : [];
  const sheets = top.flatMap((s) => [s, ...children.filter((c) => c.parentSheetId === s.id)]);
  // libraries in scope, and those a pack builds on
  const libraryIds = new Set(top.filter((s) => s.isLibrary && s.framework).map((s) => s.id));
  if (frameworkKeys.length) {
    const libs = must(
      await db
        .from('sheets')
        .select(SHEET_COLUMNS)
        .eq('org_id', orgId)
        .eq('is_library', true)
        .is('archived_at', null),
      'libraries',
    ).map((r) => toSheet(r));
    for (const l of libs)
      if (
        frameworkKeys.some((f) => f.key === l.framework?.key && f.version === l.framework?.version)
      )
        libraryIds.add(l.id);
  }
  return { label, sheets, libraryIds: [...libraryIds], leftOut, log };
}

// ───────────────────────── evidence ─────────────────────────

export interface EvidenceRowWithPath extends EvidenceFile {
  storagePath: string;
}

/** Current file versions of items in the given sheets (RLS: restricted fields' files are not returned). */
export async function readEvidence(
  db: Db,
  sheets: { data: SheetData }[],
  person: (id: string | null) => string,
): Promise<EvidenceRowWithPath[]> {
  const out: EvidenceRowWithPath[] = [];
  for (const { data } of sheets) {
    const items = new Map(data.items.map((i) => [i.id, i]));
    const fieldName = new Map(data.fields.map((f) => [f.id, f.name]));
    const fileIds = data.files.map((f) => f.id);
    const meta = await chunks(fileIds, async (part) =>
      must(
        await db
          .from('files')
          .select('id, uploaded_by, created_at, storage_path, scan_status')
          .in('id', part),
        'files',
      ),
    );
    const byId = new Map(meta.map((m) => [m.id, m]));
    for (const f of data.files) {
      const it = items.get(f.itemId);
      const m = byId.get(f.id);
      if (!it || !m) continue;
      out.push({
        fileId: f.id,
        filename: f.filename,
        sizeBytes: f.sizeBytes,
        sha256: f.sha256,
        mimeType: f.mimeType,
        uploadedBy: person(m.uploaded_by),
        uploadedAt: m.created_at,
        validUntil: f.validUntil,
        item: { displayId: it.displayId, name: it.name },
        sheetName: data.sheet.name,
        fieldName: f.fieldId ? (fieldName.get(f.fieldId) ?? 'Field') : 'Item file',
        storagePath: m.scan_status === 'blocked' ? '' : m.storage_path,
      });
    }
  }
  return out;
}

// ───────────────────────── activity ─────────────────────────

const ACTIVITY_COLUMNS =
  'id, at, chain_key, item_id, sheet_id, actor_kind, actor_id, action, field_id, old_value, new_value, note, prev_hash, hash';

type ActivityRow = {
  id: number;
  at: string;
  chain_key: string;
  item_id: string | null;
  sheet_id: string | null;
  actor_kind: string;
  actor_id: string | null;
  action: string;
  field_id: string | null;
  old_value: unknown;
  new_value: unknown;
  note: string | null;
  prev_hash: string;
  hash: string;
};

const toEntry = (r: ActivityRow): ActivityEntry => ({
  id: r.id,
  at: r.at,
  chainKey: r.chain_key,
  itemId: r.item_id,
  sheetId: r.sheet_id,
  actorKind: r.actor_kind,
  actorId: r.actor_id,
  action: r.action,
  fieldId: r.field_id,
  oldValue: r.old_value as ActivityEntry['oldValue'],
  newValue: r.new_value as ActivityEntry['newValue'],
  note: r.note,
  prevHash: r.prev_hash,
  hash: r.hash,
});

/** A day either side in UTC; the engine keeps the entries whose day in the workspace time zone is in the period. */
const periodWindow = (period: Period) => ({
  from: `${addDays(period.from, -1)}T00:00:00Z`,
  to: `${addDays(period.to, 2)}T00:00:00Z`,
});

/** Entries of the given sheets (and their items) in the period, read under RLS, oldest first. */
export async function readActivity(
  db: Db,
  orgId: string,
  sheetIds: string[],
  period: Period,
): Promise<ActivityEntry[]> {
  if (sheetIds.length === 0) return [];
  const { from, to } = periodWindow(period);
  const out: ActivityEntry[] = [];
  for (let i = 0; i < sheetIds.length; i += CHUNK) {
    const part = sheetIds.slice(i, i + CHUNK);
    const rows = await fetchAllPages((a, b) =>
      db
        .from('activity_log')
        .select(ACTIVITY_COLUMNS)
        .eq('org_id', orgId)
        .in('sheet_id', part)
        .gte('at', from)
        .lt('at', to)
        .order('id')
        .range(a, b),
    );
    out.push(...rows.map(toEntry));
  }
  return out.sort((a, b) => a.id - b.id);
}

/**
 * Entries of the workspace chain (`sheet:<org>`, no sheet and no item) in the period, read under RLS as the item
 * entries are (folder access entries only for owners and admins), oldest first: exports, packs, frameworks, folders
 * and settings (owner decision 15 Nov 2026).
 */
export async function readWorkspaceActivity(
  db: Db,
  orgId: string,
  period: Period,
): Promise<ActivityEntry[]> {
  const { from, to } = periodWindow(period);
  const rows = await fetchAllPages((a, b) =>
    db
      .from('activity_log')
      .select(ACTIVITY_COLUMNS)
      .eq('org_id', orgId)
      .eq('chain_key', workspaceChainKey(orgId))
      .gte('at', from)
      .lt('at', to)
      .order('id')
      .range(a, b),
  );
  return rows.map(toEntry);
}

/** Labels of items that are not loaded (archived since), for the log and the chain report. */
export async function itemLabels(db: Db, ids: string[]): Promise<Map<string, string>> {
  const items = await fetchItemsById(db, ids);
  return new Map(items.map((i) => [i.id, `${i.displayId} ${i.name}`]));
}

/** verify_activity_chain on each chain, a few at a time. */
export async function verifyChains(
  db: Db,
  chains: { chainKey: string; label: string; sheetName: string }[],
): Promise<ChainResult[]> {
  const out: ChainResult[] = new Array(chains.length);
  let next = 0;
  const worker = async () => {
    while (next < chains.length) {
      const i = next++;
      const c = chains[i]!;
      const { data, error } = await db.rpc('verify_activity_chain', { p_chain_key: c.chainKey });
      if (error) {
        out[i] = { ...c, ok: null, entries: 0, error: 'not allowed or failed' };
        continue;
      }
      const r = (data ?? {}) as {
        ok?: boolean;
        entries?: number;
        last_hash?: string;
        first_bad_id?: number;
      };
      out[i] = {
        ...c,
        ok: r.ok === true,
        entries: r.entries ?? 0,
        firstBadId: r.first_bad_id ?? null,
        lastHash: r.last_hash ?? null,
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, chains.length) }, worker));
  return out;
}
