// A workspace's own frameworks (docs/12 Your own frameworks; owner decisions of 16 Nov 2026). A workspace writes its
// own requirement set (a customer's security schedule, internal policies, a code we don't ship) as a draft, from a
// pasted or uploaded list, a blank grid, or the structure of a catalogue framework, then publishes it. Published, it is
// an ordinary framework with `titles: 'customer'`: the same library pack (frameworkToPack), adoption, SoA, coverage
// and Controls link as a catalogue framework. This file holds the rules for a draft: what a row may hold, reading a
// pasted list, copying a structure without our words, whether publishing is a new revision or a new edition, and the
// edition mapping. Pure: data in, data out.
import type { CsvTable } from '../fields/csv';
import { requirementKey } from './refs';
import {
  REQUIREMENT_KINDS,
  type Framework,
  type FrameworkKind,
  type Relation,
  type Requirement,
  type RequirementKind,
} from './types';

/** The limits of an own framework (owner decision 5, 16 Nov 2026; title, ref and list limits as the catalogue's). */
export const OWN_LIMITS = {
  /** Requirements that become library items (groups are not counted). */
  requirements: 2000,
  /** Levels below a group: a group plus at most 4 levels. */
  levels: 4,
  title: 80,
  text: 4000,
  ref: 40,
  guidance: 2000,
  questions: 8,
  question: 200,
  evidence: 10,
  evidenceItem: 160,
  tags: 10,
  frameworkTitle: 120,
  shortTitle: 12,
  /** The source line asked for when publishing. */
  source: 300,
  note: 300,
  /** The slug part of a key: `w<8 hex>-<slug>` fits the 40 characters of a framework key. */
  slug: 29,
} as const;

/** One row of a draft, as the grid edits it. Empty strings mean "none". */
export interface DraftRequirement {
  ref: string;
  /** The ref of the row it sits under; '' for a group. */
  parent: string;
  /** clause, control, article, paragraph or theme (a group); checked by ownFrameworkProblems. */
  kind: string;
  /** Short title, at most 80 characters. */
  title: string;
  /** The full wording, at most 4,000 characters. */
  text: string;
  guidance: string;
  questions: string[];
  evidence: string[];
  tags: string[];
}

/** A cross-walk the draft brings to a catalogue requirement (copying a structure), reviewed before publishing. */
export interface DraftMapping {
  /** The draft row's ref. */
  ref: string;
  /** The catalogue requirement, `<key>@<version>#<ref>`. */
  to: string;
  relation: Relation;
}

export interface FrameworkDraft {
  title: string;
  /** Used in chips: "ACME 4.2". */
  shortTitle: string;
  kind: FrameworkKind;
  requirements: DraftRequirement[];
  mappings: DraftMapping[];
  /** The catalogue framework whose structure was copied, `<key>@<version>`; null otherwise. */
  copiedFrom: string | null;
}

export type DraftColumn =
  'ref' | 'parent' | 'kind' | 'title' | 'text' | 'guidance' | 'questions' | 'evidence' | 'tags';

export interface DraftProblem {
  /** 1-based row of the draft (as the grid numbers it); null for the list as a whole. */
  row: number | null;
  ref: string | null;
  column: DraftColumn | null;
  message: string;
}

export const emptyRow = (over: Partial<DraftRequirement> = {}): DraftRequirement => ({
  ref: '',
  parent: '',
  kind: 'clause',
  title: '',
  text: '',
  guidance: '',
  questions: [],
  evidence: [],
  tags: [],
  ...over,
});

export const isGroup = (r: Pick<DraftRequirement, 'kind'>) => r.kind === 'theme';

const KINDS = new Set<string>(REQUIREMENT_KINDS);
const TAG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const n = (x: number) => x.toLocaleString('en-GB');

/**
 * Every problem of a draft's rows, in row order, then the list's own. A draft with problems can be saved but not
 * published. Rows are numbered from 1 as the grid shows them.
 */
