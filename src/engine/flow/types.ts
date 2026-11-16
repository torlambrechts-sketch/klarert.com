// The Design tab and Build › Design (docs/05 §3.8, owner decision 15 Nov 2026): a sheet's flow and the workspace's
// map, DERIVED from configuration only (sheets, fields, forms, automations, approval workflows, links), never stored
// and never read from item rows. Pure types: the server reads a FlowWorld under the person's RLS, the engine derives.
import type { Automation, Condition, Field, JobRole, Person, Role, Sheet, Team } from '../types';
import type { FormLayout } from '../views/config';

/** Where a row came from: the pack install that wrote it and its ref (docs/02 §15 provenance). */
export interface Provenance {
  installId: string;
  ref: string;
}

export interface FlowSheet extends Sheet {
  folderId: string | null;
  folderName: string | null;
  /** The Registers domain of its folder (docs/11 Core registers), or null. */
  domain: string | null;
  pack: Provenance | null;
}

export interface FlowField extends Field {
  pack?: Provenance | null;
}

export interface FlowForm {
  id: string;
  sheetId: string;
  name: string;
  layout: FormLayout;
  position: string;
  pack: Provenance | null;
  /** Answers so far and the last one (form_stats), when read. */
  responses?: number;
  lastAt?: string | null;
}

export interface FlowAutomation {
  id: string;
  sheetId: string;
  name: string;
  enabled: boolean;
  mode: 'live' | 'test';
  trigger: Automation['trigger'];
  conditions: Condition[];
  actions: Automation['actions'];
  locked: boolean;
  lastRunAt: string | null;
  runCount: number;
  createdAt: string;
  pack: Provenance | null;
}

export interface FlowPack {
  installId: string;
  key: string;
  title: string;
  version: string;
}

/** An installed app (docs/13) and the sheets its screens read. */
export interface FlowApp {
  key: string;
  title: string;
  sheetIds: string[];
}

/** Run-log and webhook-queue aggregates of one automation (the last 30 days, bounded by the database). */
export interface AutomationHealth {
  failed: number;
  partial: number;
  lastFailedAt: string | null;
  deadLetters: number;
  retrying: number;
}

export interface FlowHealth {
  automations: Record<string, AutomationHealth>;
  /** False when the aggregates could not be read: health then says only what configuration knows. */
  available: boolean;
}

/** A pack row as the workspace holds it, compared with the version installed (docs/11 Upgrades, base). */
export type DriftState = 'unchanged' | 'changed';

/** A folder of the side menu; a Registers domain folder has its domain (docs/11 Core registers). */
export interface FlowFolder {
  id: string;
  name: string;
  domain: string | null;
  position: string;
}

export interface FlowWorld {
  /** Folders in side-menu order: Registers domains first, then the workspace's own. */
  folders: FlowFolder[];
  sheets: FlowSheet[];
  fields: FlowField[];
  forms: FlowForm[];
  automations: FlowAutomation[];
  packs: FlowPack[];
  apps: FlowApp[];
  people: Person[];
  teams: Team[];
  jobRoles: JobRole[];
  health: FlowHealth;
  /**
   * `automation:<id>`, `form:<id>`, `field:<id>` and `workflow:<sheetId>:<workflowId>` of rows a pack made, compared
   * with what the installed version ships. Absent: not known (the step still says which pack it came from).
   */
  drift: Record<string, DriftState>;
}

export interface FlowViewer {
  userId: string;
  role: Role;
  now: Date;
  timeZone: string;
}

// ───────────────────────── the derived flow ─────────────────────────

export const FLOW_GROUPS = ['inputs', 'sheet', 'logic', 'outputs'] as const;
export type FlowGroupId = (typeof FLOW_GROUPS)[number];

export const FLOW_GROUP_TITLE: Record<FlowGroupId, string> = {
  inputs: 'Inputs',
  sheet: 'Sheet',
  logic: 'Logic',
  outputs: 'Outputs',
};

export type StepKind =
  | 'manual'
  | 'form'
  | 'automation_in'
  | 'button_in'
  | 'link_in'
  | 'api'
  | 'sheet'
  | 'automation'
  | 'approval'
  | 'lifecycle'
  | 'link_out'
  | 'create_out'
  | 'update_out'
  | 'notify'
  | 'webhook';

/** Health tone, always shown with its words and a symbol (never colour alone). */
export type HealthTone = 'ok' | 'idle' | 'test' | 'off' | 'warn' | 'crit';

