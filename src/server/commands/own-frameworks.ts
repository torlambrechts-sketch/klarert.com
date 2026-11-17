import 'server-only';
import {
  copyStructure,
  draftDetailProblems,
  draftFromFramework,
  editionMappingFor,
  emptyRow,
  isGroup,
  ownFrameworkKey,
  ownFrameworkProblems,
  ownKeyPrefix,
  publishDecision,
  toFramework,
  trimDraft,
  type FrameworkDraft,
  type PublishKind,
} from '@/engine/frameworks/own';
import { frameworkToPack } from '@/engine/frameworks/pack';
import { requirementKey, requirementLabel } from '@/engine/frameworks/refs';
import type { FrameworkKind, Relation, Requirement } from '@/engine/frameworks/types';
import { todayIn } from '@/engine/sheet-data';
import type { Json } from '@/engine/types';
import { packHash } from '@/lib/packs/hash';
import { parsePack } from '@/lib/packs/manifest';
import {
  createOwnFrameworkInput,
  deleteOwnDraftInput,
  mapOwnRequirementInput,
  ownFrameworkEditorInput,
  ownMappingOptionsInput,
  publishOwnFrameworkInput,
  retireOwnMappingInput,
  saveOwnDraftInput,
} from '@/lib/schemas/own-frameworks';
import { fetchAllPages, type Db } from '@/lib/sheet-query';
import {
  frameworkHash,
  readFrameworks,
  readRequirements,
  type CatalogueFramework,
} from '@/server/frameworks/catalogue';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { withOrg } from './context';
import { readControlsSheets } from './frameworks';
import type { ControlsSheet } from '@/engine/frameworks/adopt';

// A workspace's own frameworks (docs/12 Your own frameworks). Owners and admins write a draft (pasted or uploaded,
// blank, or the structure of a catalogue framework), fix it in the grid until ownFrameworkProblems has nothing to
// say, and publish it: the server builds the framework and its library pack with the same engine as the catalogue
// (toFramework, frameworkToPack, frameworkHash) and publish_framework writes them in one transaction with
// `framework.published` on the workspace chain. Adopting then uses the ordinary adoption (commands/frameworks.ts).
// Owners and admins also map their own requirements to catalogue requirements (set_crosswalk, retire_crosswalk).

/** The RPCs' own refusals ("publish: …", "map: …", "draft: …") are written for people. */
function dbFail(error: { message: string; code?: string }): Result<never> {
  const m = error.message.match(/^(?:publish|map|draft): (.*)$/s);
  if (m) {
    const text = m[1]!.trim();
    return fail(
      'conflict',
      `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.)"]$/.test(text) ? '' : '.'}`,
    );
  }
  if (/duplicate key value.*(frameworks_pkey|packs_pkey)/.test(error.message))
    return fail('conflict', 'This framework changed since you opened it. Open it again.');
  return fromDbError(error);
}

async function orgDetails(db: Db, orgId: string) {
  const { data, error } = await db
    .from('orgs')
    .select('name, time_zone')
    .eq('id', orgId)
    .maybeSingle();
  if (error || !data) throw new Error(`workspace: ${error?.message ?? 'not found'}`);
  return { name: data.name, timeZone: data.time_zone ?? 'Europe/London' };
}

/** The workspace's own editions of one key, newest first. */
async function editionsOf(db: Db, orgId: string, key: string): Promise<CatalogueFramework[]> {
  return (await readFrameworks(db, orgId))
    .filter((f) => f.key === key && f.orgId === orgId)
    .sort((a, b) => Number(b.version) - Number(a.version));
}

export interface PublishedEdition {
  version: string;
  revision: number;
  title: string;
  shortTitle: string;
  kind: FrameworkKind;
  source: string;
  requirements: Requirement[];
}

async function latestPublished(
  db: Db,
  orgId: string,
  key: string,
): Promise<PublishedEdition | null> {
  const [latest] = await editionsOf(db, orgId, key);
  if (!latest) return null;
  return {
    version: latest.version,
    revision: latest.revision,
    title: latest.title,
    shortTitle: latest.shortTitle,
    kind: latest.kind,
    source: latest.source,
    requirements: await readRequirements(db, key, latest.version),
  };
}

export interface OwnFrameworkEditor {
  /** The workspace's name: "Written by <workspace>", the licence note. */
  workspace: string;
  key: string | null;
  draft: FrameworkDraft | null;
  /** When the draft was last saved; null when it is the published framework, not saved as a draft yet. */
  savedAt: string | null;
  /** The latest published edition, which the draft is compared with (a revision or a new edition). */
  published: PublishedEdition | null;
  /** Catalogue frameworks whose structure can be copied. */
  catalogue: { key: string; version: string; title: string; requirements: number }[];
  /** Sheets that can hold the controls, for adopting right after publishing. */
  controlsSheets: ControlsSheet[];
}

