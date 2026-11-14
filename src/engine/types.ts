// Domain types shared by the engine, the server and the UI (docs/02 §10). Pure data: no React, no Supabase.

import type { ColumnGroup } from './views/column-groups';
import type { ApprovalWorkflow } from './approvals/definition';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type Role = 'owner' | 'admin' | 'editor' | 'viewer' | 'auditor';

export type LabelColor =
  | 'grey'
  | 'blue'
  | 'navy'
  | 'teal'
  | 'green'
  | 'yellow'
  | 'orange'
  | 'red'
  | 'pink'
  | 'purple'
  | 'dark';

export interface Person {
  id: string;
  name: string;
  initials: string;
  color: string;
  email?: string;
}
export interface Team {
  id: string;
  name: string;
  memberIds: string[];
}
export interface JobRole {
  id: string;
  name: string;
}
export interface Entity {
  id: string;
  name: string;
  country: string;
}
export interface Site {
  id: string;
  entityId: string;
  name: string;
}

export interface Sheet {
  id: string;
  orgId: string;
  name: string;
  itemLabel: string;
  idPrefix: string;
  isLibrary: boolean;
  /** Sub-items (docs/02 §12): set on a child sheet, the sheet whose items its items belong to. */
  parentSheetId?: string | null;
  /** Set on a sheet with sub-items: its child sheet (the sub-items' fields and rows). */
  childSheetId?: string | null;
  /** Sub-item settings of a sheet with sub-items (sheets.settings.subitems), read leniently. */
  subitems?: SubitemSettings | null;
  /** Column groups (sheets.settings.columnGroups), read leniently; absent = none. */
  columnGroups?: ColumnGroup[];
  /** sheets.settings.register: 'documents' makes the sheet a documents register (docs/02 §14). */
  register?: 'documents' | null;
  /** sheets.settings.workflows: the sheet's approval workflows (docs/04 §13), read leniently. */
  workflows?: ApprovalWorkflow[];
  /** sheets.settings.framework: the framework a library sheet holds (docs/12). */
  framework?: {
    key: string;
    version: string;
    refFieldKey: string;
    /** Moved to a new edition (docs/12): the new edition's library; this one is read-only (items locked). */
    movedTo?: { sheetId: string; version: string; title: string };
  } | null;
}

/** sheets.settings.subitems (docs/02 §12). */
export interface SubitemSettings {
  /** What the sheet calls its sub-items ("Actions", "Clauses", "Test steps"). */
  label: string;
  /** The gate: the parent's status cannot become done while a sub-item is open (enforced in SQL). */
  blockClose: boolean;
  /** A locked parent locks its sub-items for people who are not admins (enforced in SQL). */
  lockCascade: boolean;
  /** "From template": the sub-item set added in one go (values by child field key, tokens like $in:90). */
  template: { name: string; values: Record<string, Json> }[];
}

export interface Group {
  id: string;
  sheetId: string;
  name: string;
  color: LabelColor;
  position: string;
}

/** Status rule (docs/03 §6). Lives on the field whose key is `whenFieldKey`. */
export interface StatusRule {
  id: string;
  whenFieldKey: string;
  whenValues: Json[];
  require?: string[];
  requireComment?: boolean;
  message?: string;
  /** Only when the field was done before the change (reopening a done sub-item asks for a comment). */
  fromDone?: boolean;
}

export interface Validation {
  min?: number;
  max?: number;
  pattern?: string;
  unique?: boolean;
  maxLength?: number;
}

export interface Field<C = unknown> {
  id: string;
  sheetId: string;
  key: string;
  name: string;
  type: string;
  position: string;
  width?: number | null;
  required: boolean;
  locked: boolean;
  description?: string | null;
  config: C;
  validation: Validation;
  rules: StatusRule[];
  visibility?: Condition | null;
  /** Restricted field (docs/02 §16): who sees its values besides the owners. Absent or null: not restricted. */
  restrictedTo?: { userIds: string[]; roles: Role[] } | null;
  /** Restricted and the caller may not see its values (the database says so as it reads the field). */
  hidden?: boolean;
}

