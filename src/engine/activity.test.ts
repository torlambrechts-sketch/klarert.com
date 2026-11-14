import { describe, expect, it } from 'vitest';
import './fields/registry';
import { status } from './fields/status';
import {
  activityLine,
  activityText,
  isItemEntry,
  linkedIdsInLog,
  type ActivityEntry,
} from './activity';
import { makeCtx, makeField, makeItem } from './testing/fixtures';

const statusField = makeField('status', status.defaultConfig(), { id: 'f-status', name: 'Status' });
const dueField = makeField('date', { relative: true }, { id: 'f-due', name: 'Due date' });
const linkField = makeField(
  'link',
  { targetSheetId: 's-risks', multiple: true, inverseFieldId: null },
  { id: 'f-risks', name: 'Risks' },
);
const evidence = makeField(
  'evidence',
  { validDays: 365, multiple: true, accept: [] },
  { id: 'f-ev', name: 'Evidence' },
);
const secret = makeField('protected', { allowedUserIds: [] }, { id: 'f-secret', name: 'Secret' });
const fields = [statusField, dueField, linkField, evidence, secret];
const ctx = makeCtx({ fields, items: [makeItem({}, { id: 'i-1' })] });
const look = {
  ctx,
  field: (id: string) => fields.find((f) => f.id === id),
  groupName: (id: string) => ({ 'g-open': 'Open', 'g-closed': 'Closed' })[id],
  displayId: (id: string) => ({ 'r-1': 'R-001', 'r-2': 'R-002', 'r-3': 'R-003' })[id],
  personName: (id: string) => ({ 'u-maria': 'Maria Pereira' })[id],
};

let seq = 0;
const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
  id: ++seq,
  at: '2026-11-11T10:00:00Z',
  actorKind: 'user',
  actorId: 'u-maria',
  action: 'value.changed',
  fieldId: null,
  oldValue: null,
  newValue: null,
  note: null,
  hash: '0123456789abcdef'.repeat(4),
  ...over,
});

