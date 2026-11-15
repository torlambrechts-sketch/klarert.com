import 'server-only';
import { generateKeyBetween } from 'fractional-indexing';
import { zipSync, strToU8, type Zippable } from 'fflate';
import {
  activityTable,
  chainSummary,
  chainTable,
  CHAIN_METHOD,
  compileManagementReview,
  evidenceTable,
  filesToInclude,
  inPeriod,
  packReadme,
  registerTable,
  soaCsv,
  soaHtml,
  toCsv,
  uniqueNames,
  zipName,
  type ManagementReview,
  type ReviewRow,
  type ReviewSource,
  type ReviewSourceKey,
  type SoaHeader,
} from '@/engine/audit';
import { coverageText } from '@/engine/frameworks/coverage';
import { todayIn, type SheetData } from '@/engine/sheet-data';
import type { Ctx, Item } from '@/engine/types';
import { dateOf, isItemDone, isOverdueOf, visibleTextOf } from '@/engine/values';
import { itemStatusField } from '@/engine/fields/item-status';
import {
  REVIEW_PACK_SOURCES,
  resolveReviewRef,
  type ReviewPackSource,
} from '@/lib/packs/management-review';
import {
  auditPackInput,
  auditScopesInput,
  managementReviewInput,
  soaExportInput,
} from '@/lib/schemas/audit';
import { fetchDirectory, type Db } from '@/lib/sheet-query';
import { isAdminRole, isEditorRole } from '@/server/auth';
import { readLibraries, readLibraryCoverage } from '@/server/frameworks/workspace';
import {
  itemLabels,
  loadSheet,
  readActivity,
  readEvidence,
  readScopes,
  readScopeSheets,
  readSoa,
  verifyChains,
  workspaceInfo,
  type AuditScopes,
  type SoaExport,
  type Who,
} from '@/server/audit/read';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { createItem } from './items';
import { postUpdate } from './updates';
import { withOrg } from './context';

// Audit outputs (docs/11 Audit outputs): the statement of applicability, the audit pack and the management review
// inputs. Every member may export what they can read (auditors too: exports change nothing); everything is read with
// the person's own client, so restricted sheets and fields stay out. Every export is logged on the workspace chain by
// log_audit_export (0034) with what was exported and its scope.

const BUCKET = 'files';

export type AuditExportKind =
  | 'soa.csv'
  | 'soa.print'
  | 'audit_pack'
  | 'management_review'
  | 'management_review.item'
  | 'data_flow_record';

/** Log an export on the workspace chain (log_audit_export, 0034 and 0049): the kind and a flat scope of known keys. */
export async function logExport(
  db: Db,
  orgId: string,
  kind: AuditExportKind,
  scope: Record<string, string | number | boolean | null>,
) {
  const { error } = await db.rpc('log_audit_export', {
    p_org: orgId,
    p_kind: kind,
    p_scope: scope,
  });
  if (error) throw new Error(`log_audit_export: ${error.message}`);
}

function soaHeader(
  x: SoaExport,
  ws: { name: string; timeZone: string },
  by: string,
  now: Date,
): SoaHeader {
  return {
    workspace: ws.name,
    framework: x.framework.title,
    licence: x.framework.licence,
    generatedAt: now.toISOString(),
    generatedBy: by,
    timeZone: ws.timeZone,
    scope: x.scope,
  };
}

export interface SoaResult extends SoaExport {
  header: SoaHeader;
  csv: string;
  filename: string;
}

/**
 * The statement of applicability of one adopted library: rows for the print page, and the CSV. `format` says which
 * export is being made, for the log.
 */
export async function exportSoa(
  input: unknown,
  format: 'csv' | 'print',
): Promise<Result<SoaResult>> {
  const p = soaExportInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId, role, user, profile }) => {
      try {
        const now = new Date();
        const ws = await workspaceInfo(supabase, orgId);
        const who: Who = { orgId, slug: v.org, userId: user.id, isAdmin: isAdminRole(role) };
        const x = await readSoa(supabase, who, v.sheetId, {
          all: v.all,
          timeZone: ws.timeZone,
          now,
        });
        if (!x) return fail('not_found', 'This framework library no longer exists.');
        const header = soaHeader(x, ws, profile?.display_name ?? 'Unknown', now);
        await logExport(supabase, orgId, format === 'csv' ? 'soa.csv' : 'soa.print', {
          framework: `${x.framework.key}@${x.framework.version}`,
          sheet_id: x.sheet.id,
          sheet: x.sheet.name,
          scope: x.scope,
          items: x.soa.rows.length,
        });
        return ok({
          ...x,
          header,
          csv: soaCsv(x.soa, header),
          filename: `${zipName(`SoA ${x.framework.title}`)} ${todayIn(now, ws.timeZone)}.csv`,
        });
      } catch (e) {
        return fromDbError(e as Error);
      }
    },
    'exportSoa',
  );
}

