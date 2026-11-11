// Lets computed types (lookup, rollup, progress, clock …) reach other field types without importing the
// registry, which imports them (a cycle). The registry installs itself here; tests may install a partial map.
import type { AnyFieldType } from './types';

let table: ReadonlyMap<string, AnyFieldType> = new Map();

export function installFieldTypes(types: Iterable<AnyFieldType>) {
  table = new Map([...types].map((t) => [t.id, t]));
}

export function resolveFieldType(id: string): AnyFieldType | undefined {
  return table.get(id);
}
