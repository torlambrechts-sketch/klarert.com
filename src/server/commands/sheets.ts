import 'server-only';
import { randomUUID } from 'node:crypto';
import { basicCtx } from '@/engine/context';
import {
  columnConfig,
  parseCsv,
  rowsToItems,
  type CsvField,
  type CsvTable,
} from '@/engine/fields/csv';
import { fieldType } from '@/engine/fields/registry';
import { fieldKeyFromName, keyBetween, keysBetween } from '@/engine/ordering';
import { isLinkType, needsLibraryTarget } from '@/engine/fields/type-change';
import { placeBetween, resolveFolder } from '@/engine/organise';
import { rekeyIds } from '@/engine/rekey';
import type { Json } from '@/engine/types';
import { resolveTemplateTabs } from '@/engine/views/tabs';
import {
  LABEL_COLORS,
  archiveSheetInput,
  copySheetInput,
  createSheetInput,
  importCsvInput,
  moveSheetInput,
  renameSheetInput,
  updateSheetInput,
} from '@/lib/schemas/sheets';
import { startById } from '@/lib/starts';
import type { ServerClient } from '@/lib/supabase/server';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { log, withOrg } from './context';
import { activeFolders, insertFolder } from './folders';
import { setUpSubitems } from './subitems';
import { createInverseField } from './two-way';

// Sheets (docs/01 FR-6, FR-7). Structure rows are written under RLS through create_sheet (one transaction, logged by
// the schema triggers); imported items go through create_items (definer, same checks as create_item).

type NewField = {
  id: string;
  key: string;
  name: string;
  type: string;
  position: string;
  width: number | null;
  required?: boolean;
  locked?: boolean;
  description?: string | null;
  config: Json;
  validation?: Json;
  rules?: Json;
  visibility?: Json;
};

const IMPORT_CHUNK = 1000;

const clampWidth = (w: number) => Math.min(600, Math.max(60, Math.round(w)));
const optionId = () => `opt_${randomUUID().slice(0, 8)}`;

async function prefixTaken(db: ServerClient, orgId: string, prefix: string, exceptSheet?: string) {
  let q = db.from('sheets').select('id').eq('org_id', orgId).eq('id_prefix', prefix);
  if (exceptSheet) q = q.neq('id', exceptSheet);
  const { data } = await q.limit(1);
  return (data ?? []).length > 0;
}

const prefixConflict = () =>
  fail('invalid', 'Check the highlighted fields.', {
    idPrefix: 'Another sheet uses this prefix. Choose another.',
  });

async function lastSheetPosition(db: ServerClient, orgId: string): Promise<string | null> {
  const { data } = await db
    .from('sheets')
    .select('position')
    .eq('org_id', orgId)
    .order('position', { ascending: false })
    .limit(1);
  return data?.[0]?.position ?? null;
}

function newGroups(names: string[]) {
  const list = names.length > 0 ? names : ['Group 1'];
  const keys = keysBetween(null, null, list.length);
  return list.map((name, i) => ({
    id: randomUUID(),
    name,
    color: LABEL_COLORS[i % LABEL_COLORS.length]!,
    position: keys[i]!,
  }));
}

/** Fields from (name, type, config) with stable keys, default widths and ordered positions. */
function newFields(cols: { name: string; type: string; config?: unknown }[]): NewField[] {
  const keys = keysBetween(null, null, cols.length);
  const taken = new Set<string>();
  return cols.map((c, i) => {
    const def = fieldType(c.type)!;
    const key = fieldKeyFromName(c.name, taken);
    taken.add(key);
    return {
      id: randomUUID(),
      key,
      name: c.name,
      type: c.type,
      position: keys[i]!,
      width: clampWidth(def.defaultWidth),
      config: (c.config ?? def.defaultConfig()) as Json,
    };
  });
}

type SheetPayload = {
  sheet: {
    id: string;
    org_id: string;
    folder_id: string | null;
    name: string;
    description: string | null;
    item_label: string;
    id_prefix: string;
    is_library?: boolean;
    settings?: Json;
    position: string;
  };
  groups: { id: string; name: string; color: string; position: string }[];
  fields: NewField[];
  views?: { id: string; name: string; type: string; config: Json; position: string }[];
  automations?: Record<string, Json>[];
};

async function insertSheet(db: ServerClient, payload: SheetPayload): Promise<Result<string>> {
  const { data, error } = await db.rpc('create_sheet', { p: payload as unknown as Json });
  if (error) {
    if (/sheets_org_id_id_prefix_key/.test(error.message)) return prefixConflict();
    return fromDbError(error);
  }
  return ok(data);
}

