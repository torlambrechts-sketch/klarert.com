// Pack versions (docs/11): major.minor.patch, and the few range forms `requires` may use. Pure.

export const SEMVER = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;
/** 1.2.3, ^1.2.3, ~1.2.3, >=1.2.3 or * */
export const SEMVER_RANGE = /^(\*|(\^|~|>=)?\d{1,6}\.\d{1,6}\.\d{1,6})$/;

type V = [number, number, number];

export function parseVersion(v: string): V | null {
  const m = v.match(SEMVER);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a) ?? [0, 0, 0];
  const y = parseVersion(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
}

/** Does `version` satisfy `range`? ^ keeps the major (the minor below 1.0.0), ~ keeps the minor. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v || !SEMVER_RANGE.test(range)) return false;
  if (range === '*') return true;
  const op = range.startsWith('>=') ? '>=' : range[0] === '^' || range[0] === '~' ? range[0] : '=';
  const base = range.replace(/^(>=|\^|~)/, '');
  const b = parseVersion(base)!;
  const cmp = compareVersions(version, base);
  if (op === '=') return cmp === 0;
  if (cmp < 0) return false;
  if (op === '>=') return true;
  if (op === '~') return v[0] === b[0] && v[1] === b[1];
  return b[0] > 0 ? v[0] === b[0] : v[0] === 0 && v[1] === b[1];
}
