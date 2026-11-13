// A library sheet in a workspace (docs/12): which controls cover each requirement, whether it applies, whether it is
// implemented, and the roll-up. The data comes in as plain rows (read under RLS by the server); the field registry
// decides what a value means (applicability, done). Nothing here knows a framework. Pure.
import { basicCtx } from '../context';
import { applicabilityState } from '../fields/applicability';
import { itemStatusField } from '../fields/item-status';
import { isDoneOf } from '../values';
import type { Ctx, Field, Item, Sheet } from '../types';
import { coverageOf, type Coverage, type CoverageInput } from './coverage';

export interface SheetData {
  sheet: Sheet;
  fields: Field[];
}

export interface LinkRow {
  fieldId: string;
  from: string;
  to: string;
}

export interface LibraryInput {
  library: SheetData & { items: Item[] };
  /** Links into or out of the library's items. */
  links: LinkRow[];
  /** The items on the other end of those links, with their sheets. */
  others: { item: Item; sheet: SheetData }[];
  /** Current evidence files per library item. */
  evidence: ReadonlyMap<string, number>;
  env: { today: string; now: Date; timeZone: string; userId: string };
}

export interface RequirementRow extends CoverageInput {
  itemId: string;
  /** Items covering it: linked from another sheet, or through the library's own link fields. */
  controlIds: string[];
}

function ctxFor(s: SheetData, env: LibraryInput['env']): Ctx {
  const ctx = basicCtx({ ...env, sheet: s.sheet, newId: () => '' });
  return {
    ...ctx,
    fieldsByKey: new Map(s.fields.map((f) => [f.key, f])),
    fieldsOf: (id: string) => (id === s.sheet.id ? s.fields : []),
  };
}

/** Whether an item is done by its sheet's status; null when the sheet has no status field. */
function doneOf(item: Item, s: SheetData, env: LibraryInput['env']): boolean | null {
  const ctx = ctxFor(s, env);
  const field = itemStatusField(ctx, s.fields);
  return field ? isDoneOf(item, field, ctx) : null;
}

/** Per requirement: applicability, implemented, covering controls and evidence; and the roll-up. */
export function libraryCoverage(input: LibraryInput): {
  rows: Map<string, RequirementRow>;
  coverage: Coverage;
} {
  const { library, env } = input;
  const libIds = new Set(library.items.map((i) => i.id));
  const applicable = library.fields.find((f) => f.type === 'applicability');
  const libCtx = ctxFor(library, env);
  const status = itemStatusField(libCtx, library.fields);
  const others = new Map(input.others.map((o) => [o.item.id, o]));
  const covering = new Map<string, Set<string>>();
  for (const l of input.links) {
    const [req, other] = libIds.has(l.to) ? [l.to, l.from] : [l.from, l.to];
    if (!libIds.has(req) || libIds.has(other)) continue;
    const o = others.get(other);
    // a requirement of another framework is not a control
    if (!o || o.item.requirementRef || o.item.archivedAt) continue;
    covering.set(req, (covering.get(req) ?? new Set()).add(other));
  }
  const rows = new Map<string, RequirementRow>();
  for (const it of library.items) {
    const controlIds = [...(covering.get(it.id) ?? [])];
    rows.set(it.id, {
      itemId: it.id,
      applicability: applicable ? applicabilityState(it.values[applicable.id]) : null,
      implemented: status ? isDoneOf(it, status, libCtx) : false,
      controls: controlIds.map((id) => {
        const o = others.get(id)!;
        return { done: doneOf(o.item, o.sheet, env) };
      }),
      evidence: input.evidence.get(it.id) ?? 0,
      controlIds,
    });
  }
  return { rows, coverage: coverageOf([...rows.values()]) };
}