/**
 * The folder of a new sheet (docs/02 §1). A picked folder must be an active folder of the workspace. A sheet made
 * from a start with a folder (templates/starts.json `folder`) goes into that folder: reused when one with the same
 * name exists (case-insensitive), created otherwise. Creating it is allowed for editors here only, as part of
 * creating the sheet, and only with the start's own folder name.
 */
export async function sheetFolder(
  db: ServerClient,
  orgId: string,
  v: { folderId: string | null; folderName?: string | null; startId?: string },
): Promise<Result<string | null>> {
  const folders = await activeFolders(db, orgId);
  if (v.folderId) {
    return folders.some((f) => f.id === v.folderId)
      ? ok(v.folderId)
      : fail('invalid', 'Check the highlighted fields.', { folderId: 'Choose a folder.' });
  }
  if (!v.folderName) return ok(null);
  const startFolder = v.startId ? startById(v.startId)?.folder : undefined;
  const choice = resolveFolder(folders, { folderId: null, folderName: v.folderName });
  if (choice.kind === 'existing') return ok(choice.id);
  if (choice.kind === 'none') return ok(null);
  const sameAsStart = startFolder
    ? resolveFolder([{ id: 's', name: startFolder }], { folderId: null, folderName: v.folderName })
    : null;
  if (!startFolder || sameAsStart?.kind !== 'existing')
    return fail('invalid', 'Check the highlighted fields.', { folderId: 'Choose a folder.' });
  const made = await insertFolder(db, orgId, startFolder, 'last');
  return made.ok ? ok(made.data.id) : made;
}

// ───────────────────────── wizard: Blank, Register, Tracker, Log, Inspection ─────────────────────────

export async function createSheet(input: unknown): Promise<Result<{ sheetId: string }>> {
  const p = createSheetInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId }) => {
      if (await prefixTaken(supabase, orgId, v.idPrefix)) return prefixConflict();
      const columns = v.columns.filter((c) => c.name);
      // link columns: the chosen sheet must be in the workspace (and a library for requirement/control link)
      const targets = [
        ...new Set(columns.flatMap((c) => (c.targetSheetId ? [c.targetSheetId] : []))),
      ];
      const { data: targetRows } = targets.length
        ? await supabase
            .from('sheets')
            .select('id, is_library')
            .eq('org_id', orgId)
            .in('id', targets)
        : { data: [] };
      const known = new Map((targetRows ?? []).map((t) => [t.id, t.is_library]));
      for (const c of columns) {
        if (!c.targetSheetId || !isLinkType(c.type)) continue;
        if (!known.has(c.targetSheetId))
          return fail('invalid', `${c.name}: choose a sheet of this workspace to link to.`);
        if (needsLibraryTarget(c.type) && !known.get(c.targetSheetId))
          return fail('invalid', `${c.name}: choose a library sheet.`);
      }
      const fields = newFields(
        columns.map((c) => ({
          name: c.name,
          type: c.type,
          config:
            c.targetSheetId && isLinkType(c.type)
              ? {
                  ...(fieldType(c.type)!.defaultConfig() as object),
                  targetSheetId: c.targetSheetId,
                }
              : undefined,
        })),
      );
      const folder = await sheetFolder(supabase, orgId, v);
      if (!folder.ok) return folder;
      const sheetId = randomUUID();
      // the start's tabs (docs/02 sheets.settings.tabs), kept as its default for "Reset to template default"
      const startTabs = v.startId ? startById(v.startId)?.tabs : undefined;
      const tabs = startTabs ? resolveTemplateTabs(startTabs, undefined, []).tabs : null;
      const created = await insertSheet(supabase, {
        sheet: {
          id: sheetId,
          org_id: orgId,
          folder_id: folder.data,
          name: v.name,
          description: v.description,
          item_label: v.itemLabel,
          id_prefix: v.idPrefix,
          ...(tabs ? { settings: { tabs, tabsDefault: tabs } as unknown as Json } : {}),
          position: keyBetween(await lastSheetPosition(supabase, orgId), null),
        },
        groups: newGroups(v.groups),
        fields,
      });
      if (!created.ok) return created;
      // "Show on <target sheet> too": the inverse field on the target sheet, then point this field at it
      for (const [i, c] of columns.entries()) {
        if (!c.twoWay || !c.targetSheetId || !isLinkType(c.type)) continue;
        const f = fields[i]!;
        const inverse = await createInverseField(
          supabase,
          orgId,
          { fieldId: f.id, sheetId, itemLabel: v.itemLabel },
          c.targetSheetId,
        );
        if (!inverse.ok) return inverse;
        const { error } = await supabase
          .from('fields')
          .update({
            config: {
              ...(f.config as object),
              inverseFieldId: inverse.data.id,
            } as NonNullable<Json>,
          })
          .eq('id', f.id);
        if (error) return fromDbError(error);
      }
      // starts that come with sub-items (CAPA, audit, incident …): the set and its gate, as data
      const set = v.startId ? startById(v.startId)?.subitems : undefined;
      if (set) {
        const sub = await setUpSubitems(supabase, orgId, created.data, set);
        if (!sub.ok) return sub;
      }
      return ok({ sheetId: created.data });
    },
    'createSheet',
  );
}

