// What a public form shows of a field's config (docs/02 §16, security review 9.1 item 5): an allow-list per field type,
// kept as data on each type (`publicConfigKeys`). The database applies the same lists in `_public_field_config`
// (migration 0066) when `get_public_form` answers a signed-out visitor; public-config.test.ts checks that the SQL list
// is exactly `publicConfigSql()`, so the two cannot drift. Unknown types and unknown keys are never shown. Pure.
import { FIELD_TYPES } from './registry';
import type { AnyFieldType } from './types';
import { PUBLIC_HIDDEN_TYPES } from './view-support';

/** Types a public form may show: form types filled in through the values, not files and not the directory. */
export function isPublicFormType(def: AnyFieldType): boolean {
  return def.formAllowed && def.storage === 'values' && !PUBLIC_HIDDEN_TYPES.has(def.id);
}

/** Type id → the config keys a public form may show, for every type a public form may show, sorted by type id. */
export function publicConfigKeys(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const def of Object.values(FIELD_TYPES) as AnyFieldType[])
    if (isPublicFormType(def)) out[def.id] = [...(def.publicConfigKeys ?? [])].sort();
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** A field's config as a public form gets it: only the keys its type allows, `{}` for any other type. */
export function publicFieldConfig(type: string, config: unknown): Record<string, unknown> {
  const keys = publicConfigKeys()[type];
  if (!keys || !config || typeof config !== 'object' || Array.isArray(config)) return {};
  const c = config as Record<string, unknown>;
  return Object.fromEntries(keys.filter((k) => k in c).map((k) => [k, c[k]]));
}

/**
 * The JSON literal 0066 holds between its `public-config-keys` markers: one type per line, so a diff shows which
 * type changed. A new public type or key means a new migration that redefines `_public_field_config` with this text.
 */
export function publicConfigSql(): string {
  const lines = Object.entries(publicConfigKeys()).map(
    ([t, keys]) => `  ${JSON.stringify(t)}: ${JSON.stringify(keys)}`,
  );
  return `{\n${lines.join(',\n')}\n}`;
}
