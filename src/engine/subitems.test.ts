import { describe, expect, it } from 'vitest';
import './fields/registry';
import { planActions, projectToParent, matchTrigger, type AutomationEvent } from './automations';
import { computeRollup, type RollupConfig } from './fields/rollup';
import { makeField, makeFile, makeItem, sheet } from './testing/fixtures';
import {
  CHILD,
  cDue,
  cEvidence,
  childCtx,
  cOwner,
  cSeverity,
  cStatus,
  makeSubitem,
  pStatus,
  pSubitems,
  subitemCtx,
} from './testing/subitems-world';
import {
  allSubitemsDone,
  openSubitems,
  readSubitemSettings,
  subitemLabel,
  subitemProgress,
} from './subitems';
import type { Field, Item } from './types';

const user = { kind: 'user' as const, id: 'u-maria' };
const env = {
  appUrl: 'https://app.test',
  workspace: 'meridian',
  actor: user,
  automation: { id: 'a-1', name: 'Test', trigger: { type: 'item_created' as const } },
  roleHolders: () => [],
};

function world() {
  const parent = makeItem({ [pStatus.id]: 'p_open' }, { id: 'p1', displayId: 'CA-001' });
  const a = makeSubitem(
    parent,
    { [cStatus.id]: 'c_done', [cDue.id]: '2026-12-01', [cSeverity.id]: 'sv_high' },
    { id: 'a', position: 'a1', name: 'Containment' },
  );
  const b = makeSubitem(
    parent,
    { [cStatus.id]: 'c_stuck', [cDue.id]: '2026-11-20', [cSeverity.id]: 'sv_low' },
    { id: 'b', position: 'a2', name: 'Root cause' },
  );
  const c = makeSubitem(
    parent,
    { [cStatus.id]: 'c_doing', [cSeverity.id]: 'sv_med' },
    { id: 'c', position: 'a3', name: 'Correction' },
  );
  return { parent, a, b, c };
}

const rollup = (fn: RollupConfig['fn'], targetFieldKey: string | null) =>
  makeField<RollupConfig>(
    'rollup',
    { linkFieldKey: pSubitems.key, targetFieldKey, fn },
    { id: `r-${fn}` },
  );

describe('sub-item helpers', () => {
  it('count progress and the open ones, and read the settings leniently', () => {
    const { parent, a, b, c } = world();
    const ctx = subitemCtx({ items: [parent, a, b, c] });
    expect(subitemProgress(parent, ctx)).toEqual({ total: 3, done: 1 });
    expect(openSubitems(parent, ctx).map((i) => i.id)).toEqual(['b', 'c']);
    expect(allSubitemsDone(parent, ctx)).toBe(false);
    expect(readSubitemSettings(null)).toEqual({
      label: 'Sub-items',
      blockClose: false,
      lockCascade: false,
      template: [],
    });
    expect(
      readSubitemSettings({ label: 'Clauses', blockClose: true, template: [{ name: '' }] }),
    ).toMatchObject({
      label: 'Clauses',
      blockClose: true,
      template: [],
    });
    expect(subitemLabel({ subitems: readSubitemSettings({ label: 'Test steps' }) }, 1)).toBe(
      'Test step',
    );
    expect(subitemLabel({ subitems: readSubitemSettings({ label: 'Activities' }) }, 1)).toBe(
      'Activity',
    );
  });
});

