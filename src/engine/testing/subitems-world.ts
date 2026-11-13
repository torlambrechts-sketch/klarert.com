// A CAPA-like sheet with sub-items for tests: the parent sheet (s-ca, with the sub-items column), its child sheet
// (s-ca-sub: Owner, Status with done and N/A, Due date, Evidence) and builders for sub-items. Used only by *.test.ts.
import type { Field, Item, Json, Sheet } from '../types';
import { makeCtx, makeField, makeItem, sheet, type CtxWorld } from './fixtures';

export const CHILD = 's-ca-sub';

export const childSheet: Sheet = {
  id: CHILD,
  orgId: 'o-1',
  name: 'Corrective actions · Actions',
  itemLabel: 'Action',
  idPrefix: '',
  isLibrary: false,
  parentSheetId: sheet.id,
};

export const parentSheet: Sheet = {
  ...sheet,
  childSheetId: CHILD,
  subitems: {
    label: 'Actions',
    blockClose: true,
    lockCascade: false,
    template: [
      { name: 'Containment', values: { due_date: '$in:2' } },
      { name: 'Effectiveness check of {id}', values: { due_date: '$in:90', owner: '$actor' } },
    ],
  },
};

const child = <C>(type: string, config: C, over: Partial<Field<C>>) =>
  makeField(type, config, { sheetId: CHILD, ...over });

export const cOwner = child(
  'people',
  { multiple: false },
  { id: 'c-owner', key: 'owner', name: 'Owner' },
);
export const cStatus = child(
  'status',
  {
    options: [
      { id: 'c_todo', label: 'To do', color: 'grey' },
      { id: 'c_doing', label: 'Working on it', color: 'orange' },
      { id: 'c_stuck', label: 'Stuck', color: 'red' },
      { id: 'c_done', label: 'Done', color: 'green', done: true },
      { id: 'c_na', label: 'N/A', color: 'dark', done: true },
    ],
  },
  { id: 'c-status', key: 'status', name: 'Status', position: 'a1' },
);
export const cDue = child(
  'date',
  { relative: true },
  { id: 'c-due', key: 'due_date', name: 'Due date', position: 'a2' },
);
export const cSeverity = child(
  'severity',
  {
    options: [
      { id: 'sv_low', label: 'Low', color: 'green' },
      { id: 'sv_med', label: 'Medium', color: 'yellow' },
      { id: 'sv_high', label: 'High', color: 'orange' },
    ],
  },
  { id: 'c-sev', key: 'severity', name: 'Severity', position: 'a3' },
);
export const cEvidence = child(
  'evidence',
  { validDays: 365, multiple: true, accept: [] },
  { id: 'c-ev', key: 'evidence', name: 'Evidence', position: 'a4' },
);
export const childFields = [cOwner, cStatus, cDue, cSeverity, cEvidence];

export const pStatus = makeField(
  'status',
  {
    options: [
      { id: 'p_open', label: 'Open', color: 'orange' },
      { id: 'p_done', label: 'Done', color: 'green', done: true },
    ],
  },
  { id: 'p-status', key: 'status', name: 'Status' },
);
export const pSubitems = makeField(
  'subitems',
  {},
  { id: 'p-sub', key: 'actions', name: 'Actions', position: 'a1' },
);

let n = 0;
export function makeSubitem(
  parent: Item,
  values: Record<string, Json> = {},
  over: Partial<Item> = {},
): Item {
  n += 1;
  return makeItem(values, {
    sheetId: CHILD,
    groupId: 'g-sub',
    parentId: parent.id,
    subSeq: n,
    displayId: `${parent.displayId}.${n}`,
    position: `a${n}`,
    name: `Step ${n}`,
    ...over,
  });
}

/** The parent sheet's Ctx with its sub-items loaded. */
export function subitemCtx(world: CtxWorld & { parentFields?: Field[] } = {}) {
  return makeCtx(
    {
      ...world,
      fields: world.parentFields ?? [pStatus, pSubitems],
      otherFields: { [CHILD]: childFields, ...world.otherFields },
      sheets: { [CHILD]: childSheet, [sheet.id]: parentSheet, ...world.sheets },
    },
    { sheet: parentSheet },
  );
}

/** A sub-item's Ctx: the child sheet, with the parent sheet's fields and the parent loaded. */
export function childCtx(world: CtxWorld = {}) {
  const parentFields = [pStatus, pSubitems];
  return makeCtx(
    {
      ...world,
      fields: childFields,
      sheets: { [CHILD]: childSheet, [sheet.id]: parentSheet, ...world.sheets },
    },
    {
      sheet: childSheet,
      fieldsOf: (id) => (id === CHILD ? childFields : id === sheet.id ? parentFields : []),
    },
  );
}
