// Database rows → domain types (docs/02 §10). Pure; used by the sheet query (browser and server) and realtime.
import type { LinkRow } from '@/engine/sheet-data';
import type {
  Condition,
  Field,
  FileRow,
  Group,
  Item,
  Json,
  LabelColor,
  Sheet,
  StatusRule,
  Validation,
} from '@/engine/types';
import type { Database } from './database.types';

type Tables = Database['public']['Tables'];
export type ItemDbRow = Tables['items']['Row'];
export type FieldDbRow = Tables['fields']['Row'];
export type GroupDbRow = Tables['groups']['Row'];
export type LinkDbRow = Tables['item_links']['Row'];
export type FileDbRow = Tables['files']['Row'];

export const ITEM_COLUMNS =
  'id, org_id, sheet_id, group_id, seq, display_id, name, values, position, locked, lock_reason, created_by, created_at, updated_by, updated_at, archived_at';
export const FIELD_COLUMNS =
  'id, org_id, sheet_id, key, name, type, position, width, required, locked, description, config, validation, rules, visibility, created_at, updated_at, archived_at';

export function toItem(r: Pick<ItemDbRow, Exclude<keyof ItemDbRow, 'org_id'>>): Item {
  return {
    id: r.id,
    sheetId: r.sheet_id,
    groupId: r.group_id,
    seq: r.seq,
    displayId: r.display_id,
    name: r.name,
    values: (r.values ?? {}) as Record<string, Json>,
    position: r.position,
    locked: r.locked,
    lockReason: r.lock_reason,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at,
  };
}

export function toField(r: Omit<FieldDbRow, 'org_id' | 'created_at' | 'updated_at'>): Field {
  return {
    id: r.id,
    sheetId: r.sheet_id,
    key: r.key,
    name: r.name,
    type: r.type,
    position: r.position,
    width: r.width,
    required: r.required,
    locked: r.locked,
    description: r.description,
    config: (r.config ?? {}) as unknown,
    validation: (r.validation ?? {}) as Validation,
    rules: (Array.isArray(r.rules) ? r.rules : []) as unknown as StatusRule[],
    visibility: (r.visibility ?? null) as Condition | null,
  };
}

export function toGroup(r: Pick<GroupDbRow, 'id' | 'sheet_id' | 'name' | 'color' | 'position'>): Group {
  return {
    id: r.id,
    sheetId: r.sheet_id,
    name: r.name,
    color: r.color as LabelColor,
    position: r.position,
  };
}

export function toLink(r: Pick<LinkDbRow, 'id' | 'field_id' | 'from_item' | 'to_item' | 'position'>): LinkRow {
  return { id: r.id, fieldId: r.field_id, fromItem: r.from_item, toItem: r.to_item, position: r.position };
}

export function toFile(r: FileDbRow): FileRow {
  return {
    id: r.id,
    itemId: r.item_id,
    fieldId: r.field_id,
    filename: r.filename,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    source: r.source,
    collectedAt: r.collected_at,
    validUntil: r.valid_until,
    replacedBy: r.replaced_by,
  };
}

export function toSheet(r: {
  id: string;
  org_id: string;
  name: string;
  item_label: string;
  id_prefix: string;
  is_library: boolean;
}): Sheet {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    itemLabel: r.item_label,
    idPrefix: r.id_prefix,
    isLibrary: r.is_library,
  };
}
