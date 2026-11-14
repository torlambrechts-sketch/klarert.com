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

/** Where the short titles come from: our own words, or the official short headings (never more, docs/12). */
export const TITLES_POLICIES = ['own-words', 'official-short'] as const;
export type TitlesPolicy = (typeof TITLES_POLICIES)[number];

/**
 * Where an edition stands at its publisher (docs/12 Standards watch): still the edition to use, withdrawn and
 * replaced, replaced but certificates still valid during a transition, or current with a revision on the way.
 */
export const EDITION_STATUSES = [
  'current',
  'withdrawn',
  'superseded-in-transition',
  'revision-in-progress',
] as const;
export type EditionStatus = (typeof EDITION_STATUSES)[number];

/**
 * The edition status of a framework version: catalogue metadata, checked monthly (docs/12 Standards watch). Not
 * part of the library's content: changing it never needs a new revision and never offers an update.
 */
export interface EditionInfo {
  status: EditionStatus;
  /** The edition that replaces this one, `<key>@<version>` ("iso-14001@2026"). */
  supersededBy: string | null;
  /** When certificates to this edition stop being valid (ISO date); certification bodies confirm the exact date. */
  transitionEnds: string | null;
  /** The stage of a revision in progress ("DIS", "FDIS"). */
  revisionStage: string | null;
  /** When the next edition is expected ("2027"). */
  revisionExpected: string | null;
  /** What the status means for a workspace, our own words. */
  statusNote: string | null;
  /** When someone last checked the status against the publisher and certification bodies (ISO date). */
  statusCheckedOn: string;
}

/** The keys of EditionInfo: left out of a framework's content hash. */
export const EDITION_KEYS = [
  'status',
  'supersededBy',
  'transitionEnds',
  'revisionStage',
  'revisionExpected',
  'statusNote',
  'statusCheckedOn',
] as const satisfies readonly (keyof EditionInfo)[];

export interface Requirement {
  /** The reference number as the framework prints it: "A.5.1", "6.1.2", "Art. 33", "Art. 21(2)(a)". */
  ref: string;
  /** The ref of the requirement it sits under; null for a top-level one. */
  parent: string | null;
  kind: RequirementKind;
  /** Order within the framework (0 based, as listed). */
  position: number;
  /** The short title: the official clause, control or article heading, or our own words (docs/12 Licensing). */
  title: string;
  /** Why it exists, one sentence in our own words. */
  purpose: string | null;
  /** What good looks like in practice, our own words. */
  guidance: string | null;
  /** Questions an auditor would ask, our own words. */
  questions: string[];
  /** Typical evidence records, our own words. */
  evidence: string[];
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
  /**
   * The library pack's key when it is not `framework-<key>`: a second edition of a framework needs its own
   * (`framework-<key>-<version>`), so both editions can be adopted side by side.
   */
  packKey?: string;
  /** A statement of applicability: a saved Table view of the refs that start with `refStartsWith`. */
  soa?: { name: string; refStartsWith: string };
}

export interface Framework extends EditionInfo {
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
  titles: TitlesPolicy;
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
