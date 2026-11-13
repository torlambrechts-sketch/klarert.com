// Test fixtures for the engine: a deterministic Ctx and builders. Used only by *.test.ts files.
import type { Ctx, Field, FileRow, Group, Item, Json, Person, Sheet } from '../types';

export const TODAY = '2026-11-11';
export const NOW = new Date('2026-11-11T12:00:00Z');

export const people: Person[] = [
  {
    id: 'u-maria',
    name: 'Maria Pereira',
    initials: 'MP',
    color: 'blue',
    email: 'maria@example.com',
  },
  {
    id: 'u-james',
    name: 'James Okafor',
    initials: 'JO',
    color: 'teal',
    email: 'james@example.com',
  },
  { id: 'u-vic', name: 'Vic Viewer', initials: 'VV', color: 'grey', email: 'vic@example.com' },
];

export const sheet: Sheet = {
  id: 's-ca',
  orgId: 'o-1',
  name: 'Corrective actions',
  itemLabel: 'Action',
  idPrefix: 'CA-',
  isLibrary: false,
};

export const groups: Group[] = [
  { id: 'g-open', sheetId: 's-ca', name: 'Open', color: 'orange', position: 'a0' },
  { id: 'g-closed', sheetId: 's-ca', name: 'Closed', color: 'green', position: 'a1' },
];

let fieldSeq = 0;
export function makeField<C = Record<string, unknown>>(
  type: string,
  config: C,
  over: Partial<Field<C>> = {},
): Field<C> {
  fieldSeq += 1;
  const key = over.key ?? `${type}_${fieldSeq}`;
  return {
    id: over.id ?? `f-${key}`,
    sheetId: sheet.id,
    key,
    name: over.name ?? key,
    type,
    position: 'a0',
    required: false,
    locked: false,
    config,
    validation: {},
    rules: [],
    visibility: null,
    ...over,
  };
}

let itemSeq = 0;
export function makeItem(values: Record<string, Json> = {}, over: Partial<Item> = {}): Item {
  itemSeq += 1;
  return {
    id: over.id ?? `i-${itemSeq}`,
    sheetId: sheet.id,
    groupId: 'g-open',
    seq: itemSeq,
    displayId: `CA-${String(itemSeq).padStart(3, '0')}`,
    name: `Item ${itemSeq}`,
    values,
    position: 'a0',
    locked: false,
    createdBy: 'u-maria',
    createdAt: '2026-11-01T09:00:00Z',
    updatedBy: 'u-maria',
    updatedAt: '2026-11-10T09:00:00Z',
    archivedAt: null,
    ...over,
  };
}

export interface CtxWorld {
  fields?: Field[];
  /** Fields of other sheets, by sheet id. */
  otherFields?: Record<string, Field[]>;
  items?: Item[];
  /** `${itemId}:${fieldId}` → target ids */
  links?: Record<string, string[]>;
  files?: FileRow[];
  sheets?: Record<string, Sheet>;
  protected?: Record<string, string>;
}

export function makeCtx(world: CtxWorld = {}, over: Partial<Ctx> = {}): Ctx {
  const fields = world.fields ?? [];
  const items = new Map((world.items ?? []).map((i) => [i.id, i]));
  let idSeq = 0;
  return {
    today: TODAY,
    now: NOW,
    timeZone: 'Europe/London',
    userId: 'u-maria',
    people: new Map(people.map((p) => [p.id, p])),
    teams: new Map([
      ['t-quality', { id: 't-quality', name: 'Quality', memberIds: ['u-maria', 'u-vic'] }],
      ['t-it', { id: 't-it', name: 'IT', memberIds: ['u-james'] }],
    ]),
    jobRoles: new Map([
      ['r-cm', { id: 'r-cm', name: 'Compliance manager' }],
      ['r-it', { id: 'r-it', name: 'Head of IT' }],
    ]),
    entities: new Map([['e-1', { id: 'e-1', name: 'Meridian Components Ltd', country: 'GB' }]]),
    sites: new Map([
      ['site-leeds', { id: 'site-leeds', entityId: 'e-1', name: 'Leeds' }],
      ['site-bradford', { id: 'site-bradford', entityId: 'e-1', name: 'Bradford' }],
    ]),
    sheet,
    fieldsByKey: new Map(fields.map((f) => [f.key, f])),
    fieldsOf: (sheetId) => (sheetId === sheet.id ? fields : (world.otherFields?.[sheetId] ?? [])),
    groups: new Map(groups.map((g) => [g.id, g])),
    links: (itemId, fieldId) => world.links?.[`${itemId}:${fieldId}`] ?? [],
    children: (itemId) =>
      [...items.values()]
        .filter((i) => i.parentId === itemId && !i.archivedAt)
        .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
        .map((i) => i.id),
    item: (id) => items.get(id),
    files: (itemId, fieldId) =>
      (world.files ?? []).filter(
        (f) => f.itemId === itemId && f.fieldId === fieldId && f.replacedBy === null,
      ),
    sheetOf: (itemId) => {
      const it = items.get(itemId);
      return it
        ? (world.sheets?.[it.sheetId] ?? (it.sheetId === sheet.id ? sheet : undefined))
        : undefined;
    },
    protectedValue: (itemId, fieldId) => world.protected?.[`${itemId}:${fieldId}`] ?? null,
    newId: (prefix) => `${prefix}${(++idSeq).toString(36).padStart(3, '0')}`,
    ...over,
  };
}

export function makeFile(over: Partial<FileRow> & { itemId: string; fieldId: string }): FileRow {
  return {
    id: `file-${Math.random().toString(36).slice(2, 8)}`,
    filename: 'policy.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    sha256: 'a'.repeat(64),
    source: 'upload',
    collectedAt: '2026-01-01',
    validUntil: null,
    replacedBy: null,
    ...over,
  };
}
