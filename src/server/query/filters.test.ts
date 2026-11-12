// The SQL builder per operator, checked against the engine: every condition must select exactly the items
// matches() selects. Runs the real filter_item_ids from the migration in PGlite (Postgres in WASM).
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matches, OPERATORS } from '@/engine/conditions';
import { FIELD_TYPES } from '@/engine/fields/registry';
import { installFieldTypes } from '@/engine/fields/resolve';
import { makeCtx, makeField, makeFile, makeItem } from '@/engine/testing/fixtures';
import type { Condition, Field, Item } from '@/engine/types';
import { buildFilterSql } from './filters';

installFieldTypes(Object.values(FIELD_TYPES));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SHEET = uuid(9000);
const G_OPEN = uuid(9001);
const G_DONE = uuid(9002);

const f = {
  title: makeField('text', {}, { id: uuid(1), key: 'title', position: 'a0' }),
  status: makeField('status', FIELD_TYPES.status.defaultConfig(), {
    id: uuid(2),
    key: 'status',
    position: 'a1',
  }),
  cost: makeField(
    'number',
    { unit: '', decimals: 2 },
    { id: uuid(3), key: 'cost', position: 'a2' },
  ),
  due: makeField('date', { relative: true }, { id: uuid(4), key: 'due', position: 'a3' }),
  severity: makeField('severity', FIELD_TYPES.severity.defaultConfig(), {
    id: uuid(5),
    key: 'severity',
    position: 'a4',
  }),
  tags: makeField(
    'multiselect',
    {
      options: [
        { id: 'opt_a', label: 'Safety', color: 'red' },
        { id: 'opt_b', label: 'Quality', color: 'blue' },
      ],
    },
    { id: uuid(6), key: 'tags', position: 'a5' },
  ),
  owner: makeField('people', { multiple: true }, { id: uuid(7), key: 'owner', position: 'a6' }),
  approved: makeField('check', {}, { id: uuid(8), key: 'approved', position: 'a7' }),
  related: makeField(
    'link',
    { targetSheetId: SHEET, multiple: true, inverseFieldId: null },
    { id: uuid(9), key: 'related', position: 'a8' },
  ),
  evidence: makeField(
    'evidence',
    { validDays: 365, multiple: true, accept: [] },
    { id: uuid(10), key: 'evidence', position: 'a9' },
  ),
  period: makeField('timeline', {}, { id: uuid(11), key: 'period', position: 'b0' }),
  answer: makeField('yesno', { allowNA: true }, { id: uuid(12), key: 'answer', position: 'b1' }),
  level: makeField('maturity', {}, { id: uuid(13), key: 'level', position: 'b2' }),
  score: makeField(
    'formula',
    { expr: '{cost} * 2', result: 'number' },
    { id: uuid(14), key: 'score', position: 'b3' },
  ),
};
const fields = Object.values(f);
const statusOpts = FIELD_TYPES.status.defaultConfig().options;
const working = statusOpts.find((o) => o.label === 'Working on it')!.id;
const done = statusOpts.find((o) => o.done)!.id;
const sevOpts = FIELD_TYPES.severity.defaultConfig().options;

