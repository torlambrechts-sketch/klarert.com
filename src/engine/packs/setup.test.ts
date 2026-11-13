import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { makeCtx, makeField, makeItem, sheet } from '../testing/fixtures';
import { ruleProgress, setupProgress, type SetupSource } from './setup';
import type { PackSetup } from './types';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const status = makeField(
  'status',
  {
    options: [
      { id: 'opt_draft', label: 'Draft', color: 'grey' },
      { id: 'opt_ok', label: 'Approved', color: 'green', done: true },
    ],
  },
  { key: 'status' },
);
const kind = makeField(
  'dropdown',
  {
    options: [
      { id: 'opt_scope', label: 'Scope', color: 'navy' },
      { id: 'opt_issue', label: 'Issue', color: 'blue' },
    ],
  },
  { key: 'kind' },
);
const owner = makeField('people', { multiple: false }, { key: 'owner' });

const source = (items: ReturnType<typeof makeItem>[]): SetupSource => {
  const fields = [status, kind, owner];
  return {
    sheet,
    items,
    ctx: makeCtx({ fields, items }),
    viewId: (name) => (name === 'Board' ? 'v-board' : null),
  };
};

describe('ruleProgress', () => {
  it('counts the matching items against at least min', () => {
    const items = [
      makeItem({ [owner.id]: ['u-maria'] }),
      makeItem({ [owner.id]: ['u-maria'] }),
      makeItem({}),
    ];
    const all = [{ fieldKey: 'owner', op: 'is_not_empty' }];
    // 2 of 3 items have an owner
    expect(ruleProgress({ all }, source(items))).toEqual({ progress: 2 / 3, matched: 2, of: 3 });
    // 2 of at least 5
    expect(ruleProgress({ all, min: 5 }, source(items))).toEqual({
      progress: 0.4,
      matched: 2,
      of: 5,
    });
    // only the items `where` picks are counted
    const scoped = ruleProgress(
      {
        where: [{ fieldKey: 'kind', op: 'is_any_of', value: ['opt_scope'] }],
        all: [{ fieldKey: 'status', op: 'is_done' }],
      },
      source([
        makeItem({ [kind.id]: 'opt_scope', [status.id]: 'opt_ok' }),
        makeItem({ [kind.id]: 'opt_issue', [status.id]: 'opt_draft' }),
      ]),
    );
    expect(scoped).toEqual({ progress: 1, matched: 1, of: 1 });
  });

  it('is not started when the sheet cannot be read or is empty', () => {
    expect(ruleProgress({ min: 3 }, undefined)).toEqual({ progress: 0, matched: 0, of: 3 });
    expect(ruleProgress({}, source([]))).toEqual({ progress: 0, matched: 0, of: 1 });
  });
});

describe('setupProgress', () => {
  const setup: PackSetup = {
    title: 'Setup',
    description: 'Two steps.',
    steps: [
      {
        ref: 'one',
        title: 'Agree the scope',
        body: 'Own words.',
        target: { sheetRef: 'scope', view: 'Board' },
        rules: [{ sheetRef: 'scope', all: [{ fieldKey: 'status', op: 'is_done' }] }],
      },
      {
        ref: 'two',
        title: 'List your assets',
        body: 'Full.',
        target: { sheetRef: 'asset' },
        rules: [{ sheetRef: 'asset', min: 2 }],
        levels: {
          starter: {
            title: 'List your processes',
            body: 'Starter.',
            target: { sheetRef: 'scope' },
          },
        },
      },
    ],
  };
  const scope = source([makeItem({ [status.id]: 'opt_ok' })]);
  const asset = source([makeItem({})]);

  it('works out each step and the whole from the data', () => {
    const p = setupProgress(setup, 'full', (t) =>
      t.sheetRef === 'scope' ? scope : t.sheetRef === 'asset' ? asset : undefined,
    );
    expect(p.steps.map((s) => [s.number, s.title, s.progress, s.done, s.detail])).toEqual([
      [1, 'Agree the scope', 1, true, '1 of 1'],
      [2, 'List your assets', 0.5, false, '1 of 2'],
    ]);
    expect(p.steps[0]!.link).toEqual({
      sheetId: sheet.id,
      sheetName: sheet.name,
      viewId: 'v-board',
    });
    expect(p).toMatchObject({ done: 1, total: 2, percent: 75 });
  });

  it('reads a step as its level words it, and links nowhere when the sheet is missing', () => {
    const p = setupProgress(setup, 'starter', (t) => (t.sheetRef === 'scope' ? scope : undefined));
    expect(p.steps[1]).toMatchObject({
      title: 'List your processes',
      body: 'Starter.',
      progress: 0,
    });
    expect(p.steps[1]!.link?.sheetId).toBe(sheet.id);
    expect(setupProgress(setup, 'full', () => undefined).steps[0]!.link).toBeNull();
  });

  it('is 100 only when every step is done', () => {
    const all = setupProgress(setup, 'full', (t) =>
      t.sheetRef === 'asset' ? source([makeItem({}), makeItem({})]) : scope,
    );
    expect(all.percent).toBe(100);
    expect(all.done).toBe(2);
  });
});