export interface StepHealth {
  tone: HealthTone;
  /** The headline in words: "Last run 14 Nov 2026, 10:42", "Paused", "Dead letter: 2 webhooks failed". */
  words: string;
  /** Every problem in words, worst first (the headline is the first when there are any). */
  problems: string[];
}

export type PackState = 'unchanged' | 'changed' | 'from' | 'added';

export interface StepPack {
  state: PackState;
  /** The pack's title; null for "added here" on a pack's sheet. */
  title: string | null;
  /** "From Core registers · unchanged", "From Core registers · changed", "From Core registers", "Added here". */
  words: string;
}

export type EditorKind =
  'automation' | 'form' | 'approval' | 'field' | 'lifecycle' | 'sheet' | 'new_item';

export interface StepEdit {
  editor: EditorKind;
  /** The automation, form, workflow or field id; the sheet's id for sheet and new_item. */
  id: string;
  /** The sheet the object lives on (another sheet for an incoming automation or link). */
  sheetId: string;
}

export interface FlowStep {
  /** Stable within the flow: `<kind>:<object id>[:<n>]`. */
  id: string;
  group: FlowGroupId;
  kind: StepKind;
  name: string;
  subline: string;
  health: StepHealth | null;
  pack: StepPack | null;
  edit: StepEdit | null;
  /** The other sheet of an input or output (null when it is a sheet the person cannot open). */
  other?: { sheetId: string | null; name: string };
  /** Shown greyed, nothing behind it (inbound API and webhooks, post-MVP). */
  comingLater?: true;
  /** Data that leaves the workspace through this step. */
  leaves?: LeaveRow;
}

export interface FlowGroup {
  id: FlowGroupId;
  /** "01" … "04". */
  number: string;
  title: string;
  steps: FlowStep[];
}

export interface SheetFlow {
  sheet: FlowSheet;
  groups: FlowGroup[];
  counts: { inputs: number; logic: number; outputs: number; columns: number; relations: number };
  /** Some step differs from its pack (changed, or added on a pack's sheet). */
  differs: boolean;
}

// ───────────────────────── leaves the system ─────────────────────────

export type Destination = 'teams' | 'slack' | 'webhook';

export const DESTINATION_LABEL: Record<Destination, string> = {
  teams: 'Microsoft Teams',
  slack: 'Slack',
  webhook: 'Webhook',
};

export interface SentField {
  /** "Restricted field" when the person may not see the field (its name is never shown). */
  name: string;
  personal: boolean;
  /** Restricted: the payload carries "Restricted", never the value. */
  restricted: boolean;
}

export interface LeaveRow {
  id: string;
  sheetId: string;
  sheetName: string;
  automationId: string;
  automationName: string;
  destination: Destination;
  /** The host only, the path masked: "hooks.slack.com/…". The full address is never derived. */
  host: string;
  /** What goes out besides the fields: the item's ID, name and link, the sheet and the automation. */
  note: string;
  fields: SentField[];
  personal: number;
  enabled: boolean;
  mode: 'live' | 'test';
  health: StepHealth;
  pack: StepPack | null;
}

// ───────────────────────── the workspace graph ─────────────────────────

export type EdgeKind = 'link' | 'create' | 'update' | 'button' | 'sync';

export const EDGE_KIND_LABEL: Record<EdgeKind, string> = {
  link: 'Link field',
  create: 'Creates items',
  update: 'Updates linked items',
  button: 'Button creates items',
  sync: 'Keeps requirement checks',
};

export interface GraphNode {
  id: string;
  name: string;
  folderId: string | null;
  folderName: string | null;
  domain: string | null;
  /** Keys of the packs with rows on this sheet (the sheet's own and add-ons that extend it). */
  packKeys: string[];
  packTitle: string | null;
  inputs: number;
  logic: number;
  outputs: number;
  /** Outside destinations, as badges: "Slack · 1". */
  outside: { destination: Destination; label: string; count: number }[];
  differs: boolean;
  /** The worst health of its steps. */
  tone: HealthTone | null;
  apps: string[];
  /** Kept by a filter only because a kept sheet connects to it (drawn muted). */
  context?: boolean;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /** The link field or the automation, in words. */
  via: string;
  twoWay?: boolean;
  health: StepHealth | null;
}

export interface WorkspaceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphFilter {
  app?: string | null;
  pack?: string | null;
  /** A folder id, or "none" for sheets without a folder. */
  group?: string | null;
  domain?: string | null;
  differs?: boolean;
}

/** The person's role decides only what they may change; what the flow shows is the same for everyone who can read. */
export const canEditDesign = (role: Role) =>
  role === 'owner' || role === 'admin' || role === 'editor';
