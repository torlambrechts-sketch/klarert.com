import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from './fields/registry';
import { installFieldTypes } from './fields/resolve';
import { checklist, checklistDone, homeSummary, NEEDS_YOU_MAX } from './home';
import { buildMyWork, dueField, filterRows, sections, type OpenRequest } from './my-work';
import { makeCtx, makeField, makeItem } from './testing/fixtures';
import type { Item } from './types';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

// fixtures: today 2026-11-11, signed in as u-maria
const created = makeField(
  'meta',
  { which: 'created_at' },
  { key: 'created', id: 'f-created', position: 'a0' },
);
const status = makeField('status', FIELD_TYPES.status.defaultConfig(), {
  key: 'status',
  id: 'f-status',
  position: 'a1',
});
const owner = makeField(
  'people',
  { multiple: true },
  { key: 'owner', id: 'f-owner', position: 'a2' },
);
const due = makeField(
  'date',
  { relative: true },
  { key: 'due', id: 'f-due', position: 'a3', name: 'Due date' },
);
const review = makeField(
  'date',
  { relative: false },
  { key: 'review', id: 'f-review', position: 'a4' },
);
const fields = [created, status, owner, due, review];
const options = (status.config as { options: { id: string; label: string; done?: boolean }[] })
  .options;
const DONE = options.find((o) => o.done)!.id;
const OPEN = options.find((o) => !o.done)!.id;

const MARIA = 'u-maria';
const item = (name: string, values: Item['values'], over: Partial<Item> = {}) =>
  makeItem(values, { id: `i-${name}`, name, ...over });

function work(items: Item[], requests: OpenRequest[] = []) {
  const ctx = makeCtx({ fields, items });
  return buildMyWork(
    items.map((i) => ({ item: i, ctx })),
    MARIA,
    requests,
  );
}

const req = (itemId: string): OpenRequest => ({
  id: `n-${itemId}`,
  itemId,
  body: 'Please update',
  createdAt: '2026-11-10T09:00:00Z',
});

describe('dueField', () => {
  it('is the first date field that can hold a deadline, never created/updated', () => {
    expect(dueField(makeCtx({ fields }))?.id).toBe('f-due');
    expect(dueField(makeCtx({ fields: [created, status] }))).toBeNull();
  });

  it('prefers a date set up as a deadline over an earlier record date (Found on before Due date)', () => {
    const foundOn = makeField(
      'date',
      { relative: false },
      { key: 'found_on', id: 'f-found', position: 'a2a', name: 'Found on' },
    );
    expect(dueField(makeCtx({ fields: [created, status, foundOn, due] }))?.id).toBe('f-due');
    // with no deadline-style date, the first date still counts
    expect(dueField(makeCtx({ fields: [created, foundOn, review] }))?.id).toBe('f-found');
  });
});