// ───────────────────────── wizard: Import a spreadsheet ─────────────────────────

export type ImportResult = {
  sheetId: string;
  items: number;
  imported: number;
  skippedCells: number;
};

export async function importCsv(input: unknown): Promise<Result<ImportResult>> {
  const p = importCsvInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  const parsed = parseCsv(v.csv);
  if (!parsed.ok) return fail('invalid', parsed.message, { csv: parsed.message });
  const table: CsvTable = parsed.table;
  const width = table.header.length;
  const indexes = v.columns.map((c) => c.index);
  if (
    indexes.length !== width - 1 ||
    new Set(indexes).size !== indexes.length ||
    indexes.some((i) => i >= width)
  )
    return fail('invalid', 'The columns changed. Read the CSV again and confirm the types.');

  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, user, profile }) => {
      if (await prefixTaken(supabase, orgId, v.idPrefix)) return prefixConflict();
      const cols = [...v.columns].sort((a, b) => a.index - b.index);
      const fields = newFields(
        cols.map((c) => ({
          name: c.name,
          type: c.type,
          config: columnConfig(
            c.type,
            table.rows.map((r) => r[c.index] ?? ''),
            optionId,
          ),
        })),
      );
      const groups = newGroups(v.groups.length > 0 ? v.groups : ['Imported']);
      const sheetId = randomUUID();
      const created = await insertSheet(supabase, {
        sheet: {
          id: sheetId,
          org_id: orgId,
          folder_id: v.folderId,
          name: v.name,
          description: v.description,
          item_label: v.itemLabel,
          id_prefix: v.idPrefix,
          position: keyBetween(await lastSheetPosition(supabase, orgId), null),
        },
        groups,
        fields,
      });
      if (!created.ok) return created;

      const { data: members } = await supabase
        .from('memberships')
        .select('user_id, profiles!inner(display_name, initials, color)')
        .eq('org_id', orgId);
      const now = new Date();
      const ctx = basicCtx({
        today: now.toISOString().slice(0, 10),
        now,
        timeZone: 'UTC',
        userId: user.id,
        sheet: {
          id: sheetId,
          orgId,
          name: v.name,
          itemLabel: v.itemLabel,
          idPrefix: v.idPrefix,
          isLibrary: false,
        },
        people: (members ?? []).map((m) => ({
          id: m.user_id,
          name: m.profiles.display_name,
          initials: m.profiles.initials,
          color: m.profiles.color,
        })),
        newId: optionId,
      });
      const csvFields: CsvField[] = cols.map((c, i) => ({
        index: c.index,
        fieldId: fields[i]!.id,
        type: c.type,
        config: fields[i]!.config,
      }));
      const { items, skippedCells } = rowsToItems(table, csvFields, ctx);
      const positions = items.length > 0 ? keysBetween(null, null, items.length) : [];
      let imported = 0;
      for (let start = 0; start < items.length; start += IMPORT_CHUNK) {
        const rows = items.slice(start, start + IMPORT_CHUNK).map((it, i) => ({
          name: it.name,
          position: positions[start + i]!,
          values: it.values,
        }));
        const { data, error } = await supabase.rpc('create_items', {
          p_sheet: sheetId,
          p_group: groups[0]!.id,
          p_rows: rows as unknown as Json,
        });
        if (error) {
          console.error(
            JSON.stringify({
              level: 'error',
              source: 'importCsv',
              at: start,
              message: error.message,
            }),
          );
          break;
        }
        imported += data;
      }
      log('importCsv.items', { sheet: sheetId, user: profile?.id, items: items.length, imported });
      return ok({ sheetId, items: items.length, imported, skippedCells });
    },
    'importCsv',
  );
}

// ───────────────────────── wizard: Copy a sheet ─────────────────────────

/**
 * A copied field's config with ids re-keyed to the copy. A two-way link whose inverse lives on another sheet loses
 * its inverseFieldId: that inverse belongs to the original sheet, so the copy's link is one-way (turn it on again in
 * the field settings to create the copy's own inverse). An inverse on the copied sheet itself is re-keyed with it.
 */
