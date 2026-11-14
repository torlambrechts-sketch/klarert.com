import { beforeAll, describe, expect, it } from 'vitest';
import {
  approvalRecordKeys,
  documentApprovalValues,
  documentView,
  isDocumentsRegister,
  summariseDocument,
} from './documents';
import { FIELD_TYPES } from './fields/registry';
import { installFieldTypes } from './fields/resolve';
import type { FileVersionRow } from './item-files';
import { makeCtx, makeField, makeFile, makeItem } from './testing/fixtures';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const today = '2026-11-13';
const v = (over: Partial<FileVersionRow> & { id: string }): FileVersionRow => ({
  ...makeFile({ itemId: 'doc', fieldId: null }),
  createdAt: '2026-01-01T10:00:00Z',
  uploadedBy: null,
  versionNo: 1,
  category: 'document',
  ...over,
});

describe('documents register', () => {
  it('is a sheet flagged register = documents', () => {
    expect(isDocumentsRegister({ register: 'documents' })).toBe(true);
    expect(isDocumentsRegister({})).toBe(false);
    expect(isDocumentsRegister(null)).toBe(false);
  });

  it('has Approver and Approved on as the record only an approval fills in', () => {
    expect(approvalRecordKeys({ register: 'documents' })).toEqual(['approver', 'approved_on']);
    expect(approvalRecordKeys({})).toEqual([]);
  });

  it('records the person approving and today, as the database does when a document is approved', () => {
    const approver = makeField('people', { multiple: false }, { key: 'approver' });
    const on = makeField('date', {}, { key: 'approved_on' });
    const other = makeField('people', { multiple: false }, { key: 'approve_by' });
    expect(documentApprovalValues([other, approver, on], 'u-2', '2026-11-14')).toEqual({
      [approver.id]: ['u-2'],
      [on.id]: '2026-11-14',
    });
    expect(documentApprovalValues([other], 'u-2', '2026-11-14')).toEqual({});
  });
});

describe('documentView', () => {
  it('shows the approved version and hands out its file', () => {
    const v1 = v({ id: 'v1', approvedAt: '2026-02-01T00:00:00Z' });
    const d = documentView(
      { statusLabel: 'Approved', approved: true, files: [v1], nextReview: '2027-02-01' },
      today,
    );
    expect(d.chip).toBe('v1 · Approved');
    expect(d.symbol).toBe('✓');
    expect(d.approvedFile?.id).toBe('v1');
    expect(d.draftInReview).toBe(false);
    expect(d.nextReview).toEqual({ text: 'Next review 1 Feb 2027', overdue: false });
  });

  it('a newer draft is "in review" while the approved file stays the one handed out', () => {
    const v1 = v({ id: 'v1', replacedBy: 'v2', approvedAt: '2026-02-01T00:00:00Z' });
    const v2 = v({ id: 'v2', versionNo: 2, createdAt: '2026-10-01T00:00:00Z' });
    const d = documentView(
      { statusLabel: 'Approved', approved: true, files: [v1, v2], nextReview: null },
      today,
    );
    expect(d.chip).toBe('v1 · Approved');
    expect(d.approvedFile?.id).toBe('v1');
    expect(d.latestFile?.id).toBe('v2');
    expect(d.draftInReview).toBe(true);
  });

  it('the last approved file wins: a superseded (obsolete) version is never handed out', () => {
    const v1 = v({
      id: 'v1',
      replacedBy: 'v2',
      approvedAt: '2026-02-01T00:00:00Z',
      supersededAt: '2026-09-01T00:00:00Z',
    });
    const v2 = v({ id: 'v2', versionNo: 2, approvedAt: '2026-09-01T00:00:00Z' });
    const d = documentView(
      { statusLabel: 'Approved', approved: true, files: [v1, v2], nextReview: '2026-11-01' },
      today,
    );
    expect(d.chip).toBe('v2 · Approved');
    expect(d.approvedFile?.id).toBe('v2');
    expect(d.nextReview).toEqual({ text: 'Review overdue since 1 Nov 2026', overdue: true });
  });

  it('a draft without an approval shows its latest version and nothing to download', () => {
    const d = documentView(
      { statusLabel: 'Draft', approved: false, files: [v({ id: 'v1' })], nextReview: null },
      today,
    );
    expect(d.chip).toBe('v1 · Draft');
    expect(d.symbol).toBe('•');
    expect(d.approvedFile).toBeNull();
    expect(d.draftInReview).toBe(false);
    expect(
      documentView({ statusLabel: null, approved: false, files: [], nextReview: null }, today).chip,
    ).toBe('No file · No status');
  });

  it('prefers the chain with the Document category and skips archived files', () => {
    const doc = v({ id: 'doc', createdAt: '2026-01-01T00:00:00Z' });
    const photo = v({ id: 'photo', category: 'photo', createdAt: '2026-06-01T00:00:00Z' });
    const gone = v({ id: 'gone', archivedAt: '2026-07-01', approvedAt: '2026-07-01' });
    const d = documentView(
      { statusLabel: 'In review', approved: false, files: [doc, photo, gone], nextReview: null },
      today,
    );
    expect(d.latestFile?.id).toBe('doc');
    expect(d.approvedFile).toBeNull();
  });
});

describe('summariseDocument', () => {
  const status = makeField(
    'status',
    {
      options: [
        { id: 'opt_draft', label: 'Draft', color: 'grey' },
        { id: 'opt_approved', label: 'Approved', color: 'green', done: true },
      ],
    },
    { id: 'f-status', key: 'status' },
  );
  const docId = makeField('text', {}, { id: 'f-docid', key: 'document_id' });
  const owner = makeField('people', { multiple: false }, { id: 'f-owner', key: 'owner' });
  const next = makeField('date', {}, { id: 'f-next', key: 'next_review' });
  const fields = [status, docId, owner, next];

  it('reads the status option by id, the Document ID, the owner and the next review', () => {
    const item = makeItem(
      {
        'f-status': 'opt_approved',
        'f-docid': 'POL-007',
        'f-owner': ['u-maria'],
        'f-next': '2026-11-01',
      },
      { id: 'doc-1', displayId: 'DOC-001', name: 'Access control policy' },
    );
    const ctx = makeCtx({ fields });
    const files = [v({ id: 'v1', itemId: 'doc-1', approvedAt: '2026-02-01T00:00:00Z' })];
    const s = summariseDocument(item, fields, files, ctx);
    expect(s.documentId).toBe('POL-007');
    expect(s.owner).toBe('Maria Pereira');
    expect(s.view.chip).toBe('v1 · Approved');
    expect(s.view.nextReview?.overdue).toBe(true);
  });

  it('a renamed option shows its new label: values are stored by id', () => {
    const renamed = {
      ...status,
      config: { options: [{ id: 'opt_draft', label: 'Concept', color: 'grey' }] },
    };
    const item = makeItem({ 'f-status': 'opt_draft' }, { id: 'doc-2' });
    const s = summariseDocument(
      item,
      [renamed],
      [v({ id: 'x', itemId: 'doc-2' })],
      makeCtx({ fields: [renamed] }),
    );
    expect(s.view.chip).toBe('v1 · Concept');
    expect(s.documentId).toBeNull();
  });
});
