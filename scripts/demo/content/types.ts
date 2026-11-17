// The demo's content format: items by sheet name, values by field key (option labels, people's names, dates from
// the demo clock), links by reference. Pure data; scripts/demo/build.ts writes it through the app's commands.
import type { PersonRef } from '../people';

/** A reference to another item: `req:<framework>@<version>#<ref>` (a library requirement) or `item:<sheet>#<name>`. */
export type Ref = string;

export const req = (fw: string, ref: string): Ref => `req:${fw}#${ref}`;
export const q15 = (ref: string) => req('iso-9001@2015', ref);
export const q26 = (ref: string) => req('iso-9001@2026', ref);
export const isms = (ref: string) => req('iso-27001@2022', ref);
export const env26 = (ref: string) => req('iso-14001@2026', ref);
export const ohs = (ref: string) => req('iso-45001@2018', ref);
export const gdpr = (ref: string) => req('gdpr@2016', ref);
export const nis2 = (ref: string) => req('nis2@2022', ref);
export const item = (sheet: string, name: string): Ref => `item:${sheet}#${name}`;

export interface Step {
  /** Who makes the change. */
  by: PersonRef;
  values: Record<string, unknown>;
  /** A comment, for status rules that ask for one. */
  note?: string;
}

export interface DemoFile {
  field: string | null;
  name: string;
  /** Lines of the fictional document. */
  lines: string[];
  validUntil?: string | null;
  description?: string;
}

export interface DemoItem {
  name: string;
  group?: string;
  /** Who adds it (the item.created entry). */
  by: PersonRef;
  values?: Record<string, unknown>;
  links?: Record<string, Ref[]>;
  /** Later changes, in order: the item's history in its activity log. */
  steps?: Step[];
  files?: DemoFile[];
  /** Updates posted on the item. */
  comments?: { by: PersonRef; body: string }[];
  /** Submit to the sheet's approval workflow (by, then decisions in order). */
  approval?: {
    workflow: string;
    by: PersonRef;
    decisions?: { by: PersonRef; decision: 'approved' | 'rejected'; comment?: string }[];
  };
}

export interface DemoSheet {
  sheet: string;
  items: DemoItem[];
}
