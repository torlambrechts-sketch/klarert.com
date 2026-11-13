// Everything the grid, the commands and the engine know about one open sheet, as domain data, and the Ctx built from
// it. Pure: the clock, the time zone, the user and the id generator are passed in.
import { canReadProtected, type ProtectedConfig } from './fields/protected';
import type {
  Ctx,
  Entity,
  Field,
  FileRow,
  Group,
  Item,
  JobRole,
  Person,
  Sheet,
  Site,
  Team,
} from './types';

export interface LinkRow {
  id: string;
  fieldId: string;
  fromItem: string;
  toItem: string;
  position: string;
}

export interface ProtectedRow {
  itemId: string;
  fieldId: string;
  value: string;
}

export interface SheetData {
  sheet: Sheet;
  fields: Field[];
  groups: Group[];
  /** Non-archived items of the sheet (or, for a command, the items it touches). */
  items: Item[];
  /** Links from items of the sheet. */
  links: LinkRow[];
  /** Current file versions of items of the sheet. */
  files: FileRow[];
  /** Protected values the caller may see. */
  protectedValues: ProtectedRow[];
  people: Person[];
  teams: Team[];
  jobRoles: JobRole[];
  entities: Entity[];
  sites: Site[];
  /** Other sheets reached through links (targets), with their fields and the linked items. */
  related: { sheets: Sheet[]; fields: Field[]; items: Item[] };
  /** Link target sheets the caller cannot read (docs/02 §16): lookups through them read "Restricted". */
  noAccessSheetIds?: string[];
}

export interface CtxEnv {
  now: Date;
  timeZone: string;
  userId: string;
  newId: (prefix: string) => string;
  /** Owners and admins see every protected value. */
  isAdmin?: boolean;
}

