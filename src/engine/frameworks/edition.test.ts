import { describe, expect, it } from 'vitest';
import type { Field, Item } from '../types';
import { planEditionMove, type EditionLibrary } from './edition';
import type { Crosswalk } from './types';

const field = (
  id: string,
  sheetId: string,
  key: string,
  type: string,
  config: unknown = {},
): Field => ({
  id,
  sheetId,
  key,
  name: key,
  type,
  position: 'a',
  required: false,
  locked: false,
  config,
  validation: {} as Field['validation'],
  rules: [],
});

const statusOptions = { options: [{ id: 'opt_planned' }, { id: 'opt_implemented' }] };
const fieldsOf = (s: string): Field[] => [
  field(`${s}-app`, s, 'applicable', 'applicability'),
  field(`${s}-just`, s, 'justification', 'justification'),
  field(`${s}-status`, s, 'status', 'status', statusOptions),
  field(`${s}-owner`, s, 'owner', 'people'),
  field(`${s}-ctl`, s, 'controls', 'link'),
];

const item = (id: string, sheetId: string, key: string, values: Item['values'] = {}): Item => ({
  id,
  sheetId,
  groupId: 'g',
  seq: 1,
  displayId: id,
  name: id,
  values,
  position: 'a',
  locked: false,
  createdAt: '',
  updatedAt: '',
  requirementRef: key,
});

const cw = (a: string, b: string, relation: Crosswalk['relation']): Crosswalk => ({
  from: { framework: 'iso-14001', version: '2015', ref: a },
  to: { framework: 'iso-14001', version: '2026', ref: b },
  relation,
  note: '',
  source: 'test',
});

const old: EditionLibrary = {
  sheetId: 'old',
  framework: { key: 'iso-14001', version: '2015' },
  fields: fieldsOf('old'),
  items: [
    item('o42', 'old', 'iso-14001@2015#4.2', {
      'old-app': 'applicable',
      'old-status': 'opt_implemented',
      'old-owner': ['u1'],
    }),
    item('o614', 'old', 'iso-14001@2015#6.1.4', { 'old-status': 'opt_planned' }),
    item('o101', 'old', 'iso-14001@2015#10.1', { 'old-status': 'opt_implemented' }),
    item('o103', 'old', 'iso-14001@2015#10.3', { 'old-status': 'opt_implemented' }),
    item('o81', 'old', 'iso-14001@2015#8.1', { 'old-status': 'opt_implemented' }),
    item('o52', 'old', 'iso-14001@2015#5.2', { 'old-status': 'opt_gone' }),
  ],
};
const next: EditionLibrary = {
  sheetId: 'new',
  framework: { key: 'iso-14001', version: '2026' },
  fields: fieldsOf('new'),
  items: [
    item('n42', 'new', 'iso-14001@2026#4.2'),
    item('n615', 'new', 'iso-14001@2026#6.1.5', { 'new-status': 'opt_planned' }),
    item('n101', 'new', 'iso-14001@2026#10.1'),
    item('n63', 'new', 'iso-14001@2026#6.3'),
    item('n81', 'new', 'iso-14001@2026#8.1'),
    item('n52', 'new', 'iso-14001@2026#5.2'),
    item('n931', 'new', 'iso-14001@2026#9.3.1'),
  ],
};
const crosswalks = [
  cw('4.2', '4.2', 'equivalent'),
  cw('6.1.4', '6.1.5', 'equivalent'),
  cw('10.1', '10.1', 'partial'),
  cw('10.3', '10.1', 'partial'),
  cw('8.1', '8.1', 'partial'),
  cw('8.1', '6.3', 'related'),
  cw('5.2', '5.2', 'equivalent'),
  // another framework: ignored
  {
    from: { framework: 'iso-14001', version: '2015', ref: '4.2' },
    to: { framework: 'iso-9001', version: '2015', ref: '4.2' },
    relation: 'equivalent' as const,
    note: '',
    source: 'test',
  },
];

describe('planEditionMove', () => {
  const controlField = field('risk-req', 'risks', 'requirements', 'requirement', {});
  const plan = planEditionMove({
    from: old,
    to: next,
    crosswalks,
    links: [
      { fieldId: 'risk-req', from: 'risk1', to: 'o42' },
      { fieldId: 'old-ctl', from: 'o42', to: 'ctl9' },
      { fieldId: 'risk-req', from: 'risk2', to: 'o81' },
    ],
    linkFields: [controlField],
    evidence: new Map([['o42', 2]]),
  });

  it('copies the answers of a one-to-one equivalent requirement', () => {
    expect(plan.copies).toEqual([
      {
        fromItemId: 'o42',
        toItemId: 'n42',
        fromRef: '4.2',
        toRef: '4.2',
        patch: { 'new-app': 'applicable', 'new-status': 'opt_implemented', 'new-owner': ['u1'] },
      },
    ]);
  });

  it('never overwrites an answer the new library already has', () => {
    expect(plan.copies.find((c) => c.toRef === '6.1.5')).toBeUndefined();
    expect(plan.review.find((r) => r.toRef === '6.1.5')?.reason).toBe('kept');
  });

  it('skips an option the new field does not offer', () => {
    expect(plan.copies.find((c) => c.toRef === '5.2')).toBeUndefined();
  });

  it('flags merged, partial, related and new requirements for review', () => {
    const reasons = Object.fromEntries(plan.review.map((r) => [r.toRef, r.reason]));
    expect(reasons).toMatchObject({
      '10.1': 'merged',
      '8.1': 'split',
      '6.3': 'split',
      '9.3.1': 'new',
    });
    expect(plan.review.find((r) => r.toRef === '10.1')?.from.map((f) => f.ref)).toEqual([
      '10.1',
      '10.3',
    ]);
  });

  it('repeats the control links of a copied requirement, both directions, and not of the rest', () => {
    expect(plan.links).toEqual([
      { fieldId: 'risk-req', from: 'risk1', to: 'n42' },
      { fieldId: 'new-ctl', from: 'n42', to: 'ctl9' },
    ]);
  });

  it('says which old requirements keep evidence files', () => {
    expect(plan.evidenceStays).toEqual(['4.2']);
  });
});
