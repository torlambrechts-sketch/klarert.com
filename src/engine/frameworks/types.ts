// The requirement library (docs/12): frameworks, their requirements and cross-walks are shared, versioned reference
// data. These are the shapes the engine reads; the Zod schema that checks the repository's files is
// src/lib/frameworks/schema.ts (it produces exactly these types). Pure.

export const FRAMEWORK_KINDS = ['standard', 'law', 'regulation', 'internal'] as const;
export type FrameworkKind = (typeof FRAMEWORK_KINDS)[number];

export const REQUIREMENT_KINDS = ['clause', 'control', 'article', 'paragraph', 'theme'] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

/** Strongest first: an equivalent requirement asks for the same thing, partial for part of it. */
export const RELATIONS = ['equivalent', 'partial', 'related'] as const;
export type Relation = (typeof RELATIONS)[number];

export const RELATION_LABEL: Record<Relation, string> = {
  equivalent: 'Equivalent',
  partial: 'Partly',
  related: 'Related',
};

export interface Requirement {
  /** The reference number as the framework prints it: "A.5.1", "6.1.2", "Art. 33", "Art. 21(2)(a)". */
  ref: string;
  /** The ref of the requirement it sits under; null for a top-level one. */
  parent: string | null;
  kind: RequirementKind;
  /** Order within the framework (0 based, as listed). */
  position: number;
  /** Our own short words, never the framework's text (docs/12 Licensing). */
  title: string;
  /** Our own guidance, optional. */
  guidance: string | null;
  tags: string[];
}

export interface FrameworkLibrary {
  /** The library sheet's name. */
  name: string;
  /** What one item is called ("Requirement", "Article"). */
  itemLabel: string;
  idPrefix: string;
  /** The side-menu folder the library sheet goes in (an active folder with this name is reused). */
  folder: string;
  /** A statement of applicability: a saved Table view of the refs that start with `refStartsWith`. */
  soa?: { name: string; refStartsWith: string };
}

export interface Framework {
  key: string;
  /** The edition: "2022", "2015". A changed edition is a new framework version. */
  version: string;
  /** Our revision of the catalogue content for this version (titles, guidance, new refs). */
  revision: number;
  title: string;
  /** Used in chips: "27001 A.5.1", "GDPR Art. 32". */
  shortTitle: string;
  publisher: string;
  kind: FrameworkKind;
  /** Where the reference numbers come from. */
  source: string;
  /** What may be shipped (docs/12 Licensing); shown with the library. */
  licence: string;
  url: string;
  /** Titles are always our own words; the files say so explicitly. */
  titles: 'own-words';
  library: FrameworkLibrary;
  requirements: Requirement[];
}

/** One requirement of one framework version. */
export interface RequirementId {
  framework: string;
  version: string;
  ref: string;
}

export interface Crosswalk {
  from: RequirementId;
  to: RequirementId;
  relation: Relation;
  note: string;
  /** Who made the mapping and its version: "Klarert mapping v1". */
  source: string;
}