/** What the own-framework editor needs: the draft (or the published framework as a draft) and the catalogue. */
export async function ownFrameworkEditor(input: unknown): Promise<Result<OwnFrameworkEditor>> {
  const p = ownFrameworkEditorInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      try {
        const key = p.data.key ?? null;
        if (key && !key.startsWith(ownKeyPrefix(orgId)))
          return fail('not_found', 'This framework is not in this workspace.');
        const [org, frameworks, draftRow, published, controlsSheets] = await Promise.all([
          orgDetails(supabase, orgId),
          readFrameworks(supabase, orgId),
          key
            ? supabase
                .from('framework_drafts')
                .select('body, updated_at')
                .eq('org_id', orgId)
                .eq('key', key)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          key ? latestPublished(supabase, orgId, key) : Promise.resolve(null),
          readControlsSheets(supabase, orgId),
        ]);
        if (draftRow.error) throw new Error(draftRow.error.message);
        if (key && !draftRow.data && !published)
          return fail(
            'not_found',
            'This draft no longer exists. It may have been published or deleted.',
          );
        const draft = draftRow.data
          ? (draftRow.data.body as unknown as FrameworkDraft)
          : published
            ? draftFromFramework(published)
            : null;
        return ok({
          workspace: org.name,
          key,
          draft,
          savedAt: draftRow.data?.updated_at ?? null,
          published,
          catalogue: frameworks
            .filter((f) => f.orgId === null)
            .map((f) => ({
              key: f.key,
              version: f.version,
              title: f.title,
              requirements: f.requirements,
            })),
          controlsSheets,
        });
      } catch (e) {
        console.error(
          JSON.stringify({ level: 'error', source: 'own-frameworks', error: String(e) }),
        );
        return fail('failed', 'The framework could not be loaded. Try again.');
      }
    },
    'ownFrameworkEditor',
  );
}

async function saveDraft(db: Db, orgId: string, key: string, draft: FrameworkDraft) {
  return db.rpc('save_framework_draft', {
    p_org: orgId,
    p_key: key,
    p_body: draft as unknown as Json,
  });
}

/**
 * Start a framework of the workspace's own: a new key from its name, and a draft from a pasted list, a blank grid or
 * the structure of a catalogue framework (refs, hierarchy and kinds only; never our words). Owners and admins.
 */
export async function createOwnFramework(input: unknown): Promise<Result<{ key: string }>> {
  const p = createOwnFrameworkInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId }) => {
      let body: Pick<FrameworkDraft, 'requirements' | 'mappings' | 'copiedFrom'>;
      if (v.start === 'paste') {
        if (!v.requirements?.length) return fail('invalid', 'Paste a list or choose a file first.');
        body = { requirements: v.requirements, mappings: [], copiedFrom: null };
      } else if (v.start === 'copy') {
        if (!v.copy) return fail('invalid', 'Choose the framework whose structure you copy.');
        const source = (await readFrameworks(supabase, orgId)).find(
          (f) => f.key === v.copy!.framework && f.version === v.copy!.version && f.orgId === null,
        );
        if (!source) return fail('not_found', 'This framework is no longer in the catalogue.');
        const reqs = await readRequirements(supabase, source.key, source.version);
        body = copyStructure(
          { key: source.key, version: source.version, requirements: reqs },
          { mappings: v.copy.mappings },
        );
      } else {
        body = {
          requirements: [emptyRow({ kind: 'theme' }), emptyRow()],
          mappings: [],
          copiedFrom: null,
        };
      }
      const [own, drafts] = await Promise.all([
        readFrameworks(supabase, orgId),
        supabase.from('framework_drafts').select('key').eq('org_id', orgId),
      ]);
      if (drafts.error) return fromDbError(drafts.error);
      const taken = new Set([...own.map((f) => f.key), ...(drafts.data ?? []).map((d) => d.key)]);
      const key = ownFrameworkKey(orgId, v.title, taken);
      const draft: FrameworkDraft = {
        title: v.title,
        shortTitle: v.shortTitle,
        kind: v.kind,
        ...body,
      };
      const { error } = await saveDraft(supabase, orgId, key, draft);
      if (error) return dbFail(error);
      return ok({ key });
    },
    'createOwnFramework',
  );
}