const items: Item[] = [
  makeItem(
    {
      [f.title.id]: 'Fix the Guard rail',
      [f.status.id]: working,
      [f.cost.id]: 120,
      [f.due.id]: '2026-11-05',
      [f.severity.id]: sevOpts[2]!.id,
      [f.tags.id]: ['opt_a', 'opt_b'],
      [f.owner.id]: ['u-maria'],
      [f.approved.id]: true,
      [f.period.id]: { start: '2026-11-01', end: '2026-11-20' },
      [f.answer.id]: 'yes',
      [f.level.id]: 3,
    },
    { id: uuid(101), name: 'Guard rail', displayId: 'CA-001', groupId: G_OPEN, position: 'a0' },
  ),
  makeItem(
    {
      [f.title.id]: 'calibrate scale',
      [f.status.id]: done,
      [f.cost.id]: 40,
      [f.due.id]: '2026-11-01',
      [f.severity.id]: sevOpts[0]!.id,
      [f.tags.id]: ['opt_b'],
      [f.owner.id]: ['u-james', 'u-maria'],
      [f.period.id]: { start: '2026-10-01', end: '2026-11-11' },
      [f.answer.id]: 'na',
      [f.level.id]: 1,
    },
    { id: uuid(102), name: 'Scale', displayId: 'CA-002', groupId: G_DONE, position: 'a1' },
  ),
  makeItem(
    {
      [f.cost.id]: 0,
      [f.due.id]: '2026-11-25',
      [f.owner.id]: ['u-james'],
      [f.approved.id]: false,
    },
    {
      id: uuid(103),
      name: "Eye-wash 'station'",
      displayId: 'CA-003',
      groupId: G_OPEN,
      position: 'a2',
    },
  ),
  makeItem(
    {},
    { id: uuid(104), name: 'Empty one', displayId: 'CA-004', groupId: G_OPEN, position: 'a3' },
  ),
];
const links = {
  [`${uuid(101)}:${f.related.id}`]: [uuid(102)],
  [`${uuid(102)}:${f.related.id}`]: [uuid(101), uuid(103)],
};
const files = [
  makeFile({ itemId: uuid(101), fieldId: f.evidence.id, validUntil: '2027-01-01' }),
  makeFile({ itemId: uuid(103), fieldId: f.evidence.id, validUntil: '2026-11-01' }),
];
const ctx = makeCtx({ fields, items, links, files });

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table items (id uuid primary key, sheet_id uuid, group_id uuid, name text, display_id text,
                        "values" jsonb, position text, archived_at timestamptz);
    create table item_links (field_id uuid, from_item uuid, to_item uuid);
    create table files (field_id uuid, item_id uuid, replaced_by uuid, valid_until date);
  `);
  const migration = fs.readFileSync('supabase/migrations/0009_views_forms.sql', 'utf8');
  const fn = migration.match(/create or replace function filter_item_ids[\s\S]*?end \$\$;/)![0];
  await db.exec(fn);
  for (const it of items)
    await db.query('insert into items values ($1, $2, $3, $4, $5, $6, $7, null)', [
      it.id,
      SHEET,
      it.groupId,
      it.name,
      it.displayId,
      JSON.stringify(it.values),
      it.position,
    ]);
  for (const [k, to] of Object.entries(links)) {
    const [from, field] = k.split(':');
    for (const t of to)
      await db.query('insert into item_links values ($1, $2, $3)', [field, from, t]);
  }
  for (const file of files)
    await db.query('insert into files values ($1, $2, null, $3)', [
      file.fieldId,
      file.itemId,
      file.validUntil,
    ]);
}, 30_000);

afterAll(async () => {
  await db?.close();
});

async function run(conds: Condition[]) {
  const built = buildFilterSql(conds, ctx);
  const r = await db.query<{ ids: string[] }>('select filter_item_ids($1, $2, $3) as ids', [
    SHEET,
    built.where,
    JSON.stringify(built.params),
  ]);
  return { built, ids: [...r.rows[0]!.ids].sort() };
}

const engine = (c: Condition) =>
  items
    .filter((it) => matches(c, it, ctx))
    .map((it) => it.id)
    .sort();

const cases: [string, Condition[]][] = [
  [
    'text',
    [
      { fieldKey: 'title', op: 'is', value: 'CALIBRATE SCALE' },
      { fieldKey: 'title', op: 'is_not', value: 'calibrate scale' },
      { fieldKey: 'title', op: 'contains', value: 'guard' },
      { fieldKey: 'title', op: 'not_contains', value: 'guard' },
      { fieldKey: 'title', op: 'starts_with', value: 'fix' },
      { fieldKey: 'title', op: 'is_empty' },
      { fieldKey: 'title', op: 'is_not_empty' },
      { fieldKey: '__name', op: 'contains', value: "'station'" },
      { fieldKey: '__id', op: 'is', value: 'ca-002' },
    ],
  ],
  [
    'number',
    [
      { fieldKey: 'cost', op: 'eq', value: 40 },
      { fieldKey: 'cost', op: 'neq', value: 40 },
      { fieldKey: 'cost', op: 'gt', value: 40 },
      { fieldKey: 'cost', op: 'gte', value: '40' },
      { fieldKey: 'cost', op: 'lt', value: 40 },
      { fieldKey: 'cost', op: 'lte', value: 40 },
      { fieldKey: 'cost', op: 'between', value: [100, 0] },
      { fieldKey: 'cost', op: 'gt', value: 'lots' },
      { fieldKey: 'cost', op: 'is_empty' },
      { fieldKey: 'cost', op: 'is_not_empty' },
    ],
  ],
  [
    'date',
    [
      { fieldKey: 'due', op: 'is', value: '2026-11-01' },
      { fieldKey: 'due', op: 'before', value: 'today' },
      { fieldKey: 'due', op: 'after', value: '2026-11-05' },
      { fieldKey: 'due', op: 'on_or_before', value: '2026-11-05' },
      { fieldKey: 'due', op: 'on_or_after', value: '2026-11-05' },
      { fieldKey: 'due', op: 'between', value: ['2026-11-30', '2026-11-02'] },
      { fieldKey: 'due', op: 'is_today' },
      { fieldKey: 'due', op: 'next_days', value: 14 },
      { fieldKey: 'due', op: 'last_days', value: 7 },
      { fieldKey: 'due', op: 'overdue' },
      { fieldKey: 'due', op: 'is_empty' },
      { fieldKey: 'due', op: 'is_not_empty' },
    ],
  ],
  [
    'daterange',
    [
      { fieldKey: 'period', op: 'is_today' },
      { fieldKey: 'period', op: 'after', value: '2026-11-15' },
      { fieldKey: 'period', op: 'overdue' },
      { fieldKey: 'period', op: 'is_empty' },
    ],
  ],
  [
    'option',
    [
      { fieldKey: 'status', op: 'is_any_of', value: [working, done] },
      { fieldKey: 'status', op: 'is_none_of', value: [working] },
      { fieldKey: 'status', op: 'is_done' },
      { fieldKey: 'status', op: 'is_not_done' },
      { fieldKey: 'status', op: 'is_empty' },
      { fieldKey: 'status', op: 'is_not_empty' },
      { fieldKey: 'answer', op: 'is_any_of', value: ['yes'] },
      { fieldKey: '__group', op: 'is_any_of', value: [G_DONE] },
      { fieldKey: '__group', op: 'is_none_of', value: [G_DONE] },
    ],
  ],
  [
    'ordered',
    [
      { fieldKey: 'severity', op: 'at_least', value: sevOpts[1]!.id },
      { fieldKey: 'severity', op: 'at_most', value: sevOpts[1]!.id },
      { fieldKey: 'severity', op: 'is_any_of', value: [sevOpts[0]!.id] },
      { fieldKey: 'level', op: 'at_least', value: 2 },
      { fieldKey: 'level', op: 'is_empty' },
    ],
  ],
  [
    'multi',
    [
      { fieldKey: 'tags', op: 'has_any_of', value: ['opt_a'] },
      { fieldKey: 'tags', op: 'has_all_of', value: ['opt_a', 'opt_b'] },
      { fieldKey: 'tags', op: 'has_none_of', value: ['opt_a'] },
      { fieldKey: 'tags', op: 'is_empty' },
      { fieldKey: 'tags', op: 'is_not_empty' },
    ],
  ],
  [
    'people',
    [
      { fieldKey: 'owner', op: 'includes_any_of', value: ['u-james'] },
      { fieldKey: 'owner', op: 'includes_me' },
      { fieldKey: 'owner', op: 'excludes', value: ['me'] },
      { fieldKey: 'owner', op: 'is_empty' },
    ],
  ],
  [
    'boolean',
    [
      { fieldKey: 'approved', op: 'is_checked' },
      { fieldKey: 'approved', op: 'is_not_checked' },
    ],
  ],
  [
    'link',
    [
      { fieldKey: 'related', op: 'has_any' },
      { fieldKey: 'related', op: 'has_none' },
      { fieldKey: 'related', op: 'includes_item', value: uuid(103) },
      { fieldKey: 'related', op: 'count_gt', value: 1 },
      { fieldKey: 'related', op: 'count_lt', value: 2 },
    ],
  ],
  [
    'file',
    [
      { fieldKey: 'evidence', op: 'has_files' },
      { fieldKey: 'evidence', op: 'has_none' },
    ],
  ],
];

describe('buildFilterSql agrees with the engine', () => {
  for (const [kind, conds] of cases) {
    for (const c of conds) {
      it(`${kind} ${c.fieldKey} ${c.op} ${JSON.stringify(c.value ?? '')}`, async () => {
        const { built, ids } = await run([c]);
        expect(built.clientOnly).toEqual([]);
        expect(ids).toEqual(engine(c));
      });
    }
  }

  it('covers every operator of the kinds SQL can read', () => {
    const tested = new Set(cases.flatMap(([, cs]) => cs.map((c) => `${c.op}`)));
    for (const kind of [
      'text',
      'number',
      'date',
      'option',
      'ordered',
      'multi',
      'people',
      'boolean',
    ] as const)
      for (const op of OPERATORS[kind]) expect(tested, `${kind} ${op}`).toContain(op);
  });

  it('ANDs several conditions', async () => {
    const conds: Condition[] = [
      { fieldKey: 'status', op: 'is_not_done' },
      { fieldKey: 'cost', op: 'gte', value: 0 },
    ];
    const { ids } = await run(conds);
    expect(ids).toEqual(
      items
        .filter((it) => conds.every((c) => matches(c, it, ctx)))
        .map((i) => i.id)
        .sort(),
    );
  });
});

describe('buildFilterSql safety and fallbacks', () => {
  it('never puts values in the SQL text', () => {
    const evil = "x'); drop table items; --";
    const built = buildFilterSql(
      [
        { fieldKey: 'title', op: 'contains', value: evil },
        { fieldKey: 'status', op: 'is_any_of', value: [evil] },
        { fieldKey: 'cost', op: 'gt', value: 5 },
      ],
      ctx,
    );
    expect(built.where).not.toContain('drop');
    expect(built.where).not.toContain(' 5');
    expect(built.params).toEqual([evil, [evil], 5]);
    expect(built.where).toContain(`i.values->>'${f.title.id}'`);
  });

  it('keeps calculated columns and file freshness for the client', () => {
    const conds: Condition[] = [
      { fieldKey: 'score', op: 'gt', value: 10 },
      { fieldKey: 'evidence', op: 'freshness_is', value: 'expired' },
      { fieldKey: 'cost', op: 'gt', value: 10 },
    ];
    const built = buildFilterSql(conds, ctx);
    expect(built.clientOnly).toEqual([conds[0], conds[1]]);
    expect(built.params).toEqual([10]);
  });

  it('drops invalid conditions and returns true for none', () => {
    expect(buildFilterSql([], ctx).where).toBe('true');
    expect(buildFilterSql([{ fieldKey: 'gone', op: 'is', value: 'x' }], ctx).where).toBe('true');
    expect(buildFilterSql([{ fieldKey: 'cost', op: 'contains', value: 'x' }], ctx).where).toBe(
      'true',
    );
  });

  it('refuses clauses the builder would not write', async () => {
    for (const where of [
      'true) or (select pg_sleep(1)) is null or (true',
      "i.name = 'Scale'",
      'true; delete from items',
      'i.name = $2',
      'true -- comment',
      `exists (select 1 from items x)`,
    ]) {
      await expect(
        db.query('select filter_item_ids($1, $2, $3)', [SHEET, where, '[]']),
      ).rejects.toThrow(/bad filter/);
    }
  });

  it('accepts the clauses the builder writes for every case at once', async () => {
    const all = cases.flatMap(([, cs]) => cs);
    const { built, ids } = await run(all);
    expect(built.clientOnly).toEqual([]);
    expect(ids).toEqual(
      items
        .filter((it) => all.every((c) => matches(c, it, ctx)))
        .map((i) => i.id)
        .sort(),
    );
  });

  it('typed fields keep their own ids', () => {
    const field: Field = f.cost;
    expect(buildFilterSql([{ fieldKey: 'cost', op: 'eq', value: 1 }], ctx).where).toContain(
      field.id,
    );
  });
});