export interface AuditOutputs extends AuditScopes {
  timeZone: string;
  today: string;
  canCreateReview: boolean;
}

/** What the Audit outputs page offers: libraries, folders and pack installs to scope an audit pack by. */
export async function listAuditOutputs(input: unknown): Promise<Result<AuditOutputs>> {
  const p = auditScopesInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'member',
    async ({ supabase, orgId, role }) => {
      try {
        const [scopes, ws] = await Promise.all([
          readScopes(supabase, orgId),
          workspaceInfo(supabase, orgId),
        ]);
        return ok({
          ...scopes,
          timeZone: ws.timeZone,
          today: todayIn(new Date(), ws.timeZone),
          canCreateReview: isEditorRole(role),
        });
      } catch (e) {
        return fromDbError(e as Error);
      }
    },
    'listAuditOutputs',
  );
}

export interface AuditPackResult {
  filename: string;
  bytes: Uint8Array;
}

/**
 * The audit pack as a zip: SoA (CSV and printable HTML) of each library in scope, every register in scope as CSV,
 * the evidence index (and the files up to AUDIT_FILE_LIMITS when asked), the activity log of the period and the
 * hash chain check of every chain in scope. Built in memory with fflate; the file cap bounds its size.
 */
export async function buildAuditPack(input: unknown): Promise<Result<AuditPackResult>> {
  const p = auditPackInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  const period = { from: v.from, to: v.to };
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId, role, user, profile }) => {
      try {
        const now = new Date();
        const ws = await workspaceInfo(supabase, orgId);
        const who: Who = { orgId, slug: v.org, userId: user.id, isAdmin: isAdminRole(role) };
        const scope = await readScopeSheets(supabase, orgId, v.scope);
        if (!scope) return fail('not_found', 'This folder or pack no longer exists.');
        const by = profile?.display_name ?? 'Unknown';
        const directory = await fetchDirectory(supabase, orgId);
        const personName = new Map(directory.people.map((x) => [x.id, x.name]));
        const person = (id: string | null) =>
          id ? (personName.get(id) ?? 'Former member') : 'Unknown';

        const files: Zippable = {};
        const listed: string[] = [];
        const put = (path: string, text: string) => {
          files[path] = [strToU8(text), { level: 6 }];
          listed.push(path);
        };

        // statements of applicability
        const soaTitles: string[] = [];
        for (const id of scope.libraryIds) {
          const x = await readSoa(supabase, who, id, { timeZone: ws.timeZone, now });
          if (!x) continue;
          const header = soaHeader(x, ws, by, now);
          const base = `soa/${zipName(x.framework.title)}`;
          put(`${base}.csv`, soaCsv(x.soa, header));
          put(`${base}.html`, soaHtml(x.soa, header));
          soaTitles.push(x.framework.title);
        }

        // registers
        const loaded = (
          await Promise.all(
            scope.sheets.map((s) => loadSheet(supabase, who, s.id, ws.timeZone, now)),
          )
        ).flatMap((x) => (x ? [x] : []));
        const sheetName = new Map(loaded.map((l) => [l.data.sheet.id, l.data.sheet.name]));
        const names = uniqueNames(
          loaded.map((l) => {
            const parent = l.data.sheet.parentSheetId
              ? sheetName.get(l.data.sheet.parentSheetId)
              : null;
            return zipName(parent ? `${parent} - sub-items` : l.data.sheet.name, 'sheet');
          }),
        );
        loaded.forEach((l, i) => {
          const groups = new Map(l.data.groups.map((g) => [g.id, g.name]));
          put(
            `registers/${names[i]}.csv`,
            toCsv(
              registerTable(l.data.items, l.data.fields, l.ctx, (g) => groups.get(g) ?? ''),
              { bom: true },
            ),
          );
        });

        // evidence index, and the files themselves when asked
        const evidence = await readEvidence(supabase, loaded, person);
        let included = 0;
        if (v.files) {
          const fit = filesToInclude(evidence.filter((e) => e.storagePath));
          const usedPaths = new Set<string>();
          for (const e of evidence) {
            if (!fit.has(e.fileId)) continue;
            const { error: rpcError } = await supabase.rpc('download_file', { p_file: e.fileId });
            if (rpcError) continue;
            const { data } = await supabase.storage.from(BUCKET).download(e.storagePath);
            if (!data) continue;
            let path = `evidence/files/${zipName(e.item.displayId, 'item')}/${zipName(e.filename)}`;
            for (let n = 2; usedPaths.has(path); n++)
              path = `evidence/files/${zipName(e.item.displayId, 'item')}/${n}-${zipName(e.filename)}`;
            usedPaths.add(path);
            files[path] = [new Uint8Array(await data.arrayBuffer()), { level: 0 }];
            e.zipPath = path;
            included += 1;
          }
        }
        put('evidence/index.csv', toCsv(evidenceTable(evidence, ws.timeZone), { bom: true }));

        // the activity log of the period and the chain check
        const sheetIds = loaded.map((l) => l.data.sheet.id);
        const entries = (await readActivity(supabase, orgId, sheetIds, period)).filter((e) =>
          inPeriod(e.at, period, ws.timeZone),
        );
        const itemLabel = new Map<string, string>();
        const itemSheet = new Map<string, string>();
        for (const l of loaded)
          for (const it of l.data.items) {
            itemLabel.set(it.id, `${it.displayId} ${it.name}`);
            itemSheet.set(it.id, l.data.sheet.name);
          }
        const missing = [
          ...new Set(
            entries.flatMap((e) => (e.itemId && !itemLabel.has(e.itemId) ? [e.itemId] : [])),
          ),
        ];
        for (const [id, label] of await itemLabels(supabase, missing)) itemLabel.set(id, label);
        const fieldName = new Map(loaded.flatMap((l) => l.data.fields.map((f) => [f.id, f.name])));
        put(
          'activity/log.csv',
          toCsv(
            activityTable(
              entries,
              {
                person,
                item: (id) => (id ? (itemLabel.get(id) ?? id) : ''),
                sheet: (id) => (id ? (sheetName.get(id) ?? '') : ''),
                field: (id) => (id ? (fieldName.get(id) ?? '') : ''),
              },
              ws.timeZone,
            ),
            { bom: true },
          ),
        );
        const chainKeys = new Map<string, { label: string; sheetName: string }>();
        for (const l of loaded) {
          chainKeys.set(`sheet:${l.data.sheet.id}`, {
            label: `Sheet ${l.data.sheet.name}`,
            sheetName: l.data.sheet.name,
          });
          for (const it of l.data.items)
            chainKeys.set(it.id, { label: itemLabel.get(it.id)!, sheetName: l.data.sheet.name });
        }
        for (const e of entries)
          if (!chainKeys.has(e.chainKey))
            chainKeys.set(e.chainKey, {
              label: e.itemId ? (itemLabel.get(e.itemId) ?? e.chainKey) : e.chainKey,
              sheetName: e.sheetId ? (sheetName.get(e.sheetId) ?? '') : '',
            });
        const chains = await verifyChains(
          supabase,
          [...chainKeys].map(([chainKey, c]) => ({ chainKey, ...c })),
        );
        const summary = chainSummary(chains);
        put('activity/chains.csv', toCsv(chainTable(chains), { bom: true }));
        put('activity/method.txt', `${CHAIN_METHOD}\n`);

        const readme = packReadme({
          workspace: ws.name,
          scope: scope.label,
          period,
          generatedAt: now.toISOString(),
          generatedBy: by,
          timeZone: ws.timeZone,
          files: [...listed, ...(included ? [`evidence/files/ (${included} files)`] : [])],
          registers: loaded.length,
          evidence: { listed: evidence.length, included },
          entries: entries.length,
          chains: summary,
          soa: soaTitles,
          leftOut: scope.leftOut,
        });
        files['README.txt'] = [strToU8(readme), { level: 6 }];

        await logExport(supabase, orgId, 'audit_pack', {
          ...scope.log,
          from: v.from,
          to: v.to,
          sheets: loaded.length,
          files: evidence.length,
          files_included: included,
          entries: entries.length,
          chains: summary.chains,
          chains_ok: summary.ok,
          chains_broken: summary.broken,
        });
        const bytes = zipSync(files, { mtime: now });
        return ok({
          filename: `Audit pack ${zipName(scope.label)} ${v.from} to ${v.to}.zip`,
          bytes,
        });
      } catch (e) {
        return fromDbError(e as Error);
      }
    },
    'buildAuditPack',
  );
}

