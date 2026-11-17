// The requirement catalogue on the server (docs/12): writing the repository's frameworks, requirements and cross-walks
// into the global tables (service role: the seed), and reading them back for the commands. Given a Supabase client,
// so the seed and the commands share it; no 'server-only' import.
import type { SupabaseClient } from '@supabase/supabase-js';
import { withCurrentOwner } from '@/engine/frameworks/own';
import { frameworkPackKey, frameworkPackVersion, requirementKey } from '@/engine/frameworks/refs';
import {
  EDITION_KEYS,
  type Crosswalk,
  type EditionInfo,
  type EditionStatus,
  type Framework,
  type FrameworkKind,
  type Relation,
  type Requirement,
  type RequirementKind,
} from '@/engine/frameworks/types';
import type { Database } from '@/lib/database.types';
import { packHash } from '@/lib/packs/hash';
import { fetchAllPages } from '@/lib/sheet-query';

type Db = SupabaseClient<Database>;

function must<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

/**
 * The catalogue hash of a framework: its content as shipped (frameworks.hash). The edition status is left out: it is
 * checked monthly (docs/12 Standards watch) and updated in place, without a new revision.
 */
export function frameworkHash(f: Framework): string {
  const content: Record<string, unknown> = { ...f };
  for (const k of EDITION_KEYS) delete content[k];
  return packHash(content);
}

/** The edition status columns of a framework row (0037). */
export function editionRow(e: EditionInfo) {
  return {
    status: e.status,
    superseded_by: e.supersededBy,
    transition_ends: e.transitionEnds,
    revision_stage: e.revisionStage,
    revision_expected: e.revisionExpected,
    status_note: e.statusNote,
    status_checked_on: e.statusCheckedOn,
  };
}

export function frameworkRow(f: Framework) {
  return {
    key: f.key,
    version: f.version,
    revision: f.revision,
    title: f.title,
    short_title: f.shortTitle,
    publisher: f.publisher,
    kind: f.kind,
    source: f.source,
    licence: f.licence,
    url: f.url,
    titles: f.titles,
    pack_key: frameworkPackKey(f),
    pack_version: frameworkPackVersion(f),
    hash: frameworkHash(f),
    ...editionRow(f),
  };
}

export function requirementRows(f: Framework) {
  return f.requirements.map((r) => ({
    framework_key: f.key,
    framework_version: f.version,
    ref: r.ref,
    parent_ref: r.parent,
    kind: r.kind,
    position: r.position,
    title: r.title,
    ...(r.text ? { text: r.text } : {}),
    purpose: r.purpose,
    guidance: r.guidance,
    questions: r.questions,
    evidence: r.evidence,
    tags: r.tags,
  }));
}

export function crosswalkRows(list: Crosswalk[]) {
  return list.map((c) => ({
    from_framework: c.from.framework,
    from_version: c.from.version,
    from_ref: c.from.ref,
    to_framework: c.to.framework,
    to_version: c.to.version,
    to_ref: c.to.ref,
    relation: c.relation,
    note: c.note,
    source: c.source,
  }));
}

/**
 * Write the repository's frameworks into the catalogue (service role: the seed). Run after the packs catalogue sync,
 * which writes each framework's library pack. A framework version is written once; a changed one needs a higher
 * `revision` (our titles and guidance may change, refs never go away). Cross-walks are added, never changed.
 */
export async function syncFrameworks(
  db: Db,
  frameworks: Framework[],
  crosswalks: Crosswalk[],
): Promise<{
  added: string[];
  revised: string[];
  unchanged: string[];
  /** Only the edition status changed (written in place, no new revision). */
  statusUpdated: string[];
  crosswalks: number;
}> {
  const added: string[] = [];
  const revised: string[] = [];
  const unchanged: string[] = [];
  const statusUpdated: string[] = [];
  for (const f of frameworks) {
    const row = frameworkRow(f);
    const id = `${f.key}@${f.version}`;
    const existing = must(
      await db
        .from('frameworks')
        .select(
          'hash, revision, status, superseded_by, transition_ends, revision_stage, revision_expected, status_note, status_checked_on',
        )
        .eq('key', f.key)
        .eq('version', f.version)
        .maybeSingle(),
      `framework ${id}`,
    );
    if (existing && existing.hash === row.hash) {
      const status = editionRow(f);
      const same = (Object.keys(status) as (keyof typeof status)[]).every(
        (k) => (existing[k] ?? null) === status[k],
      );
      if (same) unchanged.push(id);
      else {
        must(
          await db.from('frameworks').update(status).eq('key', f.key).eq('version', f.version),
          `framework ${id}`,
        );
        statusUpdated.push(id);
      }
      continue;
    }
    if (existing && existing.revision >= f.revision)
      throw new Error(
        `Framework ${id} changed since it was written to the catalogue. Raise its revision.`,
      );
    if (existing) {
      const stored = must(
        await db
          .from('requirements')
          .select('ref')
          .eq('framework_key', f.key)
          .eq('framework_version', f.version),
        `requirements of ${id}`,
      );
      const refs = new Set(f.requirements.map((r) => r.ref));
      const gone = (stored ?? []).filter((r) => !refs.has(r.ref)).map((r) => r.ref);
      if (gone.length)
        throw new Error(`Framework ${id} drops ${gone.join(', ')}: a reference number stays.`);
      must(
        await db.from('frameworks').update(row).eq('key', f.key).eq('version', f.version),
        `framework ${id}`,
      );
      revised.push(id);
    } else {
      must(await db.from('frameworks').insert(row), `framework ${id}`);
      added.push(id);
    }
    // parents first (the self reference), then everything: new rows are added, ours reworded
    must(
      await db.from('requirements').upsert(requirementRows(f), {
        onConflict: 'framework_key,framework_version,ref',
      }),
      `requirements of ${id}`,
    );
  }
  const rows = crosswalkRows(crosswalks);
  for (let i = 0; i < rows.length; i += 500)
    must(
      await db.from('crosswalks').upsert(rows.slice(i, i + 500), {
        // one live row per pair (0074: retired rows of a workspace's own mappings keep their timestamps)
        onConflict:
          'from_framework,from_version,from_ref,to_framework,to_version,to_ref,retired_at',
        ignoreDuplicates: true,
      }),
      'crosswalks',
    );
  return { added, revised, unchanged, statusUpdated, crosswalks: rows.length };
}

