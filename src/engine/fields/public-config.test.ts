// The public form allow-list (security review 9.1 item 5): the registry's lists and the SQL in the newest migration
// that defines `_public_field_config` must be the same, and the lists never let an internal key through.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIELD_TYPES } from './registry';
import type { AnyFieldType } from './types';
import {
  isPublicFormType,
  publicConfigKeys,
  publicConfigSql,
  publicFieldConfig,
} from './public-config';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

/** The JSON between the markers of the newest migration that holds them. */
function sqlList(): { file: string; json: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files.reverse()) {
    const src = readFileSync(join(MIGRATIONS, file), 'utf8');
    const m =
      /-- public-config-keys:begin\n\$json\$([\s\S]*?)\$json\$\n-- public-config-keys:end/.exec(
        src,
      );
    if (m) return { file, json: m[1]! };
  }
  throw new Error('no migration holds the public config keys');
}

/** The keys a type's config schema (or default config) knows. */
function schemaKeys(def: AnyFieldType): string[] {
  const s = def.configSchema as unknown as { shape?: Record<string, unknown> };
  return [...new Set([...Object.keys(s.shape ?? {}), ...Object.keys(def.defaultConfig() ?? {})])];
}

// the 0062 deny-list: internal ids, formulas, rules and people; none of them may be on an allow-list
const INTERNAL = [
  'allowedUserIds',
  'targetSheetId',
  'inverseFieldId',
  'expr',
  'formula',
  'personalData',
  'audience',
  'versionFieldKey',
  'sourceFieldKey',
  'linkFieldKey',
  'lookupFieldKey',
  'rollupFieldKey',
  'stopFieldKey',
  'startFieldKey',
  'sheetId',
  'fieldKey',
  'filter',
  'conditions',
  'rules',
  'validDays',
  'notify',
  'userIds',
  'teamIds',
  'jobRoleIds',
];

describe('public form config allow-list', () => {
  it('the SQL list is exactly the registry list (regenerate it with publicConfigSql in a new migration)', () => {
    const { file, json } = sqlList();
    expect(json, `update ${file}: paste publicConfigSql() between the markers`).toBe(
      publicConfigSql(),
    );
    expect(JSON.parse(json)).toEqual(publicConfigKeys());
  });

  it('every type a public form may show declares its list; no other type does', () => {
    for (const def of Object.values(FIELD_TYPES) as AnyFieldType[]) {
      if (isPublicFormType(def))
        expect(def.publicConfigKeys, `${def.id} must declare publicConfigKeys`).toBeDefined();
      else expect(def.publicConfigKeys, `${def.id} is never on a public form`).toBeUndefined();
    }
  });

  it('lists only keys the type knows, and never an internal one', () => {
    for (const [type, keys] of Object.entries(publicConfigKeys())) {
      const def = (FIELD_TYPES as Record<string, AnyFieldType>)[type]!;
      for (const k of keys) {
        expect(schemaKeys(def), `${type}.${k}`).toContain(k);
        expect(INTERNAL, `${type}.${k}`).not.toContain(k);
      }
    }
  });

  it('leaves out the directory, files, links and computed types', () => {
    const keys = publicConfigKeys();
    for (const t of ['people', 'team', 'role', 'entity', 'evidence', 'attachment', 'link'])
      expect(keys[t]).toBeUndefined();
    for (const t of ['requirement', 'controllink', 'protected', 'formula', 'lookup', 'signature'])
      expect(keys[t]).toBeUndefined();
    expect(keys.status).toEqual(['options']);
  });

  it('publicFieldConfig keeps allowed keys only; unknown types and odd configs give {}', () => {
    expect(
      publicFieldConfig('status', {
        options: [{ id: 'o1', label: 'Open', color: 'grey' }],
        personalData: true,
        somethingNew: 'x',
      }),
    ).toEqual({ options: [{ id: 'o1', label: 'Open', color: 'grey' }] });
    expect(publicFieldConfig('number', { unit: 'kg', decimals: 1, secret: 1 })).toEqual({
      unit: 'kg',
      decimals: 1,
    });
    expect(publicFieldConfig('link', { targetSheetId: 's', multiple: true })).toEqual({});
    expect(publicFieldConfig('no-such-type', { a: 1 })).toEqual({});
    expect(publicFieldConfig('number', [1, 2])).toEqual({});
    expect(publicFieldConfig('number', null)).toEqual({});
  });
});
