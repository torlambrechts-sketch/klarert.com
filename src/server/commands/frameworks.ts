import 'server-only';
import { randomUUID } from 'node:crypto';
import { canEdit as canEditLevel } from '@/engine/access';
import { controlsSheets, withControlsLink, type ControlsSheet } from '@/engine/frameworks/adopt';
import { coverageText, isCovered, type Coverage } from '@/engine/frameworks/coverage';
import {
  alsoSatisfies,
  crosswalkIndex,
  suggestEquivalents,
  type AdoptedRequirement,
} from '@/engine/frameworks/crosswalks';
import { parseRequirementKey } from '@/engine/frameworks/refs';
import type { FrameworkKind, Relation } from '@/engine/frameworks/types';
import { previewLines, type PackPreview } from '@/engine/packs/plan';
import { todayIn } from '@/engine/sheet-data';
import {
  adoptFrameworkInput,
  listFrameworksInput,
  previewAdoptionInput,
  requirementContextInput,
} from '@/lib/schemas/frameworks';
import { fetchItemsById, type Db } from '@/lib/sheet-query';
import { SHEET_COLUMNS, toSheet } from '@/lib/sheet-rows';
import { isAdminRole, isEditorRole } from '@/server/auth';
import {
  readCrosswalks,
  readFrameworks,
  type CatalogueFramework,
} from '@/server/frameworks/catalogue';
import {
  adoptedRequirements,
  linksAround,
  readFields,
  readLibraries,
  readLibraryCoverage,
  type Library,
} from '@/server/frameworks/workspace';
import { planInstall, readPack } from '@/server/packs/install';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { sheetLevel } from './access';
import { withOrg } from './context';

// The requirement library (docs/12). The catalogue (frameworks, requirements, cross-walks) is global and read-only.
// Owners and admins adopt a framework: its library pack is planned on the server from the catalogue (the browser
// names the framework, the controls sheet and the hash it previewed) and written by adopt_framework in one
// transaction. Coverage, "Also satisfies" and suggestions are worked out by the engine from rows read under RLS.

async function timeZoneOf(db: Db, orgId: string) {
  const { data } = await db.from('orgs').select('time_zone').eq('id', orgId).maybeSingle();
  return data?.time_zone ?? 'Europe/London';
}

const fwId = (f: { key: string; version: string }) => `${f.key}@${f.version}`;

export interface AdoptedFramework {
  sheetId: string;
  sheetName: string;
  version: string;
  coverage: Coverage;
  /** "62% covered · 80 applicable · 5 not applicable · 42 to decide" */
  coverageText: string;
}

export interface FrameworkCard extends CatalogueFramework {
  adopted: AdoptedFramework | null;
}

export interface FrameworkList {
  canAdopt: boolean;
  frameworks: FrameworkCard[];
  /** Sheets that can hold the controls (owners and admins). */
  controlsSheets: ControlsSheet[];
}

async function readControlsSheets(db: Db, orgId: string): Promise<ControlsSheet[]> {
  const { data, error } = await db
    .from('sheets')
    .select(SHEET_COLUMNS)
    .eq('org_id', orgId)
    .is('archived_at', null)
    .is('parent_sheet_id', null)
    .order('position');
  if (error) throw new Error(error.message);
  const sheets = (data ?? []).map(toSheet);
  const fields = await readFields(
    db,
    sheets.filter((s) => !s.isLibrary).map((s) => s.id),
  );
  return controlsSheets(sheets, fields);
}

/** The catalogue with what this workspace has adopted and its coverage. Every member may read it. */
export async function listFrameworks(input: unknown): Promise<Result<FrameworkList>> {
  const p = listFrameworksInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'member',
    async ({ supabase, orgId, role, user }) => {
      try {
        const now = new Date();
        const timeZone = await timeZoneOf(supabase, orgId);
        const env = { today: todayIn(now, timeZone), now, timeZone, userId: user.id };
        const [catalogue, libraries, controls] = await Promise.all([
          readFrameworks(supabase),
          readLibraries(supabase, orgId, { items: true }),
          isAdminRole(role) ? readControlsSheets(supabase, orgId) : Promise.resolve([]),
        ]);
        const adopted = new Map<string, AdoptedFramework>();
        for (const lib of libraries) {
          const { coverage } = await readLibraryCoverage(supabase, lib, env);
          adopted.set(lib.framework.key, {
            sheetId: lib.sheet.id,
            sheetName: lib.sheet.name,
            version: lib.framework.version,
            coverage,
            coverageText: coverageText(coverage),
          });
        }
        return ok({
          canAdopt: isAdminRole(role),
          frameworks: catalogue.map((f) => ({ ...f, adopted: adopted.get(f.key) ?? null })),
          controlsSheets: controls,
        });
      } catch (e) {
        console.error(JSON.stringify({ level: 'error', source: 'frameworks', error: String(e) }));
        return fail('failed', 'The frameworks could not be loaded. Try again.');
      }
    },
    'listFrameworks',
  );
}