/** Save the draft as it is (problems and all): nothing changes for anyone until it is published. */
export async function saveOwnFrameworkDraft(input: unknown): Promise<Result<{ savedAt: string }>> {
  const p = saveOwnDraftInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      if (!p.data.key.startsWith(ownKeyPrefix(orgId)))
        return fail('not_found', 'This framework is not in this workspace.');
      const { data, error } = await saveDraft(supabase, orgId, p.data.key, p.data.draft);
      if (error) return dbFail(error);
      return ok({ savedAt: String(data) });
    },
    'saveOwnFrameworkDraft',
  );
}

/** Delete a draft; a published framework stays as it is. */
export async function deleteOwnFrameworkDraft(
  input: unknown,
): Promise<Result<{ deleted: boolean }>> {
  const p = deleteOwnDraftInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { data, error } = await supabase.rpc('delete_framework_draft', {
        p_org: orgId,
        p_key: p.data.key,
      });
      if (error) return dbFail(error);
      return ok({ deleted: data === true });
    },
    'deleteOwnFrameworkDraft',
  );
}

export interface PublishResult {
  key: string;
  version: string;
  revision: number;
  kind: Exclude<PublishKind, 'unchanged'>;
  title: string;
  requirements: number;
  mappings: number;
}

/**
 * Publish the draft (owners and admins): the first publish, the next revision (wording, additions: adopted libraries
 * get "Update available"), or the next edition (a ref removed, renumbered or moved: written with its edition mapping,
 * so the workspace moves with "Move to the new edition"). The person confirms the right to use the text and gives
 * its source; the licence note reads "Provided by <source>. Owned by <workspace>."
 */
export async function publishOwnFramework(input: unknown): Promise<Result<PublishResult>> {
  const p = publishOwnFrameworkInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId }) => {
      if (!v.key.startsWith(ownKeyPrefix(orgId)))
        return fail('not_found', 'This framework is not in this workspace.');
      const draft = trimDraft(v.draft as FrameworkDraft);
      const details = draftDetailProblems(draft);
      if (details.length) return fail('invalid', details[0]!);
      const problems = ownFrameworkProblems(draft.requirements);
      if (problems.length)
        return fail(
          'invalid',
          `Fix ${problems.length === 1 ? 'the problem' : `the ${problems.length} problems`} in the list first${problems[0]!.row ? `, starting with row ${problems[0]!.row}` : ''}: ${problems[0]!.message}`,
        );

      const [org, published] = await Promise.all([
        orgDetails(supabase, orgId),
        latestPublished(supabase, orgId, v.key),
      ]);
      const detailsChanged =
        !!published &&
        (published.title !== draft.title ||
          published.shortTitle !== draft.shortTitle ||
          published.kind !== draft.kind ||
          published.source !== v.source);
      const decision = publishDecision(
        published?.requirements ?? null,
        draft.requirements,
        detailsChanged,
      );
      if (decision.kind === 'unchanged')
        return fail('conflict', 'Nothing changed since the last publish.');
      if (decision.kind !== v.expect)
        return fail(
          'conflict',
          'The framework changed since you opened this dialog. Close it and publish again.',
        );
      const version =
        decision.kind === 'first'
          ? '1'
          : decision.kind === 'revision'
            ? published!.version
            : String(Number(published!.version) + 1);
      const revision = decision.kind === 'revision' ? published!.revision + 1 : 1;
      const framework = toFramework(draft, {
        key: v.key,
        version,
        revision,
        publisher: org.name,
        source: v.source,
        today: todayIn(new Date(), org.timeZone),
      });
      let manifest;
      try {
        manifest = parsePack(frameworkToPack(framework));
      } catch (e) {
        console.error(
          JSON.stringify({ level: 'error', source: 'own-frameworks', error: String(e) }),
        );
        return fail(
          'invalid',
          'The library could not be made from this list. Check the titles and text.',
        );
      }
      const groups = new Set(draft.requirements.filter(isGroup).map((r) => r.ref));
      const mappings = draft.mappings.filter(
        (m) => !groups.has(m.ref) && draft.requirements.some((r) => r.ref === m.ref),
      );
      const { data, error } = await supabase.rpc('publish_framework', {
        p_org: orgId,
        p_framework: {
          key: framework.key,
          version: framework.version,
          revision: framework.revision,
          title: framework.title,
          short_title: framework.shortTitle,
          kind: framework.kind,
          source: framework.source,
          licence: framework.licence,
          publisher: framework.publisher,
          hash: frameworkHash(framework),
          rights_confirmed: v.rightsConfirmed,
          requirements: framework.requirements.map((r) => ({
            ref: r.ref,
            parent: r.parent ?? '',
            kind: r.kind,
            title: r.title,
            text: r.text ?? '',
            guidance: r.guidance ?? '',
            questions: r.questions,
            evidence: r.evidence,
            tags: r.tags,
          })),
          ...(decision.kind === 'edition'
            ? {
                edition_mapping: editionMappingFor(
                  published!.requirements,
                  framework.requirements,
                ).pairs.map((x) => ({
                  from_ref: x.fromRef,
                  to_ref: x.toRef,
                  relation: x.relation,
                })),
              }
            : {}),
        } as unknown as Json,
        p_pack: {
          key: manifest.key,
          version: manifest.version,
          title: manifest.title,
          description: manifest.description,
          manifest: manifest as unknown as Json,
          hash: packHash(manifest),
        } as unknown as Json,
        p_mappings: mappings.map((m) => ({
          ref: m.ref,
          to: m.to,
          relation: m.relation,
          note: '',
        })) as unknown as Json,
      });
      if (error) return dbFail(error);
      const out = data as { requirements: number; mappings: number };
      return ok({
        key: framework.key,
        version: framework.version,
        revision: framework.revision,
        kind: decision.kind,
        title: framework.title,
        requirements: out.requirements,
        mappings: out.mappings,
      });
    },
    'publishOwnFramework',
  );
}

