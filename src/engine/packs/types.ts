// Packs (docs/11): installable bundles of the core as data. These are the manifest's types as the engine reads them;
// the Zod schema that checks a manifest file is src/lib/packs/manifest.ts (it produces exactly these types). Pure.
import type { AppManifest } from '../apps/types';
import type { Json } from '../types';
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
  /**
   * The framework this library sheet holds (docs/12): stored in sheets.settings.framework. `refFieldKey` names the
   * text field that shows each item's reference number (it cannot be edited).
   */
  framework?: { key: string; version: string; refFieldKey: string };
  items: PackItem[];
  /** Two link field keys: one live item per pair of targets (sheets.settings.uniqueLinkPair, 0037). */
  uniqueLinks?: [string, string];
  /** The lowest level that installs this sheet (docs/11 Levels); every level when not set. */
  level?: string;
  /** Forms may name their lowest level too (forms of a sheet never install before the sheet). */
  forms: (TemplateSheet['forms'][number] & { level?: string })[];
};

export type PackAutomation = TemplateAutomation & { ref: string; level?: string };

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
  days?: number;
}

export interface PackDashboard {
  ref: string;
  name: string;
  widgets: PackWidget[];
  level?: string;
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

export interface PackRequirement {
  pack: string;
  /** A semver range: 1.2.3, ^1.2.0, ~1.2.0, >=1.2.0 or *. */
  range: string;
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
  folders: { ref: string; name: string; restricted?: boolean; level?: string }[];
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
