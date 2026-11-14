// Moving an adopted library to a new edition of its standard (docs/12 Moving to a new edition). The new edition is
// adopted alongside as its own library; this plans what to carry over from the old one through the edition mapping
// (the cross-walks between the two versions): where a new requirement is the same as exactly one old requirement
// (relation equivalent, one to one), the workspace's answers (applicability, justification, implementation status,
// owner, last reviewed) and the links to its controls are copied, but never over a value the new item already has.
// Everything else is listed for review with the reason. Nothing is written here. Pure.
import type { Field, Item, Json } from '../types';
import type { LinkRow } from './library';
import { LIBRARY_KEYS } from './pack';
import { parseRequirementKey } from './refs';
import type { Crosswalk, Relation } from './types';

/** The workspace's own answers on a requirement, carried to the new edition when it is the same requirement. */
export const CARRIED_KEYS = [
  LIBRARY_KEYS.applicable,
  LIBRARY_KEYS.justification,
  LIBRARY_KEYS.status,
  LIBRARY_KEYS.owner,
  LIBRARY_KEYS.lastReviewed,
] as const;

export interface EditionLibrary {
  sheetId: string;
  framework: { key: string; version: string };
  fields: Field[];
  items: Item[];
}

export type ReviewReason = 'new' | 'partial' | 'related' | 'merged' | 'split' | 'kept';

export const REVIEW_REASON_TEXT: Record<ReviewReason, string> = {
  new: 'New in this edition: decide applicability and status.',
  partial: 'Changed in this edition: check the answer still holds.',
  related: 'Only related to the old edition: decide afresh.',
  merged: 'Merges several old requirements: combine their answers.',
  split: 'Part of an old requirement that was split: check each part.',
  kept: 'Already answered in the new library: nothing copied.',
};

export interface EditionCopy {
  fromItemId: string;
  toItemId: string;
  fromRef: string;
  toRef: string;
  /** New library field id → value, only fields the new item has empty. */
  patch: Record<string, Json>;
}

export interface EditionReview {
  toItemId: string;
  toRef: string;
  toName: string;
  reason: ReviewReason;
  /** Old refs it maps from, with the relation. */
  from: { ref: string; relation: Relation }[];
}

export interface EditionMovePlan {
  copies: EditionCopy[];
  /** Links to add: the old item's links to items outside the old library, repeated on the new item. */
  links: LinkRow[];
  review: EditionReview[];
  /** Old requirements with evidence files: files stay on the old item (never duplicated). */
  evidenceStays: string[];
}

const isEmpty = (v: Json | undefined) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

const refOf = (it: Item) =>
  it.requirementRef ? parseRequirementKey(it.requirementRef)?.ref : null;

/** Option ids a field offers (status and applicability store option ids). */
function optionIds(f: Field): Set<string> | null {
  const options = (f.config as { options?: { id: string }[] } | null)?.options;
  return Array.isArray(options) ? new Set(options.map((o) => o.id)) : null;
}

/** A value of `from` fits `to` (same type; an option id the new field still offers). */
function fits(v: Json, from: Field, to: Field): boolean {
  if (from.type !== to.type) return false;
  const ids = optionIds(to);
  if (!ids) return true;
  const list = Array.isArray(v) ? v : [v];
  return list.every((x) => typeof x !== 'string' || ids.has(x));
}

/**
 * Plan the move. `crosswalks` may hold any cross-walks; only those between the two editions count. `links` are the
 * links touching the old library's items; `linkFields` the fields they run through (to know where they point).
 */