// ───────────────────────── management review inputs ─────────────────────────

function reviewRows(
  data: SheetData,
  ctx: Ctx,
  groupRefs: Map<string, string>,
  dateKey?: string,
  detailKey?: string,
): ReviewRow[] {
  const dateField = dateKey ? data.fields.find((f) => f.key === dateKey) : undefined;
  const detailField = detailKey ? data.fields.find((f) => f.key === detailKey) : undefined;
  const status = itemStatusField(ctx, data.fields);
  const groups = new Map(data.groups.map((g) => [g.id, g.name]));
  return data.items.map((it: Item) => ({
    id: it.id,
    sheetId: it.sheetId,
    displayId: it.displayId,
    name: it.name,
    group: groups.get(it.groupId) ?? '',
    groupRef: groupRefs.get(it.groupId) ?? null,
    status: status ? visibleTextOf(it, status, ctx) : '',
    done: isItemDone(it, ctx),
    overdue: data.fields.some((f) => isOverdueOf(it, f, ctx)),
    createdAt: it.createdAt,
    updatedAt: it.updatedAt,
    date: dateField ? dateOf(it, dateField, ctx) : null,
    detail: detailField ? visibleTextOf(it, detailField, ctx) || undefined : undefined,
  }));
}

export interface ReviewResult {
  review: ManagementReview;
  timeZone: string;
  generatedAt: string;
  generatedBy: string;
  workspace: string;
  /** The management review sheet, when a pack made one and the person can read it. */
  reviewSheet: { id: string; name: string } | null;
  canCreate: boolean;
}

