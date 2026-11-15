// Packs (docs/11): installable bundles of the core as data. These are the manifest's types as the engine reads them;
// the Zod schema that checks a manifest file is src/lib/packs/manifest.ts (it produces exactly these types). Pure.
import type { AppManifest } from '../apps/types';
import type { Json, LabelColor } from '../types';
import type { SheetTemplate, TemplateAutomation, TemplateSheet } from '../templates/schema';

type TemplateItem = TemplateSheet['items'][number];

/** An example item (or a document of a register, or a library item) with a stable ref. */
export type PackItem = Omit<TemplateItem, 'ref' | 'links'> & {
  ref: string;
  /** link field key → refs of items of the field's target sheet */
  links?: Record<string, string[]>;
  /**
   * A library item of a framework's library sheet (docs/12): the requirement it stands for,
   * `<framework>@<version>#<ref>`. Written once by install_pack into items.requirement_ref and never changed.
   */
  requirementRef?: string;
  /**
   * Example links into a required framework's library (docs/11 Frameworks): requirement or control link field key →
   * requirement keys (`iso-27001@2022#A.6.3`). Resolved at install against the adopted library's items by
   * requirement_ref; a key the library does not have is left out with a warning.
   */
  requirements?: Record<string, string[]>;
};

/**
 * What a sheet is for (docs/11 Pack quality bar): decides the views it ships with. `register` a list of things kept
 * up to date (risks, documents, suppliers); `actions` work with owners and due dates (CAPA, tasks); `log` dated events
 * (incidents, meetings); `library` reference items (requirements, categories); `plan` dated work over time (audit
 * programme, projects).
 */
export const SHEET_KINDS = ['register', 'actions', 'log', 'library', 'plan'] as const;
export type SheetKind = (typeof SHEET_KINDS)[number];

/**
 * A sheet of a pack: a template sheet whose folder is a folder ref, whose items have refs, and that may be a library
 * (`isLibrary`) or a documents register (`register: 'documents'`). Link fields name their target with
 * `config.targetSheetRef`: a sheet ref of this pack, or `<pack key>:<sheet ref>` for another pack's sheet.
 */
export type PackSheet = Omit<TemplateSheet, 'folder' | 'items' | 'forms'> & {
  folder?: string;
  isLibrary: boolean;
  register?: 'documents';
  /** Restricted at install (docs/02 §16): the installer and the owners see it until people are given access. */
  restricted?: boolean;
  /** What the sheet is for (docs/11 Pack quality bar); a library sheet (`isLibrary`) is a `library`. */
  kind?: SheetKind;
  /**
   * The sheet holds personal data (docs/11 Pack quality bar): installed restricted (owners, and admins and the
   * installer listed), whatever `restricted` says; its personal fields carry `config.personalData`.
   */
  personalData?: boolean;
  /**
   * The framework this library sheet holds (docs/12): stored in sheets.settings.framework. `refFieldKey` names the
   * text field that shows each item's reference number (it cannot be edited).
   */
  framework?: { key: string; version: string; refFieldKey: string };
  items: PackItem[];
  /** Two link field keys: one live item per pair of targets (sheets.settings.uniqueLinkPair, 0038). */
  uniqueLinks?: [string, string];
  /** The lowest level that installs this sheet (docs/11 Levels); every level when not set. */
  level?: string;
  /** Forms may name their lowest level too (forms of a sheet never install before the sheet). */
  forms: (TemplateSheet['forms'][number] & { level?: string })[];
  /**
   * An optional requirement's key (docs/11 Optional requirements): the sheet is made only when that pack is not live;
   * with it live, the pack works on that pack's registers instead and everything that needs this sheet is left out.
   */
  onlyWithout?: string;
};

/** What a pack automation adds to a template automation (docs/11 Pack quality bar). */
export interface PackAutomationMeta {
  /**
   * Installed in test mode (docs/04 §14): it runs and logs what it would do, and does nothing until an owner or
   * admin turns it live. Default: true when it notifies anyone or sends anything out (`startsInTestMode`).
   */
  startInTestMode?: boolean;
  /** An advanced automation (escalation, cascade, gate, recurring work, SLA): counted by the quality bar. */
  advanced?: boolean;
  /** What it does and why, in plain words (required for an advanced automation). */
  description?: string;
}

export type PackAutomation = TemplateAutomation &
  PackAutomationMeta & { ref: string; level?: string };

