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
import {
  planEditionMove,
  REVIEW_REASON_TEXT,
  type EditionMovePlan,
  type ReviewReason,
} from '@/engine/frameworks/edition';
import { frameworkPackKey, parseRequirementKey } from '@/engine/frameworks/refs';
import {
  editionBadge,
  isReplaced,
  successorId,
  type EditionBadge,
} from '@/engine/frameworks/status';
import type { FrameworkKind, Relation } from '@/engine/frameworks/types';
import { previewLines, type PackPreview } from '@/engine/packs/plan';
import { todayIn } from '@/engine/sheet-data';
import { formatDate, isoDateInZone } from '@/engine/fields/helpers';
import {
  adoptFrameworkInput,
  editionMoveInput,
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
  readOwnMappings,
  type CatalogueFramework,
} from '@/server/frameworks/catalogue';
import {
  adoptedRequirements,
  evidenceCounts,
  linksAround,
  readFields,
  readLibraries,
  readLibraryCoverage,
  type Library,
} from '@/server/frameworks/workspace';
import { planInstall, readPack } from '@/server/packs/install';
import { readPackVersions, updatesFor } from '@/server/packs/upgrade';
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
  /** The library's install and a newer revision in the catalogue (docs/11 Upgrades), if any. */
  install: { id: string; version: string; updateTo: string | null } | null;
  /** Moved to a new edition: that edition's library (this one is read-only). */
  movedTo: { sheetId: string; version: string; title: string } | null;
  /** The edition that replaces this one is adopted too and nothing was moved yet: "Move to the new edition". */
  canMove: boolean;
}

export interface FrameworkCard extends CatalogueFramework {
  /** The workspace's own framework (docs/12 Your own frameworks): written by the workspace, not reviewed by us. */
  own: boolean;
  adopted: AdoptedFramework | null;
  /** Edition status words for the badge (docs/12 Standards watch); null for a current edition. */
  badge: EditionBadge | null;
  /** The edition that replaces this one, when the catalogue has it. */
  successor: { key: string; version: string; title: string; adopted: boolean } | null;
}

export interface OwnDraft {
  key: string;
  title: string;
  updatedAt: string;
  /** A draft of a framework already published (its next revision or edition). */
  published: boolean;
}

export interface FrameworkList {
  canAdopt: boolean;
  frameworks: FrameworkCard[];
  /** Sheets that can hold the controls (owners and admins). */
  controlsSheets: ControlsSheet[];
  /** The workspace's name: "Written by <workspace>. Not reviewed by Klarert." */
  workspace: string;
  /** Drafts of the workspace's own frameworks (owners and admins). */
  drafts: OwnDraft[];
}