async function compileReview(
  db: Db,
  who: Who,
  period: { from: string; to: string },
  now: Date,
  timeZone: string,
) {
  const sources: Partial<Record<ReviewSourceKey, ReviewSource | null>> = {};
  const partyGroupRefs: string[] = [];
  const issueGroupRefs: string[] = [];
  let reviewSheet: {
    id: string;
    name: string;
    groupId: string | null;
    checks: ReviewPackSource['review']['checks'];
  } | null = null;
  const { data: installs } = await db
    .from('pack_installs')
    .select('id, pack_key, ref_map')
    .eq('org_id', who.orgId)
    .eq('status', 'installed');
  const refMaps = new Map(
    (installs ?? []).map((i) => [i.pack_key, (i.ref_map ?? {}) as Record<string, string>]),
  );
  for (const def of REVIEW_PACK_SOURCES) {
    const inst = (installs ?? []).find((i) => i.pack_key === def.pack);
    if (!inst) continue;
    const refMap = (inst.ref_map ?? {}) as Record<string, string>;
    const id = (kind: 'sheet' | 'group', ref: string) =>
      resolveReviewRef(refMap, refMaps, kind, ref);
    const groupRefs = new Map(
      Object.entries(refMap)
        .filter(([k]) => k.startsWith('group:'))
        .map(([k, id]) => [id, k.slice('group:'.length)]),
    );
    partyGroupRefs.push(...def.partyGroups);
    issueGroupRefs.push(...def.issueGroups);
    for (const [key, ref] of Object.entries(def.sheets) as [ReviewSourceKey, string][]) {
      if (sources[key]) continue;
      const sheetId = id('sheet', ref);
      if (!sheetId) continue;
      const loaded = await loadSheet(db, who, sheetId, timeZone, now);
      if (!loaded) continue;
      sources[key] = {
        sheetId,
        sheetName: loaded.data.sheet.name,
        rows: reviewRows(
          loaded.data,
          loaded.ctx,
          groupRefs,
          def.dateFields[key],
          def.detailFields[key],
        ),
      };
      if (key === def.review.source) {
        reviewSheet = {
          id: sheetId,
          name: loaded.data.sheet.name,
          groupId: id('group', def.review.groupRef) ?? loaded.data.groups[0]?.id ?? null,
          checks: def.review.checks,
        };
      }
    }
  }
  // monitoring: what Frameworks shows for each adopted library
  const libraries = await readLibraries(db, who.orgId, { items: true });
  const monitoring: { label: string; value: string }[] = [];
  for (const lib of libraries) {
    const { coverage } = await readLibraryCoverage(db, lib, {
      today: todayIn(now, timeZone),
      now,
      timeZone,
      userId: who.userId,
    });
    monitoring.push({ label: lib.sheet.name, value: coverageText(coverage) });
  }
  const review = compileManagementReview({
    ...period,
    timeZone,
    sources,
    partyGroupRefs,
    issueGroupRefs,
    monitoring,
  });
  return { review, reviewSheet };
}