describe('roll-ups over sub-items', () => {
  const { parent, a, b, c } = world();
  const files = [
    makeFile({ itemId: 'a', fieldId: cEvidence.id, validUntil: '2026-10-01' }),
    makeFile({ itemId: 'b', fieldId: cEvidence.id, validUntil: '2027-10-01' }),
  ];
  const ctx = subitemCtx({ items: [parent, a, b, c], files });
  const run = (f: Field<RollupConfig>) => computeRollup(parent, f, ctx);

  it('count', () => expect(run(rollup('count', null))).toBe(3));
  it('pctDone (the sub-items’ status field)', () => expect(run(rollup('pctDone', null))).toBe(33));
  it('earliest due date', () => expect(run(rollup('earliest', 'due_date'))).toBe('2026-11-20'));
  it('worst status: not done beats done, then the later option', () =>
    expect(run(rollup('worst', 'status'))).toBe('Stuck'));
  it('worst severity: the highest rank', () =>
    expect(run(rollup('worst', 'severity'))).toBe('High'));
  it('evidence expired', () => expect(run(rollup('countExpired', 'evidence'))).toBe(1));
  it('formats the earliest date and the expired count', async () => {
    const { rollup: def } = await import('./fields/rollup');
    expect(def.toText('2026-11-20', rollup('earliest', 'due_date').config, ctx)).toBe(
      '20 Nov 2026',
    );
    expect(def.toText(1, rollup('countExpired', 'evidence').config, ctx)).toBe('1 expired');
    expect(def.effectiveKind!(rollup('earliest', 'due_date'), ctx)).toBe('date');
    expect(def.toDate('2026-11-20', rollup('earliest', 'due_date').config, ctx)).toBe('2026-11-20');
  });
});

describe('sub-item triggers', () => {
  const changed = (child: Item, before: string, after: string): AutomationEvent => ({
    type: 'value.changed',
    sheetId: CHILD,
    itemId: child.id,
    fieldId: cStatus.id,
    before,
    after,
    actor: user,
  });

  it('projects a sub-item’s created and changed events onto the parent, nothing else', () => {
    const { b } = world();
    const ev = changed(b, 'c_stuck', 'c_done');
    expect(projectToParent(ev, b, sheet.id)).toMatchObject({
      type: 'subitem.event',
      sheetId: sheet.id,
      itemId: 'p1',
      subitemId: 'b',
    });
    expect(projectToParent(ev, { id: 'b', parentId: null }, sheet.id)).toBeNull();
    expect(
      projectToParent(
        { type: 'button.clicked', sheetId: CHILD, itemId: 'b', fieldId: 'x', actor: user },
        b,
        sheet.id,
      ),
    ).toBeNull();
  });

  it('all_subitems_done fires once: on the change that closes the last open sub-item', () => {
    const { parent, a } = world();
    const b = makeSubitem(parent, { [cStatus.id]: 'c_done' }, { id: 'b' });
    const c = makeSubitem(parent, { [cStatus.id]: 'c_done' }, { id: 'c' });
    const ctx = subitemCtx({ items: [parent, a, b, c] });
    const t = { type: 'all_subitems_done' as const };
    // c was the last one open
    const last = projectToParent(changed(c, 'c_doing', 'c_done'), c, sheet.id)!;
    expect(matchTrigger(t, last, ctx)).toBe(true);
    // a further change among done values (Done → N/A) does not fire again
    const again = projectToParent(changed(c, 'c_done', 'c_na'), c, sheet.id)!;
    expect(matchTrigger(t, again, ctx)).toBe(false);
    // while one is open it does not fire
    const open = subitemCtx({
      items: [parent, a, b, { ...c, values: { [cStatus.id]: 'c_todo' } }],
    });
    expect(
      matchTrigger(t, projectToParent(changed(b, 'c_todo', 'c_done'), b, sheet.id)!, open),
    ).toBe(false);
  });

  it('subitem_created and subitem_field_becomes match the projection', () => {
    const { parent, a, b, c } = world();
    const ctx = subitemCtx({ items: [parent, a, b, c] });
    const created = projectToParent(
      { type: 'item.created', sheetId: CHILD, itemId: 'c', actor: user },
      c,
      sheet.id,
    )!;
    expect(matchTrigger({ type: 'subitem_created' }, created, ctx)).toBe(true);
    const becomes = {
      type: 'subitem_field_becomes' as const,
      fieldKey: 'status',
      value: 'c_stuck',
    };
    expect(
      matchTrigger(becomes, projectToParent(changed(b, 'c_todo', 'c_stuck'), b, sheet.id)!, ctx),
    ).toBe(true);
    expect(
      matchTrigger(becomes, projectToParent(changed(b, 'c_stuck', 'c_stuck'), b, sheet.id)!, ctx),
    ).toBe(false);
    expect(matchTrigger(becomes, changed(b, 'c_todo', 'c_stuck'), ctx)).toBe(false);
  });
});