export function ownFrameworkProblems(rows: readonly DraftRequirement[]): DraftProblem[] {
  const out: DraftProblem[] = [];
  const firstRow = new Map<string, number>();
  rows.forEach((r, i) => {
    const ref = r.ref.trim();
    if (ref && !firstRow.has(ref)) firstRow.set(ref, i);
  });
  const byRef = new Map(rows.map((r) => [r.ref.trim(), r] as const));

  // levels below the group: null when a chain loops or never reaches a group
  const depth = new Map<string, number | null>();
  const depthOf = (start: DraftRequirement): number | null => {
    const seen = new Set<string>();
    let cur: DraftRequirement | undefined = start;
    let d = 0;
    while (cur) {
      const ref = cur.ref.trim();
      if (depth.has(ref)) {
        const known = depth.get(ref)!;
        return known === null ? null : known + d;
      }
      if (seen.has(ref)) return null;
      seen.add(ref);
      if (!cur.parent.trim()) return isGroup(cur) ? d : null;
      cur = byRef.get(cur.parent.trim());
      d += 1;
    }
    return null;
  };

  rows.forEach((r, i) => {
    const row = i + 1;
    const ref = r.ref.trim();
    const parent = r.parent.trim();
    const p = (column: DraftColumn | null, message: string) =>
      out.push({ row, ref: ref || null, column, message });

    if (!ref) p('ref', 'Give a ref.');
    else {
      if (ref.length > OWN_LIMITS.ref) p('ref', `A ref has at most ${OWN_LIMITS.ref} characters.`);
      if (/[#@]/.test(ref)) p('ref', 'A ref cannot hold "#" or "@".');
      const first = firstRow.get(ref)!;
      if (first !== i) p('ref', `The ref "${ref}" is used on row ${first + 1} too.`);
    }
    if (!KINDS.has(r.kind))
      p('kind', 'The kind is clause, control, article, paragraph or theme (a group).');
    if (!r.title.trim()) p('title', 'Write a title.');
    else if (r.title.trim().length > OWN_LIMITS.title)
      p('title', 'Shorten the title; put the full wording in Text.');
    if (r.text.length > OWN_LIMITS.text)
      p('text', `The text has at most ${n(OWN_LIMITS.text)} characters.`);
    if (isGroup(r) && r.text.trim()) p('text', 'A group has no text: put it on a requirement.');

    if (isGroup(r)) {
      if (parent) p('parent', 'A group has no parent.');
    } else if (!parent) p('parent', 'Give a parent or put the row in a group.');
    else if (parent === ref) p('parent', 'A row cannot be its own parent.');
    else if (!byRef.has(parent)) p('parent', `There is no row with the ref "${parent}".`);
    else if (ref && firstRow.get(ref) === i) {
      const d = depthOf(r);
      depth.set(ref, d);
      if (d === null) p('parent', 'The parents go round in a circle and never reach a group.');
      else if (d > OWN_LIMITS.levels)
        p('parent', `Too deep: a group and at most ${OWN_LIMITS.levels} levels below it.`);
    }

    if (r.guidance.length > OWN_LIMITS.guidance)
      p('guidance', `Guidance has at most ${n(OWN_LIMITS.guidance)} characters.`);
    if (
      r.questions.length > OWN_LIMITS.questions ||
      r.questions.some((q) => q.length > OWN_LIMITS.question)
    )
      p(
        'questions',
        `At most ${OWN_LIMITS.questions} audit questions of at most ${OWN_LIMITS.question} characters.`,
      );
    if (
      r.evidence.length > OWN_LIMITS.evidence ||
      r.evidence.some((q) => q.length > OWN_LIMITS.evidenceItem)
    )
      p(
        'evidence',
        `At most ${OWN_LIMITS.evidence} evidence lines of at most ${OWN_LIMITS.evidenceItem} characters.`,
      );
    if (r.tags.length > OWN_LIMITS.tags || r.tags.some((t) => !TAG.test(t)))
      p(
        'tags',
        `At most ${OWN_LIMITS.tags} tags of lower-case letters, digits and "-" (40 characters each).`,
      );
  });

  const items = rows.filter((r) => !isGroup(r)).length;
  if (items === 0)
    out.push({ row: null, ref: null, column: null, message: 'Add at least one requirement.' });
  if (items > OWN_LIMITS.requirements)
    out.push({
      row: null,
      ref: null,
      column: null,
      message: `At most ${n(OWN_LIMITS.requirements)} requirements: this list has ${n(items)}.`,
    });
  if (rows.length > OWN_LIMITS.requirements * 2)
    out.push({
      row: null,
      ref: null,
      column: null,
      message: `At most ${n(OWN_LIMITS.requirements * 2)} rows, groups included.`,
    });
  return out;
}

// ───────────────────────── reading a pasted or uploaded list ─────────────────────────

/** The columns a pasted list or CSV may have (the first row names them; case and spaces do not matter). */
export const IMPORT_COLUMNS = [
  'ref',
  'title',
  'text',
  'parent',
  'group',
  'guidance',
  'evidence',
  'questions',
  'kind',
  'tags',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/** The group rows without a group or a parent go in, when the list names no group at all. */
export const DEFAULT_GROUP = 'Requirements';

export interface ImportResult {
  rows: DraftRequirement[];
  /** Columns that were not read (named in the first row but not one of IMPORT_COLUMNS). */
  ignored: string[];
  /** Why nothing could be read; empty when rows were read. */
  problems: string[];
  /** How many group rows were made from the group column. */
  groupsMade: number;
}

/** One cell as a list: one entry per line or `;`. */
const listOf = (cell: string) =>
  cell
    .split(/\r?\n|;/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Tags as lower-case words with "-": "Access control" → "access-control". */
const tagsOf = (cell: string) =>
  cell
    .split(/[,;\n]/)
    .map((t) =>
      t
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean);

/**
 * Read a pasted list (tab-separated, from Excel) or a CSV file, already split by parseCsv: the first row names the
 * columns, ref and title are needed. A row's `group` (when it has no parent) becomes a group row of that name, made
 * once and placed before the first row in it; rows with neither go in one group, DEFAULT_GROUP. Values are kept as
 * written (trimmed) so ownFrameworkProblems can point at them; nothing is shortened.
 */
export function importRequirements(table: CsvTable): ImportResult {
  const idx = new Map<ImportColumn, number>();
  const ignored: string[] = [];
  table.header.forEach((h, i) => {
    const name = h.trim().toLowerCase().replace(/\s+/g, ' ') as ImportColumn;
    if ((IMPORT_COLUMNS as readonly string[]).includes(name) && !idx.has(name)) idx.set(name, i);
    else if (h.trim()) ignored.push(h.trim());
  });
  const missing = (['ref', 'title'] as const).filter((c) => !idx.has(c));
  if (missing.length)
    return {
      rows: [],
      ignored,
      groupsMade: 0,
      problems: [
        `The first row names the columns. Add ${missing.map((m) => `"${m}"`).join(' and ')}: ${IMPORT_COLUMNS.join(', ')}.`,
      ],
    };
  const cell = (r: string[], c: ImportColumn) => {
    const i = idx.get(c);
    return i === undefined ? '' : (r[i] ?? '').trim();
  };

  const out: DraftRequirement[] = [];
  const groups = new Map<string, true>();
  const refs = new Set(table.rows.map((r) => cell(r, 'ref')).filter(Boolean));
  const anyGroup = table.rows.some(
    (r) => cell(r, 'group') || cell(r, 'kind').toLowerCase() === 'theme',
  );
  let groupsMade = 0;
  const groupRow = (name: string) => {
    if (groups.has(name) || refs.has(name)) return;
    groups.set(name, true);
    out.push(emptyRow({ ref: name, kind: 'theme', title: name }));
    groupsMade += 1;
  };

  for (const r of table.rows) {
    const kind = cell(r, 'kind').toLowerCase() || 'clause';
    const row = emptyRow({
      ref: cell(r, 'ref'),
      parent: cell(r, 'parent'),
      kind,
      title: cell(r, 'title'),
      text: cell(r, 'text'),
      guidance: cell(r, 'guidance'),
      questions: listOf(cell(r, 'questions')),
      evidence: listOf(cell(r, 'evidence')),
      tags: tagsOf(cell(r, 'tags')),
    });
    if (!isGroup(row) && !row.parent) {
      const g = cell(r, 'group') || (anyGroup ? '' : DEFAULT_GROUP);
      if (g) {
        groupRow(g);
        row.parent = g;
      }
    }
    out.push(row);
  }
  return {
    rows: out,
    ignored,
    groupsMade,
    problems: out.length ? [] : ['The list has a first row but no requirements under it.'],
  };
}

// ───────────────────────── copying a catalogue framework's structure ─────────────────────────

/**
 * The structure of a catalogue framework as a draft: refs, hierarchy and kinds only. Titles start empty (the person
 * writes them before publishing); our purpose, guidance, questions, evidence and tags are never copied. With
 * `mappings`, every requirement maps to the one it was copied from (equivalent), for the person to review.
 */
export function copyStructure(
  f: Pick<Framework, 'key' | 'version'> & { requirements: readonly Requirement[] },
  opts: { mappings: boolean },
): Pick<FrameworkDraft, 'requirements' | 'mappings' | 'copiedFrom'> {
  const rows = [...f.requirements]
    .sort((a, b) => a.position - b.position)
    .map((r) => emptyRow({ ref: r.ref, parent: r.parent ?? '', kind: r.kind }));
  const mappings: DraftMapping[] = opts.mappings
    ? rows
        .filter((r) => !isGroup(r))
        .map((r) => ({
          ref: r.ref,
          to: requirementKey({ framework: f.key, version: f.version, ref: r.ref }),
          relation: 'equivalent' as const,
        }))
    : [];
  return { requirements: rows, mappings, copiedFrom: `${f.key}@${f.version}` };
}

/** A published framework as a draft, to change it (the next revision, or edition when a ref goes). */
export function draftFromFramework(
  f: Pick<Framework, 'title' | 'shortTitle' | 'kind'> & { requirements: readonly Requirement[] },
): FrameworkDraft {
  return {
    title: f.title,
    shortTitle: f.shortTitle,
    kind: f.kind,
    copiedFrom: null,
    mappings: [],
    requirements: [...f.requirements]
      .sort((a, b) => a.position - b.position)
      .map((r) =>
        emptyRow({
          ref: r.ref,
          parent: r.parent ?? '',
          kind: r.kind,
          title: r.title,
          text: r.text ?? '',
          guidance: r.guidance ?? '',
          questions: [...r.questions],
          evidence: [...r.evidence],
          tags: [...r.tags],
        }),
      ),
  };
}

// ───────────────────────── publishing: revision or edition ─────────────────────────

export type PublishKind = 'first' | 'revision' | 'edition' | 'unchanged';

export interface PublishDecision {
  kind: PublishKind;
  /** Refs of the published edition the draft no longer has. */
  removed: string[];
  /** Refs whose parent or kind changed (renumbered or moved): like removing and adding. */
  moved: string[];
  added: string[];
  /** Refs whose title, text, guidance, questions, evidence, tags or place in the list changed. */
  reworded: string[];
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * What publishing the draft is (owner decision 2, 16 Nov 2026): the first publish; a new revision of the latest
 * edition (wording changed, requirements added, or the framework's own details changed: it reaches adopted libraries
 * through the upgrade path); a new edition (a ref removed, renumbered or moved: the workspace moves with
 * move_framework_edition); or nothing to publish.
 */
export function publishDecision(
  published: readonly Requirement[] | null,
  draft: readonly DraftRequirement[],
  detailsChanged = false,
): PublishDecision {
  if (!published)
    return {
      kind: 'first',
      removed: [],
      moved: [],
      added: draft.map((r) => r.ref.trim()),
      reworded: [],
    };
  const now = new Map(draft.map((r, i) => [r.ref.trim(), { r, i }] as const));
  const removed: string[] = [];
  const moved: string[] = [];
  const reworded: string[] = [];
  const order = [...published].sort((a, b) => a.position - b.position);
  order.forEach((p, i) => {
    const d = now.get(p.ref);
    if (!d) return removed.push(p.ref);
    if ((p.parent ?? '') !== d.r.parent.trim() || p.kind !== d.r.kind) return moved.push(p.ref);
    if (
      p.title !== d.r.title.trim() ||
      (p.text ?? '') !== d.r.text.trim() ||
      (p.guidance ?? '') !== d.r.guidance.trim() ||
      !same(p.questions, d.r.questions) ||
      !same(p.evidence, d.r.evidence) ||
      !same(p.tags, d.r.tags) ||
      i !== d.i
    )
      reworded.push(p.ref);
  });
  const had = new Set(published.map((p) => p.ref));
  const added = draft.map((r) => r.ref.trim()).filter((r) => !had.has(r));
  const kind: PublishKind =
    removed.length || moved.length
      ? 'edition'
      : added.length || reworded.length || detailsChanged
        ? 'revision'
        : 'unchanged';
  return { kind, removed, moved, added, reworded };
}

export interface EditionMapping {
  /** Old edition ref → new edition ref, written as cross-walks between the two editions. */
  pairs: { fromRef: string; toRef: string; relation: Relation }[];
  /** Requirements with no counterpart: new in this edition, or gone from it. The move lists them for review. */
  review: { ref: string; reason: 'new' | 'removed' }[];
}

/**
 * The edition mapping from the previous edition to the next (docs/12 Moving to a new edition): the same ref with the
 * same wording (title and text) is equivalent, so the move copies its answers; the same ref reworded or moved is
 * partial; everything else is listed for review. Groups are not mapped (they are not library items).
 */
export function editionMappingFor(
  old: readonly Pick<Requirement, 'ref' | 'parent' | 'kind' | 'title' | 'text'>[],
  next: readonly Pick<Requirement, 'ref' | 'parent' | 'kind' | 'title' | 'text'>[],
): EditionMapping {
  const items = <T extends { kind: string }>(list: readonly T[]) =>
    list.filter((r) => r.kind !== 'theme');
  const nextBy = new Map(items(next).map((r) => [r.ref, r]));
  const oldRefs = new Set(items(old).map((r) => r.ref));
  const pairs: EditionMapping['pairs'] = [];
  const review: EditionMapping['review'] = [];
  for (const o of items(old)) {
    const x = nextBy.get(o.ref);
    if (!x) {
      review.push({ ref: o.ref, reason: 'removed' });
      continue;
    }
    const unchanged =
      o.title === x.title &&
      (o.text ?? '') === (x.text ?? '') &&
      (o.parent ?? null) === (x.parent ?? null) &&
      o.kind === x.kind;
    pairs.push({ fromRef: o.ref, toRef: x.ref, relation: unchanged ? 'equivalent' : 'partial' });
  }
  for (const x of items(next)) if (!oldRefs.has(x.ref)) review.push({ ref: x.ref, reason: 'new' });
  return { pairs, review };
}

// ───────────────────────── keys and the framework a draft publishes ─────────────────────────

/** The reserved key prefix of a workspace's own frameworks: `w` and the first 8 hex digits of its id. */
export const ownKeyPrefix = (orgId: string) =>
  `w${orgId.replace(/-/g, '').slice(0, 8).toLowerCase()}-`;

/** A workspace's own framework (or its library pack): the reserved key form `w<8 hex>-…`. */
export const isOwnFrameworkKey = (key: string) => /^(framework-)?w[0-9a-f]{8}-/.test(key);

/** A new key for a workspace's framework titled `title`, not one of `taken`. */
export function ownFrameworkKey(orgId: string, title: string, taken: ReadonlySet<string>): string {
  const base =
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, OWN_LIMITS.slug)
      .replace(/-+$/, '') || 'framework';
  const prefix = ownKeyPrefix(orgId);
  for (let i = 1; ; i += 1) {
    const tail = i === 1 ? '' : `-${i}`;
    const key = `${prefix}${base.slice(0, OWN_LIMITS.slug - tail.length).replace(/-+$/, '')}${tail}`;
    if (!taken.has(key)) return key;
  }
}

/** An ID prefix for the library's items from the short title: "ACME" → "ACME-". */
export function ownIdPrefix(shortTitle: string): string {
  const letters = shortTitle
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5);
  return `${letters || 'REQ'}-`;
}

export interface OwnFrameworkMeta {
  key: string;
  /** The edition, "1", "2". */
  version: string;
  revision: number;
  /** The workspace's name. */
  publisher: string;
  /** The source line the person gave when publishing. */
  source: string;
  /** Today in the workspace's time zone (ISO date): when the edition status was set. */
  today: string;
}

/**
 * The library sheet's name: the title plus "requirements", unless the title already ends in "requirement(s)" (owner
 * decision 17 Nov 2026: "Acme customer quality requirements" stays as it is), with the edition after the first.
 */
export function libraryName(title: string, edition: number): string {
  const t = title.trim();
  const ed = edition > 1 ? ` (edition ${edition})` : '';
  return /\brequirements?$/i.test(t) ? `${t}${ed}` : `${t}${ed} requirements`;
}

/** The licence note of a workspace's own framework (shown on the library, the item panel and the SoA). */
export const ownLicence = (source: string, workspace: string) =>
  `Provided by ${source}. Owned by ${workspace}.`;

/**
 * The licence note of an own framework with the workspace's current name (owner decision 16 Nov 2026): the stored note
 * names the workspace as it was at publish time, so a renamed workspace is shown by its name now. Any other note is
 * returned as it is.
 */
export function withCurrentOwner(licence: string, workspace: string): string {
  const m = /^(Provided by [\s\S]*\.) Owned by [\s\S]*\.$/.exec(licence);
  return m ? `${m[1]} Owned by ${workspace}.` : licence;
}

/**
 * The framework a draft publishes, as frameworkToPack and frameworkHash read it: `titles: 'customer'`, the licence
 * note naming the source and the workspace, a statement of applicability over every requirement, and its own pack
 * key for a later edition (so editions are adopted side by side).
 */
export function toFramework(draft: FrameworkDraft, meta: OwnFrameworkMeta): Framework {
  const title = draft.title.trim();
  const edition = Number.parseInt(meta.version, 10);
  return {
    key: meta.key,
    version: meta.version,
    revision: meta.revision,
    title,
    shortTitle: draft.shortTitle.trim(),
    publisher: meta.publisher,
    kind: draft.kind,
    source: meta.source.trim(),
    licence: ownLicence(meta.source.trim(), meta.publisher),
    url: '',
    titles: 'customer',
    library: {
      name: libraryName(title, edition).slice(0, 120),
      itemLabel: 'Requirement',
      idPrefix: ownIdPrefix(draft.shortTitle),
      folder: 'Frameworks',
      ...(edition > 1 ? { packKey: `framework-${meta.key}-${meta.version}` } : {}),
      soa: { name: 'Statement of applicability', refStartsWith: '' },
    },
    status: 'current',
    supersededBy: null,
    transitionEnds: null,
    revisionStage: null,
    revisionExpected: null,
    statusNote: null,
    statusCheckedOn: meta.today,
    requirements: draft.requirements.map((r, position) => ({
      ref: r.ref.trim(),
      parent: r.parent.trim() || null,
      kind: r.kind as RequirementKind,
      position,
      title: r.title.trim(),
      text: r.text.trim() || null,
      purpose: null,
      guidance: r.guidance.trim() || null,
      questions: r.questions.map((q) => q.trim()).filter(Boolean),
      evidence: r.evidence.map((q) => q.trim()).filter(Boolean),
      tags: [...r.tags],
    })),
  };
}

/** The draft's rows with surrounding spaces trimmed (what is saved and published). */
export function trimDraft(draft: FrameworkDraft): FrameworkDraft {
  return {
    ...draft,
    title: draft.title.trim(),
    shortTitle: draft.shortTitle.trim(),
    requirements: draft.requirements.map((r) => ({
      ...r,
      ref: r.ref.trim(),
      parent: r.parent.trim(),
      kind: r.kind.trim(),
      title: r.title.trim(),
      text: r.text.trim(),
      guidance: r.guidance.trim(),
    })),
    mappings: draft.mappings.filter((m) => draft.requirements.some((r) => r.ref.trim() === m.ref)),
  };
}

/** Problems with the framework's own details (title, short title). */
export function draftDetailProblems(draft: Pick<FrameworkDraft, 'title' | 'shortTitle'>): string[] {
  const out: string[] = [];
  if (!draft.title.trim()) out.push('Give the framework a name.');
  else if (draft.title.trim().length > OWN_LIMITS.frameworkTitle)
    out.push(`The name has at most ${OWN_LIMITS.frameworkTitle} characters.`);
  if (!draft.shortTitle.trim()) out.push('Give a short name for chips, like "ACME".');
  else if (draft.shortTitle.trim().length > OWN_LIMITS.shortTitle)
    out.push(`The short name has at most ${OWN_LIMITS.shortTitle} characters.`);
  return out;
}

/** A short name from a framework name: its first word, up to 12 characters. */
export const shortTitleFor = (title: string) =>
  (title.trim().split(/\s+/)[0] ?? '').slice(0, OWN_LIMITS.shortTitle);