async function planAdoption(
  db: Db,
  orgId: string,
  userId: string,
  v: { framework: string; version: string; controlsSheetId?: string | null },
) {
  const fw = (await readFrameworks(db)).find(
    (f) => f.key === v.framework && f.version === v.version,
  );
  if (!fw) return fail('not_found', 'This framework is no longer in the catalogue.');
  const pack = await readPack(db, fw.packKey);
  if (!pack || pack.version !== fw.packVersion)
    return fail('not_found', 'The library of this framework is not in the catalogue yet.');
  let controls: ControlsSheet | null = null;
  if (v.controlsSheetId) {
    controls =
      (await readControlsSheets(db, orgId)).find((c) => c.sheetId === v.controlsSheetId) ?? null;
    if (!controls)
      return fail(
        'invalid',
        'Choose a sheet with a requirement field that links to any library sheet.',
      );
  }
  const plan = withControlsLink(
    await planInstall(db, orgId, pack, { userId, now: new Date(), newId: randomUUID }),
    controls,
    randomUUID,
  );
  return ok({ fw, pack, plan, controls });
}

export interface AdoptionPreview {
  hash: string;
  title: string;
  version: string;
  licence: string;
  preview: PackPreview;
  lines: string[];
}

/** What adopting a framework would create here now. Owners and admins. */
export async function previewAdoption(input: unknown): Promise<Result<AdoptionPreview>> {
  const p = previewAdoptionInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId, user }) => {
      try {
        const r = await planAdoption(supabase, orgId, user.id, p.data);
        if (!r.ok) return r;
        const { fw, pack, plan } = r.data;
        return ok({
          hash: pack.hash,
          title: fw.title,
          version: fw.version,
          licence: fw.licence,
          preview: plan.preview,
          lines: previewLines(plan.preview),
        });
      } catch (e) {
        console.error(JSON.stringify({ level: 'error', source: 'frameworks', error: String(e) }));
        return fail('failed', 'The preview could not be made. Try again.');
      }
    },
    'previewAdoption',
  );
}

export interface AdoptionResult {
  title: string;
  sheetId: string;
  requirements: number;
}

/** Adopt a framework: planned again from the catalogue and the workspace as they are now, one transaction. */
export async function adoptFramework(input: unknown): Promise<Result<AdoptionResult>> {
  const p = adoptFrameworkInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId, user }) => {
      const r = await planAdoption(supabase, orgId, user.id, p.data);
      if (!r.ok) return r;
      const { fw, pack, plan } = r.data;
      if (pack.hash !== p.data.hash)
        return fail('conflict', 'This library changed since you previewed it. Preview it again.');
      if (plan.state === 'installed')
        return fail('conflict', `${fw.title} is already adopted in this workspace.`);
      if (plan.state === 'blocked' || !plan.payload)
        return fail('conflict', plan.preview.conflicts[0] ?? `${fw.title} cannot be adopted.`);
      const { data, error } = await supabase.rpc('adopt_framework', {
        p_org: orgId,
        p_framework: fw.key,
        p_version: fw.version,
        p_plan: plan.payload as never,
      });
      if (error) {
        if (/already adopted/.test(error.message))
          return fail('conflict', `${fw.title} is already adopted in this workspace.`);
        return fromDbError(error);
      }
      const out = data as { sheet_id: string; requirements: number };
      return ok({ title: fw.title, sheetId: out.sheet_id, requirements: out.requirements });
    },
    'adoptFramework',
  );
}

// ───────────────────────── the item panel ─────────────────────────

export interface RequirementChip {
  itemId: string;
  sheetId: string;
  displayId: string;
  name: string;
  /** "27001 A.5.1" */
  label: string;
}

export interface RelatedChip extends RequirementChip {
  relation: Relation;
  note: string;
}

export interface CoveringControl {
  itemId: string;
  sheetId: string;
  displayId: string;
  name: string;
  sheetName: string;
  /** The control's status is done; null when its sheet has no status. */
  done: boolean | null;
}

export interface RequirementContext {
  /** Set on a library item of an adopted framework. */
  requirement: {
    label: string;
    framework: string;
    kind: FrameworkKind | null;
    licence: string | null;
    url: string | null;
    alsoSatisfies: RelatedChip[];
    controls: CoveringControl[];
    covered: boolean;
  } | null;
  /** The adopted requirements this item is linked to (a control's "Covers"). */
  covers: RequirementChip[];
  /** Equivalents of what it covers that it is not linked to yet. */
  suggestions: (RelatedChip & { via: string[] })[];
  /** The field "Link" adds a suggestion to: a requirement field of this sheet that links to any library. */
  linkFieldId: string | null;
  canLink: boolean;
  /** Who mapped the cross-walks shown ("Klarert mapping v1"). */
  sources: string[];
}

const chip = (r: AdoptedRequirement): RequirementChip => ({
  itemId: r.itemId,
  sheetId: r.sheetId,
  displayId: r.displayId,
  name: r.name,
  label: r.label,
});

