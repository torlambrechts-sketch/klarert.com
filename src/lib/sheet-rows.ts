// Database rows → domain types (docs/02 §10). Pure; used by the sheet query (browser and server) and realtime.
import { parseColumnGroups } from '@/engine/views/column-groups';
import { parseDashboardConfig, type WidgetConfig } from '@/engine/dashboards/types';
import type { LinkRow } from '@/engine/sheet-data';
import type { FileVersionRow } from '@/engine/item-files';
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
import { parseViewConfig, toViewType, type SavedView } from '@/engine/views/config';
import { readSubitemSettings } from '@/engine/subitems';
import type { Database } from './database.types';

type Tables = Database['public']['Tables'];
export type ItemDbRow = Omit<
  Tables['items']['Row'],
  'held_at' | 'held_by' | 'held_created' | 'held_snapshot' | 'next_sub_seq' | 'archived_with'
>;
export type FieldDbRow = Tables['fields']['Row'];
export type GroupDbRow = Tables['groups']['Row'];
export type LinkDbRow = Tables['item_links']['Row'];
export type FileDbRow = Tables['files']['Row'];
export type ViewDbRow = Tables['views']['Row'];

/** Columns only the form submit functions write (0022). */
type SourceColumn = 'source_form_id' | 'form_version' | 'source_channel';

export const ITEM_COLUMNS =
  'id, org_id, sheet_id, group_id, seq, display_id, name, values, position, locked, lock_reason, created_by, created_at, updated_by, updated_at, archived_at, parent_id, sub_seq, source_form_id, form_version, source_channel';
/** The sheet columns the domain Sheet needs (sub-items: the parent, and the settings that hold the label and gate). */
export const SHEET_COLUMNS =
  'id, org_id, name, item_label, id_prefix, is_library, parent_sheet_id, settings';
export const FIELD_COLUMNS =
  'id, org_id, sheet_id, key, name, type, position, width, required, locked, description, config, validation, rules, visibility, created_at, updated_at, archived_at';

export function toItem(
  r: Pick<ItemDbRow, Exclude<keyof ItemDbRow, 'org_id' | 'parent_id' | 'sub_seq' | SourceColumn>> &
    Partial<Pick<ItemDbRow, 'parent_id' | 'sub_seq' | SourceColumn>>,
): Item {
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
    ...(r.parent_id ? { parentId: r.parent_id, subSeq: r.sub_seq ?? null } : {}),
    ...(r.source_form_id || r.source_channel
      ? {
          source: {
            formId: r.source_form_id ?? null,
            formVersion: r.form_version ?? null,
            channel: r.source_channel === 'public' ? 'public' : 'internal',
          },
        }
      : {}),
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

export function toGroup(
  r: Pick<GroupDbRow, 'id' | 'sheet_id' | 'name' | 'color' | 'position'>,
): Group {
  return {
    id: r.id,
    sheetId: r.sheet_id,
    name: r.name,
    color: r.color as LabelColor,
    position: r.position,
  };
}

export function toLink(
  r: Pick<LinkDbRow, 'id' | 'field_id' | 'from_item' | 'to_item' | 'position'>,
): LinkRow {
  return {
    id: r.id,
    fieldId: r.field_id,
    fromItem: r.from_item,
    toItem: r.to_item,
    position: r.position,
  };
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

/** A file version with its details, for the Files tab, the version history and documents (docs/02 §8). */
export function toFileVersion(r: FileDbRow): FileVersionRow {
  return {
    ...toFile(r),
    createdAt: r.created_at,
    uploadedBy: r.uploaded_by,
    description: r.description,
    category: r.category,
    versionNo: r.version_no,
    versionNote: r.version_note,
    classification: r.classification,
    personalData: r.personal_data,
    archivedAt: r.archived_at,
    scanStatus: r.scan_status,
    approvedAt: r.approved_at,
    supersededAt: r.superseded_at,
  };
}

export function toSheet(r: {
  id: string;
  org_id: string;
  name: string;
  item_label: string;
  id_prefix: string | null;
  is_library: boolean;
  parent_sheet_id?: string | null;
  settings?: unknown;
}): Sheet {
  const settings = (r.settings ?? {}) as { subitems?: unknown; columnGroups?: unknown; register?: unknown };
  const columnGroups = parseColumnGroups(settings.columnGroups);
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    itemLabel: r.item_label,
    idPrefix: r.id_prefix ?? '',
    isLibrary: r.is_library,
    ...(r.parent_sheet_id ? { parentSheetId: r.parent_sheet_id } : {}),
    ...(settings.subitems ? { subitems: readSubitemSettings(settings.subitems) } : {}),
    ...(columnGroups.length ? { columnGroups } : {}),
    ...(settings.register === 'documents' ? { register: 'documents' as const } : {}),
  };
}

/** Sheets of one list with `childSheetId` set from the child sheets in the same list. */
export function withChildIds(sheets: Sheet[]): Sheet[] {
  const child = new Map(
    sheets.flatMap((s) => (s.parentSheetId ? [[s.parentSheetId, s.id] as const] : [])),
  );
  return sheets.map((s) => (child.has(s.id) ? { ...s, childSheetId: child.get(s.id)! } : s));
}

export function toView(
  r: Omit<ViewDbRow, 'form_version'> & Partial<Pick<ViewDbRow, 'form_version'>>,
): SavedView {
  return {
    id: r.id,
    sheetId: r.sheet_id,
    name: r.name,
    type: toViewType(r.type) ?? 'table',
    ...(toViewType(r.type) !== r.type ? { legacyType: r.type } : {}),
    config: parseViewConfig(r.config),
    ownerId: r.owner_id,
    position: r.position,
    ...(r.type === 'form' ? { formVersion: r.form_version ?? 1 } : {}),
  };
}

export type DashboardDbRow = Tables['dashboards']['Row'];

/** A dashboard as the pages use it: its widgets read leniently from the stored config. */
export interface Dashboard {
  id: string;
  name: string;
  position: string;
  widgets: WidgetConfig[];
  updatedAt: string;
}

export function toDashboard(
  r: Pick<DashboardDbRow, 'id' | 'name' | 'position' | 'config' | 'updated_at'>,
): Dashboard {
  return {
    id: r.id,
    name: r.name,
    position: r.position,
    widgets: parseDashboardConfig(r.config).widgets,
    updatedAt: r.updated_at,
  };
}
