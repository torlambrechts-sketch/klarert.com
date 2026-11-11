// Domain types shared by the engine, the server and the UI (docs/02 §10). Pure data: no React, no Supabase.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

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
}

export interface FileRow {
  id: string;
  itemId: string;
  fieldId: string;
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
  item(id: string): Item | undefined;
  /** Current file versions (replaced_by is null). */
  files(itemId: string, fieldId: string): FileRow[];
  sheetOf(itemId: string): Sheet | undefined;
  /** Protected value, if the caller may see it. */
  protectedValue(itemId: string, fieldId: string): string | null | undefined;
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

/** The 11 automation triggers (docs/04 §3). */
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
  | 'checklist_no';

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
