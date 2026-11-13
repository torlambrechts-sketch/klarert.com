// A sub-item set (docs/02 §12) as rows: the child sheet, its one hidden group, its fields, the sub-items column on the
// parent and the parent's settings. Pure: ids and positions come from the caller. The "Turn on sub-items" command
// (create_sheet under the person's RLS) and the template importer (seed, service role) write the same rows.
import { fieldType, isFieldTypeId } from '../fields/registry';
import { fieldKeyFromName, keyBetween, keysBetween } from '../ordering';
import { subitemLabel } from '../subitems';
import type { Json, SubitemSettings } from '../types';

/** A column of a sub-item set: key (optional, made from the name), name, type, config and status rules. */
export interface SubitemFieldSpec {
  key?: string;
  name: string;
  type: string;
  config?: Json;
  rules?: Json;
}

export interface SubitemSetup {
  label?: string;
  blockClose?: boolean;
  lockCascade?: boolean;
  fields?: SubitemFieldSpec[];
  /** The template set: values by child field key, tokens ($in:N, $today) kept for when it is applied. */
  items?: SubitemSettings['template'];
}

/** Owner, Status (with a done option) and Due date: what a sub-item needs to be worked through. */
export const DEFAULT_SUBITEM_FIELDS: SubitemFieldSpec[] = [
  { name: 'Owner', type: 'people', config: { multiple: false } },
  { name: 'Status', type: 'status' },
  { name: 'Due date', type: 'date', config: { relative: true } },
];

const clampWidth = (w: number) => Math.min(600, Math.max(60, Math.round(w)));

export interface SubitemRows {
  label: string;
  sheet: {
    id: string;
    org_id: string;
    folder_id: string | null;
    name: string;
    description: null;
    item_label: string;
    id_prefix: null;
    parent_sheet_id: string;
    settings: Json;
    position: string;
  };
  group: { id: string; name: string; color: string; position: string };
  fields: {
    id: string;
    key: string;
    name: string;
    type: string;
    position: string;
    width: number;
    config: Json;
    rules: Json;
  }[];
  /** The sub-items column on the parent, after its last field. */
  parentField: { id: string; key: string; name: string; type: 'subitems'; position: string; width: number; config: Json };
  settings: SubitemSettings;
}

export function planSubitems(
  setup: SubitemSetup,
  env: {
    orgId: string;
    parent: { id: string; name: string; folderId: string | null; position: string; holdAutomations: boolean };
    /** Keys and positions of the parent's fields (the column goes after them). */
    parentFields: { key: string; position: string }[];
    newId(): string;
  },
): SubitemRows {
  const label = (setup.label ?? '').trim() || 'Sub-items';
  const specs = (setup.fields?.length ? setup.fields : DEFAULT_SUBITEM_FIELDS).filter((f) =>
    isFieldTypeId(f.type),
  );
  const positions = keysBetween(null, null, specs.length);
  const taken = new Set<string>();
  const fields = specs.map((c, i) => {
    const def = fieldType(c.type)!;
    const key = c.key && !taken.has(c.key) ? c.key : fieldKeyFromName(c.name, taken);
    taken.add(key);
    return {
      id: env.newId(),
      key,
      name: c.name,
      type: c.type,
      position: positions[i]!,
      width: clampWidth(def.defaultWidth),
      config: (c.config ?? def.defaultConfig()) as Json,
      rules: (c.rules ?? []) as Json,
    };
  });
  // after the last field: keys before "a0" sort differently under the database's collation than in JavaScript
  const last = [...env.parentFields].sort((a, b) => (a.position < b.position ? -1 : 1)).at(-1);
  return {
    label,
    sheet: {
      id: env.newId(),
      org_id: env.orgId,
      folder_id: env.parent.folderId,
      name: `${env.parent.name} · ${label}`.slice(0, 120),
      description: null,
      item_label: subitemLabel({ subitems: { label } as SubitemSettings }, 1).slice(0, 60),
      id_prefix: null,
      parent_sheet_id: env.parent.id,
      settings: { holdAutomations: env.parent.holdAutomations },
      position: keyBetween(env.parent.position, null),
    },
    group: { id: env.newId(), name: label.slice(0, 80), color: 'grey', position: 'a0' },
    fields,
    parentField: {
      id: env.newId(),
      key: fieldKeyFromName(
        label,
        env.parentFields.map((f) => f.key),
      ),
      name: label.slice(0, 80),
      type: 'subitems',
      position: keyBetween(last?.position ?? null, null),
      width: fieldType('subitems')!.defaultWidth,
      config: {},
    },
    settings: {
      label,
      blockClose: !!setup.blockClose,
      lockCascade: !!setup.lockCascade,
      template: (setup.items ?? []).slice(0, 50),
    },
  };
}