/** A dashboard widget: the sheet by ref, the field by key; `ref` becomes the widget id. */
export interface PackWidget {
  ref: string;
  type: string;
  title: string;
  sheetRef?: string;
  /**
   * A framework library the pack requires (`<framework>@<version>`, one of the manifest's `frameworks`), in place of
   * `sheetRef`: the widget reads the workspace's library sheet of that framework.
   */
  library?: string;
  fieldKey?: string;
  conditions?: { fieldKey: string; op: string; value?: Json }[];
  /** The items the widget looks at before its conditions (a count's "of N"). */
  scope?: { fieldKey: string; op: string; value?: Json }[];
  days?: number;
}

export interface PackDashboard {
  ref: string;
  name: string;
  widgets: PackWidget[];
  level?: string;
  /** The pack's headline dashboard (docs/11 Pack quality bar): exactly one per pack. */
  headline?: boolean;
}

/** A level of a pack (docs/11 Levels), lowest first: each level installs everything of the levels before it. */
export interface PackLevel {
  key: string;
  name: string;
  description: string;
}

/** A framework the pack builds on (docs/12): adopted at install when the workspace has not adopted it yet. */
export interface PackFramework {
  key: string;
  version: string;
  /** Soft (docs/11): never adopted for you; example links into it only where the workspace adopted it. */
  optional?: boolean;
}

/**
 * Where a setup step or its rule looks: a sheet of the pack by ref, or the library of a framework the pack requires
 * (`<framework>@<version>`), optionally a saved view by name.
 */
export interface SetupTarget {
  sheetRef?: string;
  library?: string;
  view?: string;
}

/**
 * How a setup step's progress is computed from data (src/engine/packs/setup.ts): of the items matching `where`
 * (all items when empty), the share that also match `all` (every one when empty), counted against at least `min`
 * items. Conditions use the condition operators (docs/04 §4).
 */
export interface SetupRule extends SetupTarget {
  where?: { fieldKey: string; op: string; value?: Json }[];
  all?: { fieldKey: string; op: string; value?: Json }[];
  min?: number;
}

export interface SetupStepText {
  title: string;
  body: string;
  /** Where "Open" goes. */
  target: SetupTarget;
  /** Every rule counts the same; the step's progress is their average. */
  rules: SetupRule[];
}

/** A step of a pack's guided setup; `levels` replaces parts of it at a level (e.g. without an asset register). */
export interface SetupStep extends SetupStepText {
  ref: string;
  levels?: Record<string, Partial<SetupStepText>>;
}

export interface PackSetup {
  title: string;
  description: string;
  steps: SetupStep[];
}

/** An option an extension adds to an option field of another pack's sheet (merged by id, docs/11 Extends). */
export interface ExtensionOption {
  id: string;
  label: string;
  color?: LabelColor;
  done?: boolean;
}

/**
 * What a pack adds to a sheet of a pack it requires (docs/11 Extends): columns, groups, views, forms, example items,
 * automations and options of existing option fields. Field keys, group, item and form refs and option ids are in the
 * pack's namespace (`namespaceOf`); every row is the extender's own (its provenance and ref map), so upgrade and
 * archive stay per pack.
 */
export interface PackExtension {
  /** The pack whose sheet this extends: one of `requires`. */
  pack: string;
  /** The sheet's ref in that pack. */
  sheet: string;
  fields?: TemplateSheet['fields'];
  groups?: TemplateSheet['groups'];
  views?: TemplateSheet['views'];
  forms?: TemplateSheet['forms'];
  items?: PackItem[];
  /** Automations on the extended sheet (the sheet is implied). */
  automations?: (Omit<TemplateAutomation, 'sheet'> & PackAutomationMeta & { ref: string })[];
  /** Field key of the extended sheet → options added to it (by id; an id already there is left as it is). */
  options?: Record<string, ExtensionOption[]>;
  /**
   * Approval workflows (docs/04 §13) added to the extended sheet's `settings.workflows`, merged by id (an id already
   * there is left as it is). Ids start with `<namespace>_`: that is how the extender's own entries are told apart on
   * a shared sheet (its upgrade and archive touch only those).
   */
  workflows?: TemplateSheet['workflows'];
  /**
   * The lowest level of this pack that installs the entry (docs/11 Levels); every level when not set. An add-on's
   * Starter then needs only what its Starter entries use of the required pack (`neededLevel` per level).
   */
  level?: string;
}