/** Management review inputs for a period, compiled from the workspace's sheets (docs/11 Audit outputs). */
export async function managementReviewInputs(input: unknown): Promise<Result<ReviewResult>> {
  const p = managementReviewInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId, role, user, profile }) => {
      try {
        const now = new Date();
        const ws = await workspaceInfo(supabase, orgId);
        const who: Who = { orgId, slug: v.org, userId: user.id, isAdmin: isAdminRole(role) };
        const { review, reviewSheet } = await compileReview(
          supabase,
          who,
          { from: v.from, to: v.to },
          now,
          ws.timeZone,
        );
        await logExport(supabase, orgId, 'management_review', { from: v.from, to: v.to });
        return ok({
          review,
          timeZone: ws.timeZone,
          generatedAt: now.toISOString(),
          generatedBy: profile?.display_name ?? 'Unknown',
          workspace: ws.name,
          reviewSheet: reviewSheet ? { id: reviewSheet.id, name: reviewSheet.name } : null,
          canCreate: !!reviewSheet && isEditorRole(role),
        });
      } catch (e) {
        return fromDbError(e as Error);
      }
    },
    'managementReviewInputs',
  );
}

/**
 * Add a Management review item with the compiled inputs: the inputs that have data ticked, and the report posted as
 * the item's first update. Through createItem and postUpdate, so validation, the log and automations run as usual.
 */
export async function createManagementReview(
  input: unknown,
): Promise<Result<{ sheetId: string; displayId: string }>> {
  const p = managementReviewInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role, user }) => {
      try {
        const now = new Date();
        const ws = await workspaceInfo(supabase, orgId);
        const who: Who = { orgId, slug: v.org, userId: user.id, isAdmin: isAdminRole(role) };
        const { review, reviewSheet } = await compileReview(
          supabase,
          who,
          { from: v.from, to: v.to },
          now,
          ws.timeZone,
        );
        if (!reviewSheet?.groupId)
          return fail('not_found', 'There is no management review sheet you can add to.');
        const loaded = await loadSheet(supabase, who, reviewSheet.id, ws.timeZone, now);
        if (!loaded)
          return fail('not_found', 'There is no management review sheet you can add to.');
        const values: Record<string, unknown> = {};
        for (const s of review.sections) {
          if (!s.available) continue;
          for (const key of reviewSheet.checks[s.key] ?? []) {
            const f = loaded.data.fields.find((x) => x.key === key);
            if (f && !f.hidden) values[f.id] = true;
          }
        }
        const last = loaded.data.items
          .filter((i) => i.groupId === reviewSheet!.groupId)
          .map((i) => i.position)
          .sort()
          .pop();
        const created = await createItem({
          org: v.org,
          sheetId: reviewSheet.id,
          groupId: reviewSheet.groupId,
          name: `Management review ${review.periodLabel}`,
          position: generateKeyBetween(last ?? null, null),
          values,
        });
        if (!created.ok) return created;
        const posted = await postUpdate({
          org: v.org,
          itemId: created.data.item.id,
          body: review.summary,
        });
        if (!posted.ok) return posted;
        await logExport(supabase, orgId, 'management_review.item', {
          from: v.from,
          to: v.to,
          item_id: created.data.item.id,
        });
        return ok({ sheetId: reviewSheet.id, displayId: created.data.item.displayId });
      } catch (e) {
        return fromDbError(e as Error);
      }
    },
    'createManagementReview',
  );
}

/**
 * The management review sheet of each live install of a pack that has one (REVIEW_PACK_SOURCES), by install id: the
 * setup checklist links that step to the management review inputs.
 */
export async function reviewSheetsByInstall(
  input: unknown,
): Promise<Result<Record<string, string>>> {
  const p = auditScopesInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'member',
    async ({ supabase, orgId }) => {
      const { data, error } = await supabase
        .from('pack_installs')
        .select('id, pack_key, ref_map')
        .eq('org_id', orgId)
        .eq('status', 'installed');
      if (error) return fromDbError(error);
      const out: Record<string, string> = {};
      const refMaps = new Map(
        (data ?? []).map((i) => [i.pack_key, (i.ref_map ?? {}) as Record<string, string>]),
      );
      for (const i of data ?? []) {
        const def = REVIEW_PACK_SOURCES.find((d) => d.pack === i.pack_key);
        const ref = def?.sheets[def.review.source];
        const own = (i.ref_map ?? {}) as Record<string, string>;
        const id = ref ? resolveReviewRef(own, refMaps, 'sheet', ref) : undefined;
        if (id) out[i.id] = id;
      }
      return ok(out);
    },
    'reviewSheetsByInstall',
  );
}