describe('buildMyWork', () => {
  const items = [
    item('late', { 'f-owner': [MARIA], 'f-due': '2026-11-01', 'f-status': OPEN }),
    item('soon', { 'f-owner': [MARIA, 'u-james'], 'f-due': '2026-11-20' }),
    item('edge', { 'f-owner': [MARIA], 'f-due': '2026-11-25' }), // today + 14: still due soon
    item('later', { 'f-owner': [MARIA], 'f-due': '2026-11-26' }),
    item('nodate', { 'f-owner': [MARIA] }),
    item('done', { 'f-owner': [MARIA], 'f-due': '2026-11-01', 'f-status': DONE }),
    item('theirs', { 'f-owner': ['u-james'], 'f-due': '2026-11-01' }),
    item('asked', { 'f-owner': ['u-james'], 'f-due': '2026-11-02' }),
    item(
      'archived',
      { 'f-owner': [MARIA], 'f-due': '2026-11-01' },
      { archivedAt: '2026-11-05T00:00:00Z' },
    ),
  ];
  const w = work(items, [req('i-asked')]);

  it('lists my items only, sorted by date with undated last', () => {
    expect(w.rows.map((r) => r.name)).toEqual(['late', 'asked', 'soon', 'edge', 'later', 'nodate']);
  });

  it('buckets: overdue, due in 14 days, assigned to me, requests to me', () => {
    const names = (b: Parameters<typeof filterRows>[1]['bucket']) =>
      filterRows(w, { bucket: b }).map((r) => r.name);
    expect(names('overdue')).toEqual(['late', 'asked']);
    expect(names('due')).toEqual(['soon', 'edge']);
    expect(names('assigned')).toEqual(['late', 'soon', 'edge', 'later', 'nodate']);
    expect(names('requests')).toEqual(['asked']);
    expect(w.counts).toEqual({ everything: 6, overdue: 2, due: 2, assigned: 5, requests: 1 });
  });

  it('Everything shows each row once, in its first section', () => {
    expect(sections(w.rows).map((s) => [s.bucket, s.rows.map((r) => r.name)])).toEqual([
      ['overdue', ['late', 'asked']],
      ['due', ['soon', 'edge']],
      ['assigned', ['later', 'nodate']],
    ]);
  });

  it('done items are not my work, overdue or assigned', () => {
    expect(w.rows.find((r) => r.name === 'done')).toBeUndefined();
  });

  it('shows the due date, relative text and status', () => {
    const late = w.rows.find((r) => r.name === 'late')!;
    expect(late.due).toEqual({
      fieldName: 'Due date',
      date: '2026-11-01',
      relative: '10 days overdue',
    });
    expect(late.status?.id).toBe(OPEN);
    expect(late.sheetName).toBe('Corrective actions');
  });

  it('badge = overdue items + open requests to me', () => {
    expect(w.badge).toBe(2 + 1);
    expect(work([], [req('i-gone')]).badge).toBe(0);
  });

  it('counts by sheet and filters by sheet', () => {
    expect(w.sheets).toEqual([{ id: 's-ca', name: 'Corrective actions', count: 6 }]);
    expect(filterRows(w, { sheetId: 'other' })).toEqual([]);
  });

  it('a request on a done item is still a request', () => {
    const d = work([item('closed', { 'f-status': DONE })], [req('i-closed')]);
    expect(d.counts.requests).toBe(1);
    expect(d.counts.overdue).toBe(0);
  });
});

describe('Home', () => {
  it('the checklist is computed from the facts and hides when done', () => {
    const none = checklist({
      sheets: 0,
      items: 0,
      statusFields: 0,
      colleagues: 0,
      automations: 0,
      openedActivityLog: false,
    });
    expect(none.map((s) => s.done)).toEqual([false, false, false, false, false, false]);
    expect(checklistDone(none)).toBe(false);
    const some = checklist({
      sheets: 1,
      items: 4,
      statusFields: 1,
      colleagues: 1,
      automations: 0,
      openedActivityLog: true,
    });
    expect(some.filter((s) => !s.done).map((s) => s.id)).toEqual(['items', 'automation']);
    expect(
      checklistDone(
        checklist({
          sheets: 2,
          items: 5,
          statusFields: 1,
          colleagues: 3,
          automations: 1,
          openedActivityLog: true,
        }),
      ),
    ).toBe(true);
  });

  it('summary: needs you, next due, at most 6 rows', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      item(`n${i}`, { 'f-owner': [MARIA], 'f-due': `2026-11-${String(12 + i).padStart(2, '0')}` }),
    );
    items.push(item('far', { 'f-owner': [MARIA], 'f-due': '2026-12-08' }));
    const s = homeSummary(work(items), '2026-11-11');
    expect(s.needsYouCount).toBe(8);
    expect(s.needsYou).toHaveLength(NEEDS_YOU_MAX);
    expect(s.line).toBe('8 items need you · next due 12 Nov');
    expect(s.next30.map((r) => r.name)).toEqual([...items.slice(0, 8).map((i) => i.name), 'far']);
  });

  it('summary when nothing needs you', () => {
    expect(homeSummary(work([]), '2026-11-11').line).toBe('Nothing needs you right now');
    const one = homeSummary(
      work([item('x', { 'f-owner': [MARIA], 'f-due': '2026-11-01' })]),
      '2026-11-11',
    );
    expect(one.line).toBe('1 item needs you');
  });
});
