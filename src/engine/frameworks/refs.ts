// Requirement keys (docs/12): one string names one requirement of one framework version, stable for ever:
// `<framework key>@<version>#<ref>`, e.g. "iso-27001@2022#A.5.1". Library items carry it in items.requirement_ref,
// cross-walks use it, renaming an item never touches it. Pure.
import type { Framework, RequirementId } from './types';

const KEY = /^([a-z0-9][a-z0-9-]{0,39})@([0-9A-Za-z.-]{1,20})#(.{1,40})$/;

export function requirementKey(id: RequirementId): string {
  return `${id.framework}@${id.version}#${id.ref}`;
}

export function parseRequirementKey(key: string): RequirementId | null {
  const m = key.match(KEY);
  return m ? { framework: m[1]!, version: m[2]!, ref: m[3]! } : null;
}

export const isRequirementKey = (v: unknown): v is string =>
  typeof v === 'string' && parseRequirementKey(v) !== null;

/** "27001 A.5.1", "GDPR Art. 32": how a requirement is named in chips. */
export function requirementLabel(shortTitle: string, ref: string): string {
  return `${shortTitle} ${ref}`;
}

/** The framework a key belongs to, `<key>@<version>`. */
export const frameworkId = (f: Pick<Framework, 'key' | 'version'>) => `${f.key}@${f.version}`;

/** The pack a framework's library is shipped as (docs/11): `framework-<key>`, version `<edition>.<revision>.0`. */
export function frameworkPackKey(frameworkKey: string): string {
  return `framework-${frameworkKey}`;
}

export function frameworkPackVersion(f: Pick<Framework, 'version' | 'revision'>): string {
  return `${Number.parseInt(f.version, 10)}.${f.revision}.0`;
}

/** The reference number of a library item ("A.5.1"), or null for any other item. */
export function itemRequirementRef(item: { requirementRef?: string }): string | null {
  return item.requirementRef ? (parseRequirementKey(item.requirementRef)?.ref ?? null) : null;
}
