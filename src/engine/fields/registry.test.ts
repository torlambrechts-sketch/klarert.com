import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIELD_TYPE_IDS, FIELD_TYPES } from './registry';

const sql = readFileSync(
  new URL('../../../supabase/migrations/0001_core.sql', import.meta.url),
  'utf8',
);
const block = sql.slice(
  sql.indexOf('create or replace function field_types()'),
  sql.indexOf(']::text[]'),
);
const sqlIds = [...block.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
const nonValue = sql.slice(sql.indexOf('create or replace function non_value_types()'));
const nonValueIds = [
  ...nonValue.slice(0, nonValue.indexOf(']::text[]')).matchAll(/'([a-z]+)'/g),
].map((m) => m[1]);

describe('field type registry', () => {
  it('has exactly the 57 ids of field_types() in SQL, in the same order', () => {
    expect(sqlIds).toHaveLength(57);
    expect(FIELD_TYPE_IDS).toEqual(sqlIds);
  });

  it('every def carries its own id', () => {
    for (const [id, def] of Object.entries(FIELD_TYPES)) expect(def.id).toBe(id);
  });

  it('families add up to 18 + 10 + 19 + 10', () => {
    const count = (f: string) => Object.values(FIELD_TYPES).filter((d) => d.family === f).length;
    expect([count('basic'), count('choice'), count('compliance'), count('computed')]).toEqual([
      18, 10, 19, 10,
    ]);
  });

  it('types not stored in items.values match non_value_types() in SQL', () => {
    const notInValues = Object.values(FIELD_TYPES)
      .filter((d) => d.storage !== 'values')
      .map((d) => d.id)
      .sort();
    expect(notInValues).toEqual([...nonValueIds].sort());
  });

  it('flags match docs/03 (form, kanban, calendar)', () => {
    const ids = (pred: (d: (typeof FIELD_TYPES)[keyof typeof FIELD_TYPES]) => boolean) =>
      Object.values(FIELD_TYPES)
        .filter(pred)
        .map((d) => d.id)
        .sort();
    expect(ids((d) => !d.formAllowed)).toEqual(
      [
        'lookup',
        'rollup',
        'formula',
        'progress',
        'autoid',
        'meta',
        'workflowstep',
        'button',
        'ai',
        'clock',
        'signature',
        'ack',
      ].sort(),
    );
    expect(ids((d) => d.kanbanCapable)).toEqual(
      [
        'status',
        'dropdown',
        'severity',
        'classification',
        'finding',
        'workflowstep',
        'yesno',
        'maturity',
        'people',
      ].sort(),
    );
    expect(ids((d) => d.calendarCapable)).toEqual(
      ['date', 'datetime', 'timeline', 'recurrence', 'evidence', 'clock', 'retention'].sort(),
    );
  });

  it('every default config passes its own schema', () => {
    for (const def of Object.values(FIELD_TYPES)) {
      expect(def.configSchema.safeParse(def.defaultConfig()).success, def.id).toBe(true);
    }
  });
});