function copiedConfig(
  type: string,
  config: unknown,
  ids: Map<string, string>,
  re: (j: unknown) => Json,
): Json {
  const next = re(config);
  if (!isLinkType(type) || !next || typeof next !== 'object' || Array.isArray(next)) return next;
  const inv = (config as { inverseFieldId?: string | null } | null)?.inverseFieldId;
  return inv && !ids.has(inv) ? { ...next, inverseFieldId: null } : next;
}

export async function copySheet(input: unknown): Promise<Result<{ sheetId: string }>> {
  const p = copySheetInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId }) => {
      const { data: src } = await supabase
        .from('sheets')
        .select('id, description, item_label, is_library, settings')
        .eq('id', v.sourceSheetId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!src) return fail('not_found', 'The sheet to copy was not found.');
      if (await prefixTaken(supabase, orgId, v.idPrefix)) return prefixConflict();
      const [fieldsRes, groupsRes, viewsRes, autoRes] = await Promise.all([
        supabase
          .from('fields')
          .select('*')
          .eq('sheet_id', src.id)
          .is('archived_at', null)
          .order('position'),
        supabase.from('groups').select('*').eq('sheet_id', src.id).order('position'),
        supabase
          .from('views')
          .select('*')
          .eq('sheet_id', src.id)
          .is('owner_id', null)
          .order('position'),
        supabase.from('automations').select('*').eq('sheet_id', src.id).order('created_at'),
      ]);
      const failed = [fieldsRes, groupsRes, viewsRes, autoRes].find((r) => r.error);
      if (failed?.error) return fromDbError(failed.error);

      const sheetId = randomUUID();
      const ids = new Map<string, string>([[src.id, sheetId]]);
      for (const r of [...fieldsRes.data!, ...groupsRes.data!, ...viewsRes.data!])
        ids.set(r.id, randomUUID());
      const re = (j: unknown) => rekeyIds((j ?? null) as Json, ids);

      const created = await insertSheet(supabase, {
        sheet: {
          id: sheetId,
          org_id: orgId,
          folder_id: v.folderId,
          name: v.name,
          description: src.description,
          item_label: src.item_label,
          id_prefix: v.idPrefix,
          is_library: src.is_library,
          settings: re(src.settings),
          position: keyBetween(await lastSheetPosition(supabase, orgId), null),
        },
        groups: groupsRes.data!.map((g) => ({
          id: ids.get(g.id)!,
          name: g.name,
          color: g.color,
          position: g.position,
        })),
        fields: fieldsRes.data!.map((f) => ({
          id: ids.get(f.id)!,
          key: f.key,
          name: f.name,
          type: f.type,
          position: f.position,
          width: f.width,
          required: f.required,
          locked: f.locked,
          description: f.description,
          config: copiedConfig(f.type, f.config, ids, re),
          validation: re(f.validation),
          rules: re(f.rules),
          visibility: re(f.visibility),
        })),
        views: viewsRes.data!.map((w) => ({
          id: ids.get(w.id)!,
          name: w.name,
          type: w.type,
          config: re(w.config),
          position: w.position,
        })),
        automations: autoRes.data!.map((a) => ({
          name: a.name,
          enabled: a.enabled,
          trigger: re(a.trigger),
          conditions: re(a.conditions),
          actions: re(a.actions),
          source: a.source,
          version: a.version,
          locked: a.locked,
        })),
      });
      return created.ok ? ok({ sheetId: created.data }) : created;
    },
    'copySheet',
  );
}

// ───────────────────────── sheet settings ─────────────────────────

