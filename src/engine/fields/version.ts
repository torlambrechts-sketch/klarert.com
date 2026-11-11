import { z } from 'zod';
import { base, cmpNumber, emptyLast, isBlank } from './helpers';

export type VersionConfig = Record<string, never>;

const VERSION = /^v\d+\.\d+$/;

function parts(v: string): [number, number] {
  const [maj, min] = v.slice(1).split('.').map(Number) as [number, number];
  return [maj, min];
}

function normalizeVersion(input: unknown): string | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    input = Number.isInteger(input) ? `${input}.0` : String(input);
  }
  if (typeof input !== 'string') return null;
  const m = input.trim().match(/^(?:v(?:ersion)?\s*)?(\d+)(?:\.(\d+))?$/i);
  if (!m) return null;
  return `v${Number(m[1])}.${Number(m[2] ?? 0)}`;
}

/** Numeric order: v1.10 sorts after v1.9. */
export function compareVersions(a: string, b: string): number {
  const [am, an] = parts(a);
  const [bm, bn] = parts(b);
  return cmpNumber(am, bm) || cmpNumber(an, bn);
}

/** The raise_version action (docs/04): v1.2 → v1.3 (minor) or v2.0 (major); empty → v1.0. */
export function raiseVersion(v: string | null, kind: 'minor' | 'major'): string {
  if (!v || !VERSION.test(v)) return 'v1.0';
  const [maj, min] = parts(v);
  return kind === 'major' ? `v${maj + 1}.0` : `v${maj}.${min + 1}`;
}

export const version = base<string, VersionConfig>({
  id: 'version',
  label: 'Version',
  family: 'compliance',
  description: 'A document version such as v1.2.',
  storage: 'values',
  kind: 'text',
  valueSchema: z.string().regex(VERSION),
  configSchema: z.object({}) as unknown as z.ZodType<VersionConfig>,
  defaultConfig: () => ({}),
  defaultWidth: 90,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed'],
  normalize: (input) => normalizeVersion(input),
  parseText: (t) => normalizeVersion(t),
  isEmpty: (v) => isBlank(v),
  toText: (v) => v ?? '',
  compare: (a, b) => emptyLast(a, b, isBlank, compareVersions),
});