/**
 * The standard an add-on stands for (docs/11 Core registers): its option in the shared "Standards" field of every
 * sheet it extends, and the saved view "<label> view" there.
 */
export interface PackStandard {
  id: string;
  label: string;
  color?: LabelColor;
}

/** One choice of a pack setting (docs/11 Pack settings), e.g. a country with its authority and CSIRT. */
export interface PackSettingChoice {
  id: string;
  label: string;
  /** Shown as a group in the picker ("EU member states", "EEA countries"). */
  group?: string;
  /** value key → text, in our own words (the setting's `values` name the keys). */
  values: Record<string, string>;
  /** Checked against the sources on `checkedOn`; unverified entries say so wherever they are shown. */
  verified: boolean;
  checkedOn?: string;
  note?: string;
  sources: { title: string; url: string }[];
}

/**
 * A choice a workspace makes for a pack (docs/11 Pack settings): at install or later on Workspace admin › Packs. It
 * sets the defaults of the pack's own fields whose `config.default` is `$setting:<key>.<value key>`.
 */
export interface PackSetting {
  key: string;
  label: string;
  description: string;
  /** What each choice says (the columns of the table): `{ key, label }`. */
  values: { key: string; label: string }[];
  choices: PackSettingChoice[];
  /** A choice id used until the workspace chooses; none: the defaults stay empty. */
  default?: string;
}

export interface PackRequirement {
  pack: string;
  /** A semver range: 1.2.3, ^1.2.0, ~1.2.0, >=1.2.0 or *. */
  range: string;
  /**
   * Used when live, never installed for you (docs/11 Optional requirements): with it live the pack works on its
   * registers (its `onlyWithout` sheets are not made); without it everything that names it is left out.
   */
  optional?: boolean;
}

export interface PackManifest {
  key: string;
  /** Semver: major.minor.patch. */
  version: string;
  title: string;
  description: string;
  requires: PackRequirement[];
  /** People named by example values (`$person:<ref>`), matched to the workspace's members by email. */
  people: SheetTemplate['people'];
  folders: {
    ref: string;
    name: string;
    restricted?: boolean;
    level?: string;
    /**
     * A domain folder of shared registers (docs/11 Core registers): shown under Registers in the side menu, in the
     * manifest's order, hidden while it has no live sheets. Never reuses a folder of the same name.
     */
    domain?: string;
  }[];
  sheets: PackSheet[];
  automations: PackAutomation[];
  dashboards: PackDashboard[];
  /** Levels chosen at install, lowest first (docs/11 Levels). None: the pack installs whole. */
  levels?: PackLevel[];
  /** Framework libraries the pack builds on, adopted at install when missing (docs/12). */
  frameworks?: PackFramework[];
  /** A guided setup checklist shown after install (docs/11 Setup). */
  setup?: PackSetup;
  /** Apps over the pack's sheets, forms and dashboards (docs/13), shown once the pack is installed. */
  apps?: AppManifest[];
  /**
   * A system pack (Core registers): its sheets are shared registers ("System board") and its fields system columns
   * (hidden but never deleted, retyped or re-keyed).
   */
  system?: boolean;
  /** The standard this add-on stands for (docs/11 Core registers). */
  standard?: PackStandard;
  /** What this pack adds to sheets of packs it requires (docs/11 Extends). */
  extends?: PackExtension[];
  /** Why the pack ships no intake forms (docs/11 Pack quality bar), e.g. a pure library or add-on. */
  formsNotApplicable?: string;
  /** Choices a workspace makes for the pack, setting defaults in its own sheets (docs/11 Pack settings). */
  settings?: PackSetting[];
}

/** `<pack key>:<sheet ref>` or `<sheet ref>`. */
export const SHEET_REF = /^(?:([a-z0-9][a-z0-9-]{0,79}):)?([a-z][a-z0-9_]{0,39})$/;

/** The pack a sheet ref points into (null: this pack) and the sheet's own ref. */
export function splitSheetRef(
  raw: string,
  ownKey: string,
): { pack: string | null; ref: string } | null {
  const m = raw.match(SHEET_REF);
  if (!m) return null;
  const pack = m[1] && m[1] !== ownKey ? m[1] : null;
  return { pack, ref: m[2]! };
}
