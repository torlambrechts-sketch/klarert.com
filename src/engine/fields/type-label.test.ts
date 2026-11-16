// A field type conversion logs "Field type changed to <label>" through convert_item_value (0069), which accepts only
// a type's name. Every type's label must pass its pattern, or converting to that type would fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIELD_TYPES } from './registry';

const sql = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '0069_field_conversion_note.sql'),
  'utf8',
);

describe('convert_item_value accepts every field type label', () => {
  it('the SQL pattern takes each label and refuses free text', () => {
    const m = /p_type_label !~ '([^']+)'/.exec(sql);
    expect(m).not.toBeNull();
    const re = new RegExp(m![1]!);
    for (const t of Object.values(FIELD_TYPES)) expect(re.test(t.label), t.label).toBe(true);
    expect(re.test('date')).toBe(false);
    expect(re.test(`Date${'x'.repeat(40)}`)).toBe(false);
    expect(re.test('Date. Sam was late again; see note')).toBe(false);
  });
});
