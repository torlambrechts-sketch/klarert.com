// Packs (docs/11): installable bundles of the core as data. These are the manifest's types as the engine reads them;
// the Zod schema that checks a manifest file is src/lib/packs/manifest.ts (it produces exactly these types). Pure.
import type { Json } from '../types';
import type { SheetTemplate, TemplateAutomation, TemplateSheet } from '../templates/schema';

type TemplateItem = TemplateSheet['items'][number];

/** An example item (or a document of a register, or a library item) with a stable ref. */
export type PackItem = Omit<TemplateItem, 'ref' | 'links'> & {
  ref: string;
  /** link field key → refs of items of the field's target sheet */
  links?: Record<string, string[]>;
};

/**
 * A sheet of a pack: a template sheet whose folder is a folder ref, whose items have refs, and that may be a library
 * (`isLibrary`) or a documents register (`register: 'documents'`). Link fields name their target with
 * `config.targetSheetRef`: a sheet ref of this pack, or `<pack key>:<sheet ref>` for another pack's sheet.
 */
export type PackSheet = Omit<TemplateSheet, 'folder' | 'items'> & {
  folder?: string;
  isLibrary: boolean;
  register?: 'documents';
  /** Restricted at install (docs/02 §16): the installer and the owners see it until people are given access. */
  restricted?: boolean;
  items: PackItem[];
};

export type PackAutomation = TemplateAutomation & { ref: string };

/** A dashboard widget: the sheet by ref, the field by key; `ref` becomes the widget id. */
export interface PackWidget {
  ref: string;
  type: string;
  title: string;
  sheetRef?: string;
  fieldKey?: string;
  conditions?: { fieldKey: string; op: string; value?: Json }[];
  days?: number;
}

export interface PackDashboard {
  ref: string;
  name: string;
  widgets: PackWidget[];
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
  folders: { ref: string; name: string; restricted?: boolean }[];
  sheets: PackSheet[];
  automations: PackAutomation[];
  dashboards: PackDashboard[];
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