export interface Item {
  id: string;
  sheetId: string;
  groupId: string;
  seq: number;
  displayId: string;
  name: string;
  values: Record<string, Json>;
  position: string;
  locked: boolean;
  lockReason?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedBy?: string | null;
  updatedAt: string;
  archivedAt?: string | null;
  /** Sub-items: the parent item (an item of the parent sheet). */
  parentId?: string | null;
  /** Sub-items: the number under the parent (display id = parent id + "." + subSeq at creation). */
  subSeq?: number | null;
  /** The form the item came from (docs/02 §8): null formId when that form was deleted since. */
  source?: ItemSource;
  /** A library item of an adopted framework (docs/12): `<framework>@<version>#<ref>`, never changes. */
  requirementRef?: string;
}

export interface ItemSource {
  formId: string | null;
  formVersion: number | null;
  channel: 'public' | 'internal';
}

export interface FileRow {
  id: string;
  itemId: string;
  /** null: a file of the item's Files tab, not of a file field (docs/02 §8). */
  fieldId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  source: string;
  collectedAt: string;
  validUntil: string | null;
  replacedBy: string | null;
}

/** Everything the engine may know about the world. Injected; the engine never reads globals or the clock. */
export interface Ctx {
  /** ISO date (YYYY-MM-DD) in the workspace/user time zone. */
  today: string;
  now: Date;
  timeZone: string;
  userId: string;
  people: Map<string, Person>;
  teams: Map<string, Team>;
  jobRoles: Map<string, JobRole>;
  entities: Map<string, Entity>;
  sites: Map<string, Site>;
  sheet: Sheet;
  fieldsByKey: Map<string, Field>;
  /** Fields of any sheet, for lookups/rollups across sheets. */
  fieldsOf(sheetId: string): Field[];
  groups: Map<string, Group>;
  /** Target item ids of a link field, ordered. */
  links(itemId: string, fieldId: string): string[];
  /** Live sub-items of an item, in position order (empty when none are loaded). */
  children(itemId: string): string[];
  item(id: string): Item | undefined;
  /** Current file versions (replaced_by is null). */
  /** Current files of a file field, or (fieldId null) of the item's Files tab. */
  files(itemId: string, fieldId: string | null): FileRow[];
  sheetOf(itemId: string): Sheet | undefined;
  /** Protected value, if the caller may see it. */
  protectedValue(itemId: string, fieldId: string): string | null | undefined;
  /**
   * Whether the caller sees a restricted field's values (docs/02 §16). Absent: everyone does (the system, tests).
   * The values of a field the caller may not see never reach the app; the app says "Restricted" instead.
   */
  canSee?(field: Field): boolean;
  /** Sheets the caller cannot read (link targets, widget sources): their values read as "Restricted". */
  noAccess?(sheetId: string): boolean;
  /** New random id suffix (option ids, checklist line ids). */
  newId(prefix: string): string;
}

export type IssueLevel = 'error' | 'warning';
export interface Issue {
  fieldKey: string;
  level: IssueLevel;
  code: string;
  message: string;
}

/** Filter/automation condition (docs/03 §4). */
export interface Condition {
  fieldKey: string;
  op: string;
  value?: Json;
}

/** The automation triggers (docs/04 §3): 11 on the item, 3 on its sub-items. */
export type TriggerId =
  | 'item_created'
  | 'form_submitted'
  | 'field_changed'
  | 'field_becomes'
  | 'number_above'
  | 'number_below'
  | 'date_arrives'
  | 'clock_warning'
  | 'evidence_expiring'
  | 'button_clicked'
  | 'checklist_no'
  | 'subitem_created'
  | 'subitem_field_becomes'
  | 'all_subitems_done'
  | 'workflow_step_decided'
  | 'workflow_approved'
  | 'workflow_rejected'
  | 'approval_overdue';

export interface Automation {
  id: string;
  sheetId: string;
  name: string;
  enabled: boolean;
  trigger: { type: TriggerId } & Record<string, Json>;
  conditions: Condition[];
  actions: ({ type: string } & Record<string, Json>)[];
  source: string;
  version: number;
  locked: boolean;
}