export function planEditionMove(input: {
  from: EditionLibrary;
  to: EditionLibrary;
  crosswalks: Crosswalk[];
  links: LinkRow[];
  linkFields: Field[];
  /** Old item id → number of current evidence files. */
  evidence?: ReadonlyMap<string, number>;
}): EditionMovePlan {
  const { from, to } = input;
  const fromFw = `${from.framework.key}@${from.framework.version}`;
  const toFw = `${to.framework.key}@${to.framework.version}`;
  const mapping = input.crosswalks.flatMap((c) => {
    const a = `${c.from.framework}@${c.from.version}`;
    const b = `${c.to.framework}@${c.to.version}`;
    if (a === fromFw && b === toFw)
      return [{ old: c.from.ref, now: c.to.ref, relation: c.relation }];
    if (a === toFw && b === fromFw)
      return [{ old: c.to.ref, now: c.from.ref, relation: c.relation }];
    return [];
  });
  const oldItems = new Map(
    from.items
      .filter((i) => !i.archivedAt)
      .flatMap((i) => {
        const r = refOf(i);
        return r ? [[r, i] as const] : [];
      }),
  );
  const oldFields = new Map(from.fields.map((f) => [f.key, f]));
  const newFields = new Map(to.fields.map((f) => [f.key, f]));
  const newFieldById = new Map(to.fields.map((f) => [f.id, f]));
  const oldFieldById = new Map(from.fields.map((f) => [f.id, f]));
  const linkFieldById = new Map(input.linkFields.map((f) => [f.id, f]));
  const oldIds = new Set(from.items.map((i) => i.id));

  const copies: EditionCopy[] = [];
  const review: EditionReview[] = [];
  const links: LinkRow[] = [];
  const seenLinks = new Set<string>();
  const addLink = (l: LinkRow) => {
    const k = `${l.fieldId}|${l.from}|${l.to}`;
    if (seenLinks.has(k)) return;
    seenLinks.add(k);
    links.push(l);
  };

  for (const item of to.items) {
    if (item.archivedAt) continue;
    const ref = refOf(item);
    if (!ref) continue;
    const sources = mapping.filter((m) => m.now === ref);
    const fromList = sources.map((s) => ({ ref: s.old, relation: s.relation }));
    const flag = (reason: ReviewReason) =>
      review.push({ toItemId: item.id, toRef: ref, toName: item.name, reason, from: fromList });
    if (sources.length === 0) {
      flag('new');
      continue;
    }
    if (sources.length > 1) {
      flag('merged');
      continue;
    }
    const src = sources[0]!;
    if (src.relation !== 'equivalent') {
      const fanOut = mapping.filter((m) => m.old === src.old).length > 1;
      flag(fanOut ? 'split' : src.relation === 'partial' ? 'partial' : 'related');
      continue;
    }
    if (mapping.filter((m) => m.old === src.old).length > 1) {
      flag('split');
      continue;
    }
    const old = oldItems.get(src.old);
    if (!old) {
      flag('new');
      continue;
    }

    const patch: Record<string, Json> = {};
    let alreadyAnswered = false;
    for (const key of CARRIED_KEYS) {
      const a = oldFields.get(key);
      const b = newFields.get(key);
      if (!a || !b || a.hidden || b.hidden) continue;
      const v = old.values[a.id];
      if (isEmpty(v)) continue;
      if (!isEmpty(item.values[b.id])) {
        alreadyAnswered = true;
        continue;
      }
      if (fits(v as Json, a, b)) patch[b.id] = v as Json;
    }
    if (Object.keys(patch).length)
      copies.push({ fromItemId: old.id, toItemId: item.id, fromRef: src.old, toRef: ref, patch });
    else if (alreadyAnswered) flag('kept');

    // the old requirement's links to items outside the old library, repeated on the new requirement
    for (const l of input.links) {
      if (l.to === old.id && !oldIds.has(l.from)) {
        // a control links to the requirement through its own requirement field
        const f = linkFieldById.get(l.fieldId);
        const target = (f?.config as { targetSheetId?: string | null } | null)?.targetSheetId;
        if (f && (!target || target === to.sheetId))
          addLink({ fieldId: l.fieldId, from: l.from, to: item.id });
      } else if (l.from === old.id && !oldIds.has(l.to)) {
        // the library's own link field (Controls): the same field of the new library, by key
        const f = oldFieldById.get(l.fieldId);
        const same = f ? newFields.get(f.key) : undefined;
        if (same && newFieldById.has(same.id) && same.type === f!.type)
          addLink({ fieldId: same.id, from: item.id, to: l.to });
      }
    }
  }

  const evidenceStays = [...oldItems.entries()]
    .filter(([, it]) => (input.evidence?.get(it.id) ?? 0) > 0)
    .map(([ref]) => ref);

  return { copies, links, review, evidenceStays };
}