/** Requirements around one item: "Also satisfies" and its controls, or what a control covers and could cover. */
export async function requirementContext(input: unknown): Promise<Result<RequirementContext>> {
  const p = requirementContextInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId, role, user }) => {
      try {
        const [item] = await fetchItemsById(supabase, [v.itemId]);
        if (!item || item.sheetId !== v.sheetId || item.archivedAt)
          return fail('not_found', 'This item no longer exists.');
        const { data: sheetRow } = await supabase
          .from('sheets')
          .select(SHEET_COLUMNS)
          .eq('id', v.sheetId)
          .eq('org_id', orgId)
          .maybeSingle();
        if (!sheetRow) return fail('not_found', 'This sheet no longer exists.');
        const sheet = toSheet(sheetRow);
        const now = new Date();
        const timeZone = await timeZoneOf(supabase, orgId);
        const env = { today: todayIn(now, timeZone), now, timeZone, userId: user.id };

        const [catalogue, libraries, ownFields, level] = await Promise.all([
          readFrameworks(supabase),
          readLibraries(supabase, orgId, { items: true }),
          readFields(supabase, [sheet.id]),
          sheetLevel(supabase, sheet.id),
        ]);
        const order = catalogue.map(fwId);
        const shortTitles = new Map(catalogue.map((f) => [fwId(f), f.shortTitle]));
        const adopted = adoptedRequirements(libraries, shortTitles, order);
        const crosswalks = await readCrosswalks(
          supabase,
          libraries.map((l) => fwId(l.framework)),
        );
        const index = crosswalkIndex(crosswalks);
        const byItem = new Map([...adopted.values()].map((r) => [r.itemId, r]));
        const sources = new Set<string>();

        let requirement: RequirementContext['requirement'] = null;
        if (item.requirementRef && adopted.has(item.requirementRef)) {
          const id = parseRequirementKey(item.requirementRef)!;
          const fw = catalogue.find((f) => f.key === id.framework && f.version === id.version);
          const lib = libraries.find((l) => l.sheet.id === sheet.id) as Library;
          const single = { ...lib, items: [item] };
          const { rows, others } = await readLibraryCoverage(supabase, single, env);
          const row = rows.get(item.id)!;
          const sheetNames = new Map(others.map((o) => [o.sheet.sheet.id, o.sheet.sheet.name]));
          const also = alsoSatisfies(item.requirementRef, index, adopted);
          for (const a of also) sources.add(a.source);
          requirement = {
            label: adopted.get(item.requirementRef)!.label,
            framework: fw?.title ?? id.framework,
            kind: fw?.kind ?? null,
            licence: fw?.licence ?? null,
            url: fw?.url ?? null,
            alsoSatisfies: also.map((a) => ({
              ...chip(a.requirement),
              relation: a.relation,
              note: a.note,
            })),
            controls: row.controlIds.flatMap((cid) => {
              const o = others.find((x) => x.item.id === cid);
              return o
                ? [
                    {
                      itemId: o.item.id,
                      sheetId: o.item.sheetId,
                      displayId: o.item.displayId,
                      name: o.item.name,
                      sheetName: sheetNames.get(o.item.sheetId) ?? '',
                      done: row.controls[row.controlIds.indexOf(cid)]?.done ?? null,
                    },
                  ]
                : [];
            }),
            covered: isCovered(row),
          };
        }

        // what this item covers: adopted requirements linked from it, or linking to it
        const { links } = await linksAround(supabase, [item.id]);
        const coveredKeys = [
          ...new Set(
            links.flatMap((l) => {
              const other = l.from === item.id ? l.to : l.from;
              const r = byItem.get(other);
              return r && other !== item.id ? [r.key] : [];
            }),
          ),
        ];
        const covers = item.requirementRef
          ? []
          : coveredKeys
              .map((k) => adopted.get(k)!)
              .sort((a, b) => a.order - b.order)
              .map(chip);
        const linkField =
          ownFields.find(
            (f) =>
              (f.type === 'requirement' || f.type === 'controllink') &&
              !(f.config as { targetSheetId?: string | null }).targetSheetId &&
              !f.hidden,
          ) ?? null;
        const suggestions = item.requirementRef
          ? []
          : suggestEquivalents(coveredKeys, index, adopted).map((s) => {
              sources.add(s.source);
              return {
                ...chip(s.requirement),
                relation: s.relation,
                note: s.note,
                via: s.via.map((k) => adopted.get(k)?.label ?? k),
              };
            });
        return ok({
          requirement,
          covers,
          suggestions,
          linkFieldId: linkField?.id ?? null,
          canLink:
            !!linkField &&
            isEditorRole(role) &&
            canEditLevel(level) &&
            (!item.locked || isAdminRole(role)),
          sources: [...sources],
        });
      } catch (e) {
        console.error(JSON.stringify({ level: 'error', source: 'frameworks', error: String(e) }));
        return fail('failed', 'The requirements could not be loaded. Try again.');
      }
    },
    'requirementContext',
  );
}
