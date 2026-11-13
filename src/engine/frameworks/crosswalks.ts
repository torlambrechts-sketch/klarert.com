// Cross-walks (docs/12): how requirements of different frameworks relate, and what that means in a workspace: on a
// requirement, the requirements of the other ADOPTED frameworks it also satisfies; on a control, the equivalents of
// the requirements it covers that it is not linked to yet. A cross-walk works both ways. Pure.
import { parseRequirementKey, requirementKey } from './refs';
import { RELATIONS, type Crosswalk, type Relation, type RequirementId } from './types';

/** A cross-walk file: n-way sets (expanded into pairs) and single pairs, all named by requirement key. */
export interface CrosswalkFile {
  source: string;
  sets: { relation: Relation; note?: string; members: string[]; partial?: string[] }[];
  pairs: { from: string; to: string; relation: Relation; note?: string }[];
}

const rank = (r: Relation) => RELATIONS.indexOf(r);
/** The weaker of two relations. */
export const weaker = (a: Relation, b: Relation): Relation => (rank(a) >= rank(b) ? a : b);
/** The stronger of two relations. */
export const stronger = (a: Relation, b: Relation): Relation => (rank(a) <= rank(b) ? a : b);

function id(key: string): RequirementId {
  const r = parseRequirementKey(key);
  if (!r) throw new Error(`"${key}" is not a requirement key.`);
  return r;
}

/**
 * Every set as one cross-walk per pair of members (in the order listed: the earlier member is `from`), then the
 * pairs. A pair is only as strong as its weaker member: a member listed under `partial` makes its pairs partial.
 */
export function expandCrosswalks(file: CrosswalkFile): Crosswalk[] {
  const out: Crosswalk[] = [];
  for (const set of file.sets) {
    const partial = new Set(set.partial ?? []);
    const own = (k: string): Relation =>
      partial.has(k) ? weaker(set.relation, 'partial') : set.relation;
    set.members.forEach((a, i) => {
      for (const b of set.members.slice(i + 1))
        out.push({
          from: id(a),
          to: id(b),
          relation: weaker(own(a), own(b)),
          note: set.note ?? '',
          source: file.source,
        });
    });
  }
  for (const p of file.pairs)
    out.push({
      from: id(p.from),
      to: id(p.to),
      relation: p.relation,
      note: p.note ?? '',
      source: file.source,
    });
  return out;
}

export interface CrosswalkLink {
  /** The requirement on the other end. */
  key: string;
  relation: Relation;
  note: string;
  source: string;
}

/** Both directions of every cross-walk, by requirement key; a pair named twice keeps its stronger relation. */
export function crosswalkIndex(list: readonly Crosswalk[]): Map<string, CrosswalkLink[]> {
  const index = new Map<string, Map<string, CrosswalkLink>>();
  const add = (a: string, b: string, c: Crosswalk) => {
    const m = index.get(a) ?? new Map<string, CrosswalkLink>();
    const cur = m.get(b);
    m.set(b, {
      key: b,
      relation: cur ? stronger(cur.relation, c.relation) : c.relation,
      note: cur?.note || c.note,
      source: c.source,
    });
    index.set(a, m);
  };
  for (const c of list) {
    const a = requirementKey(c.from);
    const b = requirementKey(c.to);
    if (a === b) continue;
    add(a, b, c);
    add(b, a, c);
  }
  return new Map([...index].map(([k, m]) => [k, [...m.values()]]));
}

/** A requirement of an adopted framework as the workspace holds it: a library item. */
export interface AdoptedRequirement {
  key: string;
  itemId: string;
  sheetId: string;
  displayId: string;
  /** The item's name (our title, or the workspace's rename). */
  name: string;
  /** "27001 A.5.1" */
  label: string;
  /** Framework order, then the requirement's position. */
  order: number;
}

export interface AlsoSatisfies {
  requirement: AdoptedRequirement;
  relation: Relation;
  note: string;
  source: string;
}

const byStrengthThenOrder = (a: AlsoSatisfies, b: AlsoSatisfies) =>
  rank(a.relation) - rank(b.relation) || a.requirement.order - b.requirement.order;

/**
 * "Also satisfies": the requirements of other adopted frameworks this one maps to, strongest first. Requirements of
 * frameworks the workspace has not adopted are left out (there is nothing to link to).
 */
export function alsoSatisfies(
  key: string,
  index: ReadonlyMap<string, readonly CrosswalkLink[]>,
  adopted: ReadonlyMap<string, AdoptedRequirement>,
): AlsoSatisfies[] {
  const out: AlsoSatisfies[] = [];
  for (const l of index.get(key) ?? []) {
    const r = adopted.get(l.key);
    if (r) out.push({ requirement: r, relation: l.relation, note: l.note, source: l.source });
  }
  return out.sort(byStrengthThenOrder);
}

export interface Suggestion extends AlsoSatisfies {
  /** The linked requirements (keys) that lead here. */
  via: string[];
}

/**
 * "Suggest equivalents" for a control linked to `linked` requirements: the adopted requirements they map to with one
 * of `relations` (default equivalent and partial; related is too loose to suggest) that the control is not linked to
 * yet. A requirement reached from several linked ones keeps the strongest relation and lists every one it came from.
 */
export function suggestEquivalents(
  linked: readonly string[],
  index: ReadonlyMap<string, readonly CrosswalkLink[]>,
  adopted: ReadonlyMap<string, AdoptedRequirement>,
  relations: readonly Relation[] = ['equivalent', 'partial'],
): Suggestion[] {
  const have = new Set(linked);
  const out = new Map<string, Suggestion>();
  for (const k of linked)
    for (const a of alsoSatisfies(k, index, adopted)) {
      if (have.has(a.requirement.key) || !relations.includes(a.relation)) continue;
      const cur = out.get(a.requirement.key);
      if (!cur) out.set(a.requirement.key, { ...a, via: [k] });
      else
        out.set(a.requirement.key, {
          ...cur,
          relation: stronger(cur.relation, a.relation),
          via: [...cur.via, k],
        });
    }
  return [...out.values()].sort(byStrengthThenOrder);
}