export async function readControlsSheets(db: Db, orgId: string): Promise<ControlsSheet[]> {
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
        const [catalogue, libraries, controls, installs, versions, org, drafts] = await Promise.all(
          [
            readFrameworks(supabase, orgId),
            readLibraries(supabase, orgId, { items: true }),
            isAdminRole(role) ? readControlsSheets(supabase, orgId) : Promise.resolve([]),
            supabase
              .from('pack_installs')
              .select('id, pack_key, version, status')
              .eq('org_id', orgId)
              .eq('status', 'installed')
              .like('pack_key', 'framework-%'),
            readPackVersions(supabase).catch(() => []),
            supabase.from('orgs').select('name').eq('id', orgId).maybeSingle(),
            isAdminRole(role)
              ? supabase
                  .from('framework_drafts')
                  .select('key, body->title, updated_at')
                  .eq('org_id', orgId)
                  .order('updated_at', { ascending: false })
              : Promise.resolve({ data: [], error: null }),
          ],
        );
        if (installs.error) throw new Error(installs.error.message);
        if (drafts.error) throw new Error(drafts.error.message);
        const updates = updatesFor(installs.data ?? [], versions);
        const byId = new Map(catalogue.map((f) => [fwId(f), f]));
        const adoptedIds = new Set(libraries.map((l) => fwId(l.framework)));
        const adopted = new Map<string, AdoptedFramework>();
        for (const lib of libraries) {
          const { coverage } = await readLibraryCoverage(supabase, lib, env);
          const cat = byId.get(fwId(lib.framework));
          const packKey = cat?.packKey ?? frameworkPackKey(lib.framework.key);
          const inst = (installs.data ?? []).find((i) => i.pack_key === packKey);
          const movedTo = lib.framework.movedTo ?? null;
          adopted.set(fwId(lib.framework), {
            sheetId: lib.sheet.id,
            sheetName: lib.sheet.name,
            version: lib.framework.version,
            coverage,
            coverageText: coverageText(coverage),
            install: inst
              ? { id: inst.id, version: inst.version, updateTo: updates.get(inst.id) ?? null }
              : null,
            movedTo,
            canMove:
              !movedTo &&
              !!cat &&
              isReplaced(cat) &&
              !!cat.supersededBy &&
              adoptedIds.has(cat.supersededBy),
          });
        }
        return ok({
          canAdopt: isAdminRole(role),
          frameworks: catalogue.map((f) => {
            const next = successorId(f);
            const succ = next ? byId.get(`${next.key}@${next.version}`) : undefined;
            return {
              ...f,
              own: f.orgId !== null,
              adopted: adopted.get(fwId(f)) ?? null,
              badge: editionBadge(f, succ?.title ?? null),
              successor: succ
                ? {
                    key: succ.key,
                    version: succ.version,
                    title: succ.title,
                    adopted: adoptedIds.has(fwId(succ)),
                  }
                : null,
            };
          }),
          controlsSheets: controls,
          workspace: org.data?.name ?? '',
          drafts: (
            (drafts.data ?? []) as unknown as {
              key: string;
              title: unknown;
              updated_at: string;
            }[]
          ).map((d) => ({
            key: d.key,
            title: typeof d.title === 'string' && d.title ? d.title : 'Untitled framework',
            updatedAt: d.updated_at,
            published: catalogue.some((f) => f.key === d.key),
          })),
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
  const fw = (await readFrameworks(db, orgId)).find(
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

/**
 * Adopt a framework a pack builds on (docs/11 Frameworks), with no controls sheet: the pack's own sheets link to the
 * library through their requirement fields. Called by installPack for an owner or admin, before the pack is planned.
 * Adopted already: nothing to do.
 */
export async function adoptForPack(
  db: Db,
  orgId: string,
  userId: string,
  f: { key: string; version: string },
): Promise<Result<{ title: string; adopted: boolean }>> {
  const r = await planAdoption(db, orgId, userId, { framework: f.key, version: f.version });
  if (!r.ok) return r;
  const { fw, plan } = r.data;
  if (plan.state === 'installed') return ok({ title: fw.title, adopted: false });
  if (plan.state === 'blocked' || !plan.payload)
    return fail('conflict', plan.preview.conflicts[0] ?? `${fw.title} cannot be adopted.`);
  const { error } = await db.rpc('adopt_framework', {
    p_org: orgId,
    p_framework: fw.key,
    p_version: fw.version,
    p_plan: plan.payload as never,
  });
  if (error) {
    if (/already adopted/.test(error.message)) return ok({ title: fw.title, adopted: false });
    return fromDbError(error);
  }
  return ok({ title: fw.title, adopted: true });
}

// ───────────────────────── moving to a new edition ─────────────────────────

export interface EditionMovePreview {
  from: { title: string; sheetId: string };
  to: { title: string; sheetId: string };
  /** Requirements whose answers are copied (the same requirement, one to one). */
  copies: { fromRef: string; toRef: string; fields: number }[];
  /** Control links repeated on the new requirements. */
  links: number;
  /** New requirements to review, with why. */
  review: { toRef: string; name: string; reason: ReviewReason; text: string; from: string[] }[];
  /** Old refs whose evidence files stay on the old library. */
  evidenceStays: string[];
  /** Items of the old library that become read-only. */
  locked: number;
}

async function planMove(
  db: Db,
  orgId: string,
  fromSheetId: string,
): Promise<
  Result<{ preview: EditionMovePreview; plan: EditionMovePlan; fromId: string; toId: string }>
> {
  const now = new Date();
  const timeZone = await timeZoneOf(db, orgId);
  const today = todayIn(now, timeZone);
  const [catalogue, libraries] = await Promise.all([
    readFrameworks(db, orgId),
    readLibraries(db, orgId, { items: true }),
  ]);
  const from = libraries.find((l) => l.sheet.id === fromSheetId);
  if (!from) return fail('not_found', 'This library no longer exists.');
  if (from.framework.movedTo)
    return fail('conflict', `This library was already moved to ${from.framework.movedTo.title}.`);
  const fw = catalogue.find((f) => fwId(f) === fwId(from.framework));
  if (!fw || !isReplaced(fw) || !fw.supersededBy)
    return fail('invalid', 'This edition is current: there is no newer edition to move to.');
  const succ = catalogue.find((f) => fwId(f) === fw.supersededBy);
  const to = libraries.find((l) => fwId(l.framework) === fw.supersededBy);
  if (!succ || !to)
    return fail('invalid', `Adopt ${succ?.title ?? fw.supersededBy} first, then move to it.`);
  const ids = from.items.map((i) => i.id);
  const [crosswalks, around, evidence] = await Promise.all([
    readCrosswalks(db, [fwId(fw), fwId(succ)], orgId),
    linksAround(db, ids),
    evidenceCounts(db, from.fields, ids, today),
  ]);
  const plan = planEditionMove({
    from: {
      sheetId: from.sheet.id,
      framework: from.framework,
      fields: from.fields,
      items: from.items,
    },
    to: { sheetId: to.sheet.id, framework: to.framework, fields: to.fields, items: to.items },
    crosswalks,
    links: around.links,
    linkFields: around.others.flatMap((o) => o.sheet.fields),
    evidence,
  });
  return ok({
    plan,
    fromId: from.sheet.id,
    toId: to.sheet.id,
    preview: {
      from: { title: fw.title, sheetId: from.sheet.id },
      to: { title: succ.title, sheetId: to.sheet.id },
      copies: plan.copies.map((c) => ({
        fromRef: c.fromRef,
        toRef: c.toRef,
        fields: Object.keys(c.patch).length,
      })),
      links: plan.links.length,
      review: plan.review.map((r) => ({
        toRef: r.toRef,
        name: r.toName,
        reason: r.reason,
        text: REVIEW_REASON_TEXT[r.reason],
        from: r.from.map((x) => x.ref),
      })),
      evidenceStays: plan.evidenceStays,
      locked: from.items.filter((i) => !i.archivedAt && !i.locked).length,
    },
  });
}

/** What moving a library to the edition that replaces it would do. Owners and admins. */
export async function previewEditionMove(input: unknown): Promise<Result<EditionMovePreview>> {
  const p = editionMoveInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      try {
        const r = await planMove(supabase, orgId, p.data.fromSheetId);
        return r.ok ? ok(r.data.preview) : r;
      } catch (e) {
        console.error(JSON.stringify({ level: 'error', source: 'frameworks', error: String(e) }));
        return fail('failed', 'The move could not be planned. Try again.');
      }
    },
    'previewEditionMove',
  );
}

export interface EditionMoveResult {
  copied: number;
  links: number;
  locked: number;
  review: number;
  toSheetId: string;
  toTitle: string;
}

/**
 * Move a library to the new edition (docs/12): planned again from the workspace as it is now, written by
 * move_framework_edition in one transaction (answers copied where the requirement is the same, control links
 * repeated, the old library locked and marked as moved).
 */
export async function moveToEdition(input: unknown): Promise<Result<EditionMoveResult>> {
  const p = editionMoveInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const r = await planMove(supabase, orgId, p.data.fromSheetId);
      if (!r.ok) return r;
      const { plan, preview, fromId, toId } = r.data;
      const { data, error } = await supabase.rpc('move_framework_edition', {
        p_org: orgId,
        p_from_sheet: fromId,
        p_to_sheet: toId,
        p_copies: plan.copies.map((c) => ({
          from_item: c.fromItemId,
          to_item: c.toItemId,
          patch: c.patch,
        })) as never,
        p_links: plan.links.map((l) => ({
          field_id: l.fieldId,
          from_item: l.from,
          to_item: l.to,
        })) as never,
      });
      if (error) {
        if (/already moved/.test(error.message))
          return fail('conflict', `${preview.from.title} was already moved.`);
        return fromDbError(error);
      }
      const out = data as { copied: number; links: number; locked: number };
      return ok({
        ...out,
        review: preview.review.length,
        toSheetId: toId,
        toTitle: preview.to.title,
      });
    },
    'moveToEdition',
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
  /** The workspace's own mapping: who and when ("Your mapping · Anna · 3 Dec 2026"); null for ours. */
  own: { by: string | null; at: string; atText: string } | null;
}

/** One of the workspace's own mappings from its own requirement ("Map to …"), adopted or not. */
export interface OwnMapping {
  id: number;
  /** The catalogue requirement, `<key>@<version>#<ref>`. */
  to: string;
  /** "27001 A.5.1" */
  label: string;
  title: string;
  relation: Relation;
  note: string;
  by: string | null;
  at: string;
  /** "3 Dec 2026", in the workspace's time zone. */
  atText: string;
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
    /**
     * A requirement of the workspace's own framework: its mappings to catalogue requirements and whether this person
     * may change them (owners and admins). Null on a catalogue requirement.
     */
    own: { key: string; mappings: OwnMapping[]; canMap: boolean } | null;
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

/** The workspace's own live mappings from one of its requirements, with the catalogue requirement's label and title. */
const dayOf = (at: string, timeZone: string) => formatDate(isoDateInZone(at, timeZone));

async function ownMappingsOf(
  db: Db,
  orgId: string,
  key: string,
  catalogue: CatalogueFramework[],
  timeZone: string,
): Promise<OwnMapping[]> {
  const list = await readOwnMappings(db, orgId, key);
  if (list.length === 0) return [];
  const short = new Map(catalogue.map((f) => [fwId(f), f.shortTitle]));
  const { data, error } = await db
    .from('requirements')
    .select('framework_key, framework_version, ref, title')
    .is('org_id', null)
    .in('framework_key', [...new Set(list.map((c) => c.to.framework))])
    .in('ref', [...new Set(list.map((c) => c.to.ref))]);
  if (error) throw new Error(`requirements: ${error.message}`);
  const titles = new Map(
    (data ?? []).map((r) => [`${r.framework_key}@${r.framework_version}#${r.ref}`, r.title]),
  );
  return list.map((c) => {
    const to = `${c.to.framework}@${c.to.version}#${c.to.ref}`;
    return {
      id: c.own!.id,
      to,
      label: `${short.get(`${c.to.framework}@${c.to.version}`) ?? c.to.framework} ${c.to.ref}`,
      title: titles.get(to) ?? '',
      relation: c.relation,
      note: c.note,
      by: c.own!.by,
      at: c.own!.at,
      atText: dayOf(c.own!.at, timeZone),
    };
  });
}

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
          readFrameworks(supabase, orgId),
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
          orgId,
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
          // the workspace's own mappings are shown apart, with who made them; only ours are listed as sources
          for (const a of also) if (!a.own) sources.add(a.source);
          const own =
            fw?.orgId === orgId
              ? {
                  key: item.requirementRef,
                  canMap: isAdminRole(role),
                  mappings: await ownMappingsOf(
                    supabase,
                    orgId,
                    item.requirementRef,
                    catalogue,
                    timeZone,
                  ),
                }
              : null;
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
              own: a.own ? { by: a.own.by, at: a.own.at, atText: dayOf(a.own.at, timeZone) } : null,
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
            own,
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
              if (!s.own) sources.add(s.source);
              return {
                ...chip(s.requirement),
                relation: s.relation,
                note: s.note,
                own: s.own
                  ? { by: s.own.by, at: s.own.at, atText: dayOf(s.own.at, timeZone) }
                  : null,
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
