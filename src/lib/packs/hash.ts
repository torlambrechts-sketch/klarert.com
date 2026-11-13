// The catalogue hash of a manifest (packs.hash): sha-256 of its canonical JSON (keys sorted at every level), so the
// same manifest hashes the same however it was written or stored. Server and scripts only.
import { createHash } from 'node:crypto';

export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v as object)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

export const packHash = (manifest: unknown) =>
  createHash('sha256').update(canonicalJson(manifest)).digest('hex');