export interface CatalogueFramework extends Omit<EditionInfo, 'statusCheckedOn'> {
  /** Null for a row written before the edition status existed (0037). */
  statusCheckedOn: string | null;
  key: string;
  version: string;
  revision: number;
  title: string;
  shortTitle: string;
  publisher: string;
  kind: FrameworkKind;
  source: string;
  licence: string;
  url: string;
  packKey: string;
  packVersion: string;
  /** Requirements that become library items (not themes). */
  requirements: number;
  /** A workspace's own framework (docs/12 Your own frameworks): its workspace; null for the catalogue's. */
  orgId: string | null;
}

/** Only the catalogue and the given workspace's own rows (a person in two workspaces reads both under RLS). */
const ownerFilter = (orgId: string | undefined, column = 'org_id') =>
  orgId ? `${column}.is.null,${column}.eq.${orgId}` : null;

/**
 * The catalogue's frameworks, in a stable order (kind, then title), with their requirement counts. With `orgId`,
 * also that workspace's own frameworks (and no other workspace's); without, whatever RLS lets the person read.
 */
export async function readFrameworks(db: Db, orgId?: string): Promise<CatalogueFramework[]> {
  const owner = ownerFilter(orgId);
  let fwq = db
    .from('frameworks')
    .select(
      'key, version, revision, title, short_title, publisher, kind, source, licence, url, pack_key, pack_version, status, superseded_by, transition_ends, revision_stage, revision_expected, status_note, status_checked_on, org_id',
    );
  if (owner) fwq = fwq.or(owner);
  const [fw, reqs] = await Promise.all([
    fwq,
    fetchAllPages<{ framework_key: string; framework_version: string; kind: string }>((a, b) => {
      let q = db
        .from('requirements')
        .select('framework_key, framework_version, kind')
        .neq('kind', 'theme')
        .order('framework_key')
        .order('framework_version')
        .order('ref');
      if (owner) q = q.or(owner);
      return q.range(a, b);
    }),
  ]);
  must(fw, 'frameworks');
  // an own framework's licence note names its workspace as it is now, not as it was at publish (owner decision
  // 16 Nov 2026); a workspace the person can read is one they belong to (RLS)
  const ownOrgs = [
    ...new Set((fw.data ?? []).map((f) => f.org_id).filter((o): o is string => !!o)),
  ];
  const orgNames = new Map<string, string>();
  if (ownOrgs.length) {
    const orgs = await db.from('orgs').select('id, name').in('id', ownOrgs);
    for (const o of orgs.data ?? []) orgNames.set(o.id, o.name);
  }
  const count = new Map<string, number>();
  for (const r of reqs) {
    const k = `${r.framework_key}@${r.framework_version}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const order = ['standard', 'regulation', 'law', 'internal'];
  return (fw.data ?? [])
    .map((f) => ({
      key: f.key,
      version: f.version,
      revision: f.revision,
      title: f.title,
      shortTitle: f.short_title,
      publisher: f.publisher,
      kind: f.kind as FrameworkKind,
      source: f.source,
      licence:
        f.org_id && orgNames.has(f.org_id)
          ? withCurrentOwner(f.licence, orgNames.get(f.org_id)!)
          : f.licence,
      url: f.url ?? '',
      packKey: f.pack_key,
      packVersion: f.pack_version,
      requirements: count.get(`${f.key}@${f.version}`) ?? 0,
      status: f.status as EditionStatus,
      supersededBy: f.superseded_by,
      transitionEnds: f.transition_ends,
      revisionStage: f.revision_stage,
      revisionExpected: f.revision_expected,
      statusNote: f.status_note,
      statusCheckedOn: f.status_checked_on,
      orgId: f.org_id,
    }))
    .sort(
      (a, b) =>
        order.indexOf(a.kind) - order.indexOf(b.kind) ||
        a.key.localeCompare(b.key, 'en', { numeric: true }) ||
        b.version.localeCompare(a.version, 'en', { numeric: true }),
    );
}

type CrosswalkRow = {
  id: number;
  from_framework: string;
  from_version: string;
  from_ref: string;
  to_framework: string;
  to_version: string;
  to_ref: string;
  relation: string;
  note: string;
  source: string;
  org_id: string | null;
  created_by: string | null;
  created_at: string;
};

const CROSSWALK_COLUMNS =
  'id, from_framework, from_version, from_ref, to_framework, to_version, to_ref, relation, note, source, org_id, created_by, created_at';

/** Cross-walk rows as the engine reads them; a workspace's own carry who made them (a name) and when. */
async function toCrosswalks(db: Db, rows: CrosswalkRow[]): Promise<Crosswalk[]> {
  const people = [
    ...new Set(rows.flatMap((c) => (c.org_id && c.created_by ? [c.created_by] : []))),
  ];
  const names = new Map<string, string>();
  if (people.length) {
    const { data } = await db.from('profiles').select('id, display_name').in('id', people);
    for (const p of data ?? []) names.set(p.id, p.display_name);
  }
  return rows.map((c) => ({
    from: { framework: c.from_framework, version: c.from_version, ref: c.from_ref },
    to: { framework: c.to_framework, version: c.to_version, ref: c.to_ref },
    relation: c.relation as Relation,
    note: c.note,
    source: c.source,
    own: c.org_id
      ? {
          id: c.id,
          by: c.created_by ? (names.get(c.created_by) ?? null) : null,
          at: c.created_at,
        }
      : null,
  }));
}

/**
 * Every live cross-walk that touches one of `frameworks` (`<key>@<version>`) at both ends: the catalogue's, and with
 * `orgId` that workspace's own mappings (never another workspace's; retired ones are left out).
 */
export async function readCrosswalks(
  db: Db,
  frameworks: string[],
  orgId?: string,
): Promise<Crosswalk[]> {
  if (frameworks.length === 0) return [];
  const keys = [...new Set(frameworks.map((f) => f.split('@')[0]!))];
  const owner = ownerFilter(orgId);
  const data = await fetchAllPages<CrosswalkRow>((a, b) => {
    let q = db
      .from('crosswalks')
      .select(CROSSWALK_COLUMNS)
      .in('from_framework', keys)
      .in('to_framework', keys)
      .is('retired_at', null)
      .order('id');
    if (owner) q = q.or(owner);
    return q.range(a, b);
  });
  const wanted = new Set(frameworks);
  return toCrosswalks(
    db,
    data.filter(
      (c) =>
        wanted.has(`${c.from_framework}@${c.from_version}`) &&
        wanted.has(`${c.to_framework}@${c.to_version}`),
    ),
  );
}

/** The workspace's own live mappings from one of its requirements (docs/12 Your own frameworks), oldest first. */
export async function readOwnMappings(db: Db, orgId: string, key: string): Promise<Crosswalk[]> {
  const id = key.match(/^(.+)@([^@#]+)#(.+)$/);
  if (!id) return [];
  const { data, error } = await db
    .from('crosswalks')
    .select(CROSSWALK_COLUMNS)
    .eq('org_id', orgId)
    .is('retired_at', null)
    .eq('from_framework', id[1]!)
    .eq('from_version', id[2]!)
    .eq('from_ref', id[3]!)
    .order('id');
  if (error) throw new Error(`crosswalks: ${error.message}`);
  return toCrosswalks(db, (data ?? []) as CrosswalkRow[]);
}

/** Requirements of one framework version, in order. */
export async function readRequirements(
  db: Db,
  key: string,
  version: string,
): Promise<(Requirement & { key: string })[]> {
  const data = await fetchAllPages((a, b) =>
    db
      .from('requirements')
      .select(
        'ref, parent_ref, kind, position, title, text, purpose, guidance, questions, evidence, tags',
      )
      .eq('framework_key', key)
      .eq('framework_version', version)
      .order('position')
      .range(a, b),
  );
  return data.map((r) => ({
    key: requirementKey({ framework: key, version, ref: r.ref }),
    ref: r.ref,
    parent: r.parent_ref,
    kind: r.kind as RequirementKind,
    position: r.position,
    title: r.title,
    ...(r.text ? { text: r.text } : {}),
    purpose: r.purpose,
    guidance: r.guidance,
    questions: r.questions ?? [],
    evidence: r.evidence ?? [],
    tags: r.tags ?? [],
  }));
}