export async function updateSheet(input: unknown): Promise<Result<null>> {
  const p = updateSheetInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId }) => {
      const { data: s } = await supabase
        .from('sheets')
        .select('id, id_prefix, next_seq, settings')
        .eq('id', v.sheetId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!s) return fail('not_found', 'Sheet not found.');
      const prefix = v.idPrefix ?? s.id_prefix;
      if (prefix !== s.id_prefix && prefix !== null) {
        if (s.next_seq > 1)
          return fail('invalid', 'Check the highlighted fields.', {
            idPrefix: 'The prefix is fixed once the sheet has items.',
          });
        if (await prefixTaken(supabase, orgId, prefix, s.id)) return prefixConflict();
      }
      if (v.folderId) {
        const { data: f } = await supabase
          .from('folders')
          .select('id')
          .eq('id', v.folderId)
          .eq('org_id', orgId)
          .is('archived_at', null)
          .maybeSingle();
        if (!f)
          return fail('invalid', 'Check the highlighted fields.', { folderId: 'Choose a folder.' });
      }
      const { error } = await supabase
        .from('sheets')
        .update({
          name: v.name,
          description: v.description,
          item_label: v.itemLabel,
          id_prefix: prefix,
          folder_id: v.folderId,
          is_library: v.isLibrary,
          settings: {
            ...((s.settings ?? {}) as Record<string, Json>),
            holdAutomations: v.holdAutomations,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', s.id);
      if (error && /sheets_org_id_id_prefix_key/.test(error.message)) return prefixConflict();
      return error ? fromDbError(error) : ok(null);
    },
    'updateSheet',
  );
}

/**
 * Archive or restore a sheet (owners and admins). A sheet restored on its own while its folder is archived comes
 * back under "Other sheets".
 */
export async function archiveSheet(input: unknown): Promise<Result<{ archived: boolean }>> {
  const p = archiveSheetInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { data: s } = await supabase
        .from('sheets')
        .select('id, folder_id, parent_sheet_id, folders(archived_at)')
        .eq('id', p.data.sheetId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!s || s.parent_sheet_id) return fail('not_found', 'Sheet not found.');
      const folderArchived = !!s.folder_id && !!s.folders?.archived_at;
      const { error } = await supabase
        .from('sheets')
        .update(
          p.data.archived
            ? { archived_at: new Date().toISOString() }
            : { archived_at: null, ...(folderArchived ? { folder_id: null } : {}) },
        )
        .eq('id', s.id)
        .eq('org_id', orgId);
      return error ? fromDbError(error) : ok({ archived: p.data.archived });
    },
    'archiveSheet',
  );
}

// ───────────────────────── side menu: rename and move ─────────────────────────

async function menuSheet(db: ServerClient, orgId: string, sheetId: string) {
  const { data } = await db
    .from('sheets')
    .select('id, name, folder_id, parent_sheet_id, archived_at')
    .eq('id', sheetId)
    .eq('org_id', orgId)
    .maybeSingle();
  return data;
}

const subitemSheet = () =>
  fail(
    'invalid',
    'Sub-item sheets live inside their parent sheet and cannot be moved or renamed here.',
  );

export async function renameSheet(input: unknown): Promise<Result<null>> {
  const p = renameSheetInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'editor',
    async ({ supabase, orgId }) => {
      const s = await menuSheet(supabase, orgId, p.data.sheetId);
      if (!s) return fail('not_found', 'Sheet not found.');
      if (s.parent_sheet_id) return subitemSheet();
      const { error } = await supabase
        .from('sheets')
        .update({ name: p.data.name, updated_at: new Date().toISOString() })
        .eq('id', s.id)
        .eq('org_id', orgId);
      return error ? fromDbError(error) : ok(null);
    },
    'renameSheet',
  );
}

/**
 * Move a sheet into a folder (or out of folders: folderId null) and/or reorder it. The server reads the current
 * keys of the sheets of the target level and puts the sheet between the given neighbours (re-keying that level when
 * needed). Logged by sheets_audit as sheets.update.
 */
export async function moveSheet(
  input: unknown,
): Promise<Result<{ index: number; total: number; folderId: string | null }>> {
  const p = moveSheetInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId }) => {
      const s = await menuSheet(supabase, orgId, v.sheetId);
      if (!s || s.archived_at) return fail('not_found', 'Sheet not found.');
      if (s.parent_sheet_id) return subitemSheet();
      if (v.folderId && !(await activeFolders(supabase, orgId)).some((f) => f.id === v.folderId))
        return fail('not_found', 'Folder not found.');
      let level = supabase
        .from('sheets')
        .select('id, position')
        .eq('org_id', orgId)
        .is('archived_at', null)
        .is('parent_sheet_id', null);
      level = v.folderId ? level.eq('folder_id', v.folderId) : level.is('folder_id', null);
      const { data: siblings, error: readError } = await level;
      if (readError) return fromDbError(readError);
      const placed = placeBetween(siblings ?? [], s.id, v.before, v.after);
      if (!placed.ok)
        return fail('conflict', 'The menu changed while you moved the sheet. Try again.');
      for (const r of placed.rekey) {
        const { error } = await supabase
          .from('sheets')
          .update({ position: r.position })
          .eq('id', r.id)
          .eq('org_id', orgId);
        if (error) return fromDbError(error);
      }
      const { error } = await supabase
        .from('sheets')
        .update({ position: placed.position, folder_id: v.folderId })
        .eq('id', s.id)
        .eq('org_id', orgId);
      return error
        ? fromDbError(error)
        : ok({ index: placed.index, total: placed.total, folderId: v.folderId });
    },
    'moveSheet',
  );
}
