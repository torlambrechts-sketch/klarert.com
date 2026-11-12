import { describe, expect, it } from 'vitest';
import './fields/registry';
import { status } from './fields/status';
import { itemSummary, linkEdges, neighbours } from './item-panel';
import { makeCtx, makeField, makeItem } from './testing/fixtures';

const statusField = makeField('status', status.defaultConfig(), { id: 'f-status', position: 'a0' });
const owner = makeField('people', { multiple: true }, { id: 'f-owner', position: 'a1' });
const start = makeField('date', { relative: true }, { id: 'f-start', position: 'a2' });
const due = makeField('date', { relative: true }, { id: 'f-due', position: 'a3' });
const fields = [statusField, owner, start, due];

describe('itemSummary', () => {
  it('takes the status, the first person and the first date', () => {
    const item = makeItem({ 'f-owner': ['u-james', 'u-maria'], 'f-due': '2026-11-16' });
    const s = itemSummary(item, makeCtx({ fields, items: [item] }));
    expect(s.status?.id).toBe('f-status');
    expect(s.person).toEqual({ field: owner, userId: 'u-james' });
    expect(s.due).toEqual({
      field: due,
      date: '2026-11-16',
      relative: 'in 5 days',
      overdue: false,
    });
  });

  it('marks an overdue date unless the item is done', () => {
    const late = makeItem({ 'f-start': '2026-11-08', 'f-status': 'opt_wip' });
    expect(itemSummary(late, makeCtx({ fields, items: [late] })).due).toMatchObject({
      relative: '3 days overdue',
      overdue: true,
    });
    const done = makeItem({ 'f-start': '2026-11-08', 'f-status': 'opt_done' });
    expect(itemSummary(done, makeCtx({ fields, items: [done] })).due).toMatchObject({
      relative: null,
      overdue: false,
    });
  });

  it('copes with a sheet without these fields', () => {
    const item = makeItem();
    expect(itemSummary(item, makeCtx({ fields: [], items: [item] }))).toEqual({
      status: null,
      person: null,
      due: null,
      done: false,
    });
  });
});

describe('linkEdges', () => {
  const risks = makeField(
    'link',
    { targetSheetId: 's-risks', multiple: true, inverseFieldId: 'f-actions' },
    { id: 'f-risks' },
  );
  const actions = makeField(
    'link',
    { targetSheetId: 's-ca', multiple: true, inverseFieldId: 'f-risks' },
    { id: 'f-actions', sheetId: 's-risks' },
  );
  const audits = makeField(
    'link',
    { targetSheetId: 's-ca', multiple: true, inverseFieldId: null },
    { id: 'f-audit-actions', sheetId: 's-audits' },
  );
  const byId = (id: string) => [risks, actions, audits].find((f) => f.id === id);

  it('keeps outgoing links and incoming links from other sheets, dropping two-way mirrors', () => {
    const edges = linkEdges({
      itemId: 'i-1',
      outgoing: [{ field: risks, targetIds: ['r-1', 'r-2'] }],
      incoming: [
        { fieldId: 'f-actions', fromItem: 'r-1' }, // mirror of the two-way link
        { fieldId: 'f-actions', fromItem: 'r-9' }, // only one side written
        { fieldId: 'f-audit-actions', fromItem: 'a-1' },
        { fieldId: 'f-audit-actions', fromItem: 'a-1' },
      ],
      fieldById: byId,
    });
    expect(edges).toEqual([
      { direction: 'out', fieldId: 'f-risks', otherId: 'r-1' },
      { direction: 'out', fieldId: 'f-risks', otherId: 'r-2' },
      { direction: 'in', fieldId: 'f-actions', otherId: 'r-9' },
      { direction: 'in', fieldId: 'f-audit-actions', otherId: 'a-1' },
    ]);
  });

  it('works when only the incoming field knows its inverse', () => {
    const oneWay = { ...risks, config: { ...risks.config, inverseFieldId: null } };
    expect(
      linkEdges({
        itemId: 'i-1',
        outgoing: [{ field: oneWay, targetIds: ['r-1'] }],
        incoming: [{ fieldId: 'f-actions', fromItem: 'r-1' }],
        fieldById: byId,
      }),
    ).toEqual([{ direction: 'out', fieldId: 'f-risks', otherId: 'r-1' }]);
  });
});

describe('neighbours', () => {
  it('finds the previous and next item for J and K', () => {
    const [a, b, c] = [makeItem(), makeItem(), makeItem()];
    const temp = makeItem({}, { id: 'temp-x' });
    expect(neighbours([a!, temp, b!, c!], b!.id)).toEqual({ prev: a, next: c });
    expect(neighbours([a!, b!], a!.id)).toEqual({ prev: null, next: b });
    expect(neighbours([a!], 'missing')).toEqual({ prev: null, next: null });
  });
});

describe('status and expiry helpers', () => {
  it('finds the status field of another sheet and which file fields expire', async () => {
    const { statusFieldOf, filesExpire } = await import('./item-panel');
    const riskStatus = makeField('status', status.defaultConfig(), {
      id: 'f-risk-status',
      sheetId: 's-risks',
    });
    const ctx = makeCtx({ fields, otherFields: { 's-risks': [riskStatus] } });
    expect(statusFieldOf('s-risks', ctx)?.id).toBe('f-risk-status');
    expect(statusFieldOf('s-none', ctx)).toBeNull();
    expect(filesExpire(makeField('evidence', { validDays: 1, multiple: true, accept: [] }))).toBe(
      true,
    );
    expect(filesExpire(makeField('attachment', { multiple: true, accept: [] }))).toBe(false);
  });
});