/** ISO date of an instant in a time zone. */
export function todayIn(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const byPosition = <T extends { position: string }>(a: T, b: T) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

/** The Ctx for one sheet (docs/03 §1). Maps are built once; lookups are O(1). */
export function sheetCtx(data: SheetData, env: CtxEnv): Ctx {
  const fields = [...data.fields].sort(byPosition);
  const items = new Map<string, Item>();
  for (const it of data.related.items) items.set(it.id, it);
  for (const it of data.items) items.set(it.id, it);
  const sheets = new Map<string, Sheet>([[data.sheet.id, data.sheet]]);
  for (const s of data.related.sheets) sheets.set(s.id, s);
  const fieldsBySheet = new Map<string, Field[]>([[data.sheet.id, fields]]);
  for (const f of [...data.related.fields].sort(byPosition)) {
    if (f.sheetId === data.sheet.id) continue;
    const list = fieldsBySheet.get(f.sheetId) ?? [];
    list.push(f);
    fieldsBySheet.set(f.sheetId, list);
  }
  const links = new Map<string, LinkRow[]>();
  for (const l of data.links) {
    const k = `${l.fromItem}:${l.fieldId}`;
    const list = links.get(k) ?? [];
    list.push(l);
    links.set(k, list);
  }
  const linkIds = new Map<string, string[]>();
  for (const [k, list] of links)
    linkIds.set(
      k,
      list.sort(byPosition).map((l) => l.toItem),
    );
  const files = new Map<string, FileRow[]>();
  for (const f of data.files) {
    if (f.replacedBy) continue;
    const k = `${f.itemId}:${f.fieldId}`;
    const list = files.get(k) ?? [];
    list.push(f);
    files.set(k, list);
  }
  // sub-items (docs/02 §12): every loaded item with a parent, live, in position order under it
  const childIds = new Map<string, string[]>();
  for (const it of [...items.values()].sort(byPosition)) {
    if (!it.parentId || it.archivedAt) continue;
    const list = childIds.get(it.parentId) ?? [];
    list.push(it.id);
    childIds.set(it.parentId, list);
  }
  const noAccess = new Set(data.noAccessSheetIds ?? []);
  const prot = new Map(data.protectedValues.map((p) => [`${p.itemId}:${p.fieldId}`, p.value]));
  const canSeeProtected = (fieldId: string) => {
    const f = fields.find((x) => x.id === fieldId);
    return !!f && canReadProtected(f as Field<ProtectedConfig>, env.userId, env.isAdmin ?? false);
  };

  return {
    today: todayIn(env.now, env.timeZone),
    now: env.now,
    timeZone: env.timeZone,
    userId: env.userId,
    people: new Map(data.people.map((p) => [p.id, p])),
    teams: new Map(data.teams.map((t) => [t.id, t])),
    jobRoles: new Map(data.jobRoles.map((r) => [r.id, r])),
    entities: new Map(data.entities.map((e) => [e.id, e])),
    sites: new Map(data.sites.map((s) => [s.id, s])),
    sheet: data.sheet,
    fieldsByKey: new Map(fields.map((f) => [f.key, f])),
    fieldsOf: (sheetId) => fieldsBySheet.get(sheetId) ?? [],
    groups: new Map(data.groups.map((g) => [g.id, g])),
    links: (itemId, fieldId) => linkIds.get(`${itemId}:${fieldId}`) ?? [],
    children: (itemId) => childIds.get(itemId) ?? [],
    item: (id) => items.get(id),
    files: (itemId, fieldId) => files.get(`${itemId}:${fieldId}`) ?? [],
    sheetOf: (itemId) => {
      const it = items.get(itemId);
      return it ? sheets.get(it.sheetId) : undefined;
    },
    // undefined = may not see; null = may see, empty
    protectedValue: (itemId, fieldId) => {
      const v = prot.get(`${itemId}:${fieldId}`);
      if (v !== undefined) return v;
      return canSeeProtected(fieldId) ? null : undefined;
    },
    // restricted fields (docs/02 §16): the database marks the ones whose values the caller may not see
    canSee: (field) => !field.hidden,
    noAccess: (sheetId) => noAccess.has(sheetId),
    newId: env.newId,
  };
}

/**
 * The sheet's data with its sub-items (docs/02 §12): the child sheet, its fields and items join `related`, their links
 * and files join the sheet's, so roll-ups, the sub-items column and triggers read them through the Ctx. Pure.
 */
export function withSubitems(data: SheetData, child: SheetData | null | undefined): SheetData {
  if (!child || child.sheet.parentSheetId !== data.sheet.id) return data;
  const known = new Set(data.related.items.map((i) => i.id));
  return {
    ...data,
    sheet: { ...data.sheet, childSheetId: child.sheet.id },
    links: [...data.links, ...child.links],
    files: [...data.files, ...child.files],
    protectedValues: [...data.protectedValues, ...child.protectedValues],
    related: {
      sheets: [...data.related.sheets.filter((s) => s.id !== child.sheet.id), child.sheet],
      fields: [...data.related.fields.filter((f) => f.sheetId !== child.sheet.id), ...child.fields],
      items: [...data.related.items, ...child.items.filter((i) => !known.has(i.id))],
    },
  };
}

/** A child sheet's data with its parents (the parent sheet, its fields and items) for breadcrumbs and templates. */
export function withParent(child: SheetData, parent: SheetData | null | undefined): SheetData {
  if (!parent || child.sheet.parentSheetId !== parent.sheet.id) return child;
  const known = new Set(child.related.items.map((i) => i.id));
  return {
    ...child,
    related: {
      sheets: [...child.related.sheets.filter((s) => s.id !== parent.sheet.id), parent.sheet],
      fields: [
        ...child.related.fields.filter((f) => f.sheetId !== parent.sheet.id),
        ...parent.fields,
      ],
      items: [...child.related.items, ...parent.items.filter((i) => !known.has(i.id))],
    },
  };
}

/** A copy of the data with one fewer level of sharing: used by reducers that patch the cache. */
export const emptySheetData = (sheet: Sheet): SheetData => ({
  sheet,
  fields: [],
  groups: [],
  items: [],
  links: [],
  files: [],
  protectedValues: [],
  people: [],
  teams: [],
  jobRoles: [],
  entities: [],
  sites: [],
  related: { sheets: [], fields: [], items: [] },
});