describe('activity lines', () => {
  it('says who, what and a short hash', () => {
    const line = activityLine(
      entry({ fieldId: 'f-status', oldValue: 'opt_wip', newValue: 'opt_done' }),
      look,
    );
    expect(line).toEqual({
      who: 'Maria Pereira',
      text: 'Status: Working on it → Done',
      shortHash: '01234567',
    });
  });

  it.each<[Partial<ActivityEntry>, string]>([
    [
      { action: 'item.created', newValue: { name: 'X', group_id: 'g-open', values: {} } },
      'Created in Open',
    ],
    [{ fieldId: 'f-due', oldValue: null, newValue: '2026-11-20' }, 'Due date set to 20 Nov 2026'],
    [
      { fieldId: 'f-due', oldValue: '2026-11-20', newValue: null },
      'Due date cleared (was 20 Nov 2026)',
    ],
    [
      { fieldId: 'f-status', oldValue: 'opt_wip', newValue: 'opt_done', note: 'Checked on site' },
      'Status: Working on it → Done · Comment: “Checked on site”',
    ],
    [{ fieldId: 'f-gone', oldValue: 'a', newValue: 'b' }, 'A deleted field: a → b'],
    [{ action: 'item.renamed', oldValue: 'Old', newValue: 'New' }, 'Renamed: “Old” → “New”'],
    [
      { action: 'item.moved', oldValue: 'g-open', newValue: 'g-closed' },
      'Moved from Open to Closed',
    ],
    [
      { action: 'item.moved', oldValue: 'g-x', newValue: 'g-closed' },
      'Moved from a deleted group to Closed',
    ],
    [{ action: 'item.archived' }, 'Archived'],
    [{ action: 'item.restored' }, 'Restored'],
    [{ action: 'item.locked', note: 'Approved by QA' }, 'Locked: Approved by QA'],
    [{ action: 'item.locked' }, 'Locked'],
    [{ action: 'item.unlocked' }, 'Unlocked'],
    [
      { action: 'link.changed', fieldId: 'f-risks', oldValue: ['r-1'], newValue: ['r-2', 'r-3'] },
      'Risks: added R-002, R-003; removed R-001',
    ],
    [
      { action: 'link.changed', fieldId: 'f-risks', oldValue: [], newValue: ['r-9'] },
      'Risks: added an item you cannot see',
    ],
    [
      { action: 'file.added', fieldId: 'f-ev', newValue: { file_id: 'x', filename: 'drill.pdf' } },
      'Evidence: added drill.pdf',
    ],
    [
      {
        action: 'file.replaced',
        fieldId: 'f-ev',
        oldValue: { filename: 'drill.pdf' },
        newValue: { filename: 'drill-v2.pdf' },
      },
      'Evidence: replaced drill.pdf with drill-v2.pdf',
    ],
    [{ action: 'protected.changed', fieldId: 'f-secret' }, 'Secret changed (value hidden)'],
    [{ action: 'protected.cleared', fieldId: 'f-secret' }, 'Secret cleared'],
    [{ action: 'update.edited', oldValue: 'a', newValue: 'b' }, 'Edited an update'],
    [{ action: 'update.deleted', oldValue: 'a' }, 'Deleted an update'],
    [
      { action: 'automation.paused', note: 'Done → lock' },
      'Paused the automation “Done → lock” for this item',
    ],
    [
      { action: 'automation.resumed', note: 'Done → lock' },
      'Resumed the automation “Done → lock” for this item',
    ],
    [{ action: 'something.new' }, 'something.new'],
  ])('%o → %s', (over, text) => {
    expect(activityText(entry(over), look)).toBe(text);
  });

  it('names automations, forms, the system and former members', () => {
    expect(activityLine(entry({ actorKind: 'automation', actorId: 'a-1' }), look).who).toBe(
      'Automation',
    );
    expect(
      activityLine(entry({ actorKind: 'automation', actorId: 'a-1' }), {
        ...look,
        automationName: () => 'Notify owner',
      }).who,
    ).toBe('Automation · Notify owner');
    expect(activityLine(entry({ actorKind: 'form', actorId: null }), look).who).toBe('Form');
    expect(activityLine(entry({ actorKind: 'system', actorId: null }), look).who).toBe('System');
    expect(activityLine(entry({ actorId: 'u-gone' }), look).who).toBe('Former member');
  });

  it('protected changes never show a value', () => {
    const text = activityText(
      entry({ action: 'protected.changed', fieldId: 'f-secret', newValue: 'PIN 1234' }),
      look,
    );
    expect(text).not.toContain('1234');
  });

  it('lists the items link entries mention and keeps schema entries out', () => {
    expect(
      linkedIdsInLog([
        entry({ action: 'link.changed', oldValue: ['r-1'], newValue: ['r-1', 'r-2'] }),
        entry({ action: 'value.changed' }),
      ]),
    ).toEqual(['r-1', 'r-2']);
    expect(isItemEntry({ action: 'fields.update' })).toBe(false);
    expect(isItemEntry({ action: 'item.moved' })).toBe(true);
  });

  it('personal data: erased values and names say so, markers never show', () => {
    expect(
      activityText(
        entry({ fieldId: 'f-due', oldValue: { $erased: true }, newValue: { $personal: 'abc' } }),
        look,
      ),
    ).toBe('Due date: erased → Restricted');
    expect(
      activityText(
        entry({ action: 'item.renamed', oldValue: { $erased: true }, newValue: 'Access request' }),
        look,
      ),
    ).toBe('Renamed: erased → “Access request”');
    expect(
      activityText(
        entry({ action: 'file.added', newValue: { file_id: 'x', filename: { $erased: true } } }),
        look,
      ),
    ).toBe('Files: added an erased file');
  });

  it('retention entries read as sentences, the tombstone without values', () => {
    expect(
      activityText(
        entry({ action: 'retention.due', newValue: { rule: 'Requests 3 years', action: 'erase' } }),
        look,
      ),
    ).toBe('Due for retention review under “Requests 3 years”: erase the personal data');
    expect(
      activityText(
        entry({ action: 'retention.postponed', newValue: { until: '2027-01-31' }, note: 'Open complaint' }),
        look,
      ),
    ).toBe('Retention postponed to 31 Jan 2027 · Reason: “Open complaint”');
    expect(
      activityText(
        entry({
          action: 'retention.erased',
          newValue: {
            rule: 'Requests 3 years',
            fields: [{ key: 'requester', name: 'Requester' }, { key: 'email', name: 'Email' }],
            files: 1,
            comments: 2,
            renamed: false,
          },
        }),
        look,
      ),
    ).toBe('Personal data erased under “Requests 3 years”: Requester, Email, 1 file, 2 comments');
    expect(activityText(entry({ action: 'retention.hold_placed', note: 'Litigation' }), look)).toBe(
      'Legal hold placed · Reason: “Litigation”',
    );
  });
});