// ───────────────────────── the workspace's own cross-walks ─────────────────────────

export interface MappingOption {
  /** `<key>@<version>#<ref>` */
  key: string;
  /** "27001 A.5.1" */
  label: string;
  title: string;
  framework: string;
}

/** Every catalogue requirement a requirement of the workspace's own can be mapped to, adopted or not. */
export async function ownMappingOptions(input: unknown): Promise<Result<MappingOption[]>> {
  const p = ownMappingOptionsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      try {
        const catalogue = (await readFrameworks(supabase, orgId)).filter((f) => f.orgId === null);
        const byId = new Map(catalogue.map((f) => [`${f.key}@${f.version}`, f]));
        const rows = await fetchAllPages<{
          framework_key: string;
          framework_version: string;
          ref: string;
          title: string;
        }>((a, b) =>
          supabase
            .from('requirements')
            .select('framework_key, framework_version, ref, title')
            .is('org_id', null)
            .neq('kind', 'theme')
            .order('framework_key')
            .order('framework_version')
            .order('position')
            .range(a, b),
        );
        const order = catalogue.map((f) => `${f.key}@${f.version}`);
        return ok(
          rows
            .flatMap((r) => {
              const f = byId.get(`${r.framework_key}@${r.framework_version}`);
              return f
                ? [
                    {
                      key: requirementKey({ framework: f.key, version: f.version, ref: r.ref }),
                      label: requirementLabel(f.shortTitle, r.ref),
                      title: r.title,
                      framework: f.title,
                      order: order.indexOf(`${f.key}@${f.version}`),
                    },
                  ]
                : [];
            })
            .sort((a, b) => a.order - b.order)
            .map((o) => ({ key: o.key, label: o.label, title: o.title, framework: o.framework })),
        );
      } catch (e) {
        console.error(
          JSON.stringify({ level: 'error', source: 'own-frameworks', error: String(e) }),
        );
        return fail('failed', 'The catalogue could not be loaded. Try again.');
      }
    },
    'ownMappingOptions',
  );
}

/**
 * Map one of the workspace's own requirements to a catalogue requirement (owners and admins). The relation defaults
 * to related (docs/12: when in doubt, related). Changing it retires the old mapping and adds a new one, both logged.
 */
export async function mapOwnRequirement(input: unknown): Promise<Result<{ id: number }>> {
  const p = mapOwnRequirementInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId }) => {
      if (!v.from.startsWith(ownKeyPrefix(orgId)))
        return fail('invalid', 'Map a requirement of this workspace’s own frameworks.');
      const { data, error } = await supabase.rpc('set_crosswalk', {
        p_org: orgId,
        p_from: v.from,
        p_to: v.to,
        p_relation: v.relation as Relation,
        p_note: v.note,
      });
      if (error) return dbFail(error);
      return ok({ id: Number(data) });
    },
    'mapOwnRequirement',
  );
}

/** Remove one of the workspace's own mappings: it is retired (kept, logged), not deleted. */
export async function retireOwnMapping(input: unknown): Promise<Result<{ id: number }>> {
  const p = retireOwnMappingInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { error } = await supabase.rpc('retire_crosswalk', { p_org: orgId, p_id: p.data.id });
      if (error) return dbFail(error);
      return ok({ id: p.data.id });
    },
    'retireOwnMapping',
  );
}