describe('sub-item action planners', () => {
  it('create_subitems: the template set, tokens resolved, names templated', () => {
    const { parent } = world();
    const ctx = subitemCtx({ items: [parent] });
    const [step] = planActions(
      [{ type: 'create_subitems', fromTemplate: true }],
      parent,
      null,
      ctx,
      env,
    );
    expect(step!.outcome).toBeUndefined();
    expect(step!.summary).toBe('Add 2 actions');
    expect(step!.effects).toEqual([
      {
        kind: 'create_subitems',
        parentId: 'p1',
        items: [
          { name: 'Containment', values: { due_date: '2026-11-13' } },
          {
            name: 'Effectiveness check of CA-001',
            values: { due_date: '2027-02-09', owner: 'u-maria' },
          },
        ],
      },
    ]);
    const [list] = planActions(
      [{ type: 'create_subitems', items: [{ name: 'Check {id}', values: { nope: 1 } }] }],
      parent,
      null,
      ctx,
      env,
    );
    expect(list!.effects[0]).toEqual({
      kind: 'create_subitems',
      parentId: 'p1',
      items: [{ name: 'Check CA-001', values: {} }],
    });
  });

  it('create_subitems refuses sub-items of sub-items and sheets without sub-items', () => {
    const { parent, a } = world();
    const [nested] = planActions(
      [{ type: 'create_subitems', fromTemplate: true }],
      a,
      null,
      subitemCtx({ items: [parent, a] }),
      env,
    );
    expect(nested!.outcome).toBe('failed');
    const plain = subitemCtx({ items: [parent] });
    const [off] = planActions(
      [{ type: 'create_subitems', items: [{ name: 'x' }] }],
      parent,
      null,
      { ...plain, sheet: { ...plain.sheet, childSheetId: null } },
      env,
    );
    expect(off!.outcome).toBe('failed');
    expect(off!.message).toBe('Sub-items are off for this sheet.');
  });

  it('set_parent_field: writes the parent from a sub-item', () => {
    const { parent, a } = world();
    const ctx = childCtx({ items: [parent, a] });
    const [step] = planActions(
      [{ type: 'set_parent_field', fieldKey: 'status', value: 'p_done' }],
      a,
      null,
      ctx,
      env,
    );
    expect(step!.summary).toBe('Set Status on the parent to Done');
    expect(step!.effects).toEqual([
      { kind: 'set_values', sheetId: sheet.id, itemId: 'p1', values: { [pStatus.id]: 'p_done' } },
    ]);
    const [orphan] = planActions(
      [{ type: 'set_parent_field', fieldKey: 'status', value: 'p_done' }],
      { ...a, parentId: null },
      null,
      ctx,
      env,
    );
    expect(orphan!.outcome).toBe('failed');
  });

  it('update_subitems: only the ones that change, open ones on request, bounded', () => {
    const { parent, a, b, c } = world();
    const ctx = subitemCtx({ items: [parent, a, b, c] });
    const [all] = planActions(
      [{ type: 'update_subitems', fieldKey: 'owner', value: '$actor' }],
      parent,
      null,
      ctx,
      env,
    );
    expect(all!.effects).toEqual([
      expect.objectContaining({
        kind: 'update_linked',
        direction: 'out',
        targetIds: ['a', 'b', 'c'],
        fieldKey: 'owner',
      }),
    ]);
    const [open] = planActions(
      [{ type: 'update_subitems', fieldKey: 'status', value: 'c_done', onlyOpen: true }],
      parent,
      null,
      ctx,
      env,
    );
    expect(open!.effects[0]).toMatchObject({ targetIds: ['b', 'c'] });
    const doneCtx = subitemCtx({
      items: [
        parent,
        a,
        { ...b, values: { [cStatus.id]: 'c_done' } },
        { ...c, values: { [cStatus.id]: 'c_done' } },
      ],
    });
    const [none] = planActions(
      [{ type: 'update_subitems', fieldKey: 'status', value: 'c_done' }],
      parent,
      null,
      doneCtx,
      env,
    );
    expect(none!.outcome).toBe('no_change');
    expect(cOwner.key).toBe('owner');
  });
});
