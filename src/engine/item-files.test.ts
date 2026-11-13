import { describe, expect, it } from 'vitest';
import {
  categoryLabel,
  checkUpload,
  DEFAULT_FILE_CATEGORIES,
  fileCategories,
  fileChains,
  filesMarker,
  looksLikeControlledDocument,
  MAX_UPLOAD_BYTES,
  previewOf,
  validityView,
  versionLabel,
  versionState,
  type FileVersionRow,
} from './item-files';
import { makeCtx, makeField, makeFile, makeItem } from './testing/fixtures';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

const PDF = bytes('%PDF-1.7\n%âãÏÓ\n');
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04, 20, 0]);
const OLE = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const EXE = bytes('MZ', [0x90, 0, 3, 0]);

describe('checkUpload', () => {
  it('accepts files whose content matches the extension', () => {
    expect(checkUpload('drill.pdf', 1000, PDF)).toEqual({ ok: true });
    expect(checkUpload('site.PNG', 1000, PNG)).toEqual({ ok: true });
    expect(checkUpload('photo.jpeg', 1000, JPEG)).toEqual({ ok: true });
    expect(checkUpload('contract.docx', 1000, ZIP)).toEqual({ ok: true });
    expect(checkUpload('budget.xls', 1000, OLE)).toEqual({ ok: true });
    expect(checkUpload('list.csv', 1000, bytes('name,role\nAna,Lead\n'))).toEqual({ ok: true });
    expect(checkUpload('logo.svg', 1000, bytes('<?xml version="1.0"?><svg xmlns="x">'))).toEqual({
      ok: true,
    });
  });

  it('refuses empty files and files above 25 MB', () => {
    expect(checkUpload('a.pdf', 0, PDF)).toEqual({ ok: false, reason: 'The file is empty.' });
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
    expect(checkUpload('a.pdf', MAX_UPLOAD_BYTES, PDF).ok).toBe(true);
    expect(checkUpload('a.pdf', MAX_UPLOAD_BYTES + 1, PDF)).toEqual({
      ok: false,
      reason: 'Files can be at most 25 MB.',
    });
  });

  it.each([
    ['setup.exe', EXE],
    ['page.html', bytes('<html><body>')],
    ['page.htm', bytes('<html>')],
    ['run.bat', bytes('echo hi')],
    ['tool.ps1', bytes('Write-Host')],
    ['invoice.pdf.exe', EXE],
    ['report.docm', ZIP],
    ['budget.xlsm', ZIP],
    ['deck.pptm', ZIP],
    ['shortcut.lnk', bytes([0x4c, 0, 0, 0])],
    ['disk.iso', bytes('CD001')],
    ['app.jar', ZIP],
    ['app.apk', ZIP],
    ['setup.msi', OLE],
    ['help.hta', bytes('<html>')],
  ])('refuses %s with a reason', (name, head) => {
    const r = checkUpload(name, 1000, head);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not allowed/);
  });

  it('refuses unknown extensions and files without one', () => {
    expect(checkUpload('data.xyz', 10, bytes('x'))).toEqual({
      ok: false,
      reason:
        '.xyz files are not accepted. Use PDF, an image, an Office or OpenDocument file, text or CSV.',
    });
    expect(checkUpload('README', 10, bytes('x'))).toEqual({
      ok: false,
      reason: 'Files need an extension such as .pdf or .docx.',
    });
  });

  it('checks the first bytes against the extension (magic bytes)', () => {
    expect(checkUpload('fake.pdf', 1000, PNG)).toEqual({
      ok: false,
      reason: 'This file is not a real .pdf file. Its content does not match its name.',
    });
    expect(checkUpload('photo.png', 1000, JPEG).ok).toBe(false);
    expect(checkUpload('notes.txt', 1000, bytes('ab', [0], 'cd')).ok).toBe(false);
  });

  it('refuses programs and web pages renamed to an allowed extension', () => {
    expect(checkUpload('invoice.pdf', 1000, EXE)).toEqual({
      ok: false,
      reason: 'This file contains a program or web page and is not allowed.',
    });
    expect(checkUpload('notes.txt', 1000, bytes('  <!DOCTYPE html><html>')).ok).toBe(false);
    expect(checkUpload('run.txt', 1000, bytes('#!/bin/sh\nrm -rf /')).ok).toBe(false);
  });
});

describe('previewOf', () => {
  it('previews PDFs and images with a forced type, never SVG or Office files', () => {
    expect(previewOf('a.pdf')).toEqual({ kind: 'pdf', type: 'application/pdf' });
    expect(previewOf('a.JPG')).toEqual({ kind: 'image', type: 'image/jpeg' });
    expect(previewOf('a.svg')).toBeNull();
    expect(previewOf('a.docx')).toBeNull();
  });
});

describe('file categories', () => {
  it('uses the defaults unless the workspace has its own list', () => {
    expect(fileCategories({})).toBe(DEFAULT_FILE_CATEGORIES);
    expect(fileCategories(null).map((c) => c.label)).toEqual([
      'Evidence',
      'Contract',
      'Photo',
      'Report',
      'Document',
      'Policy',
      'Procedure',
      'Other',
    ]);
    const own = fileCategories({
      fileCategories: [
        { id: 'cert', label: 'Certificate' },
        { id: 'Bad Id', label: 'x' },
        { id: 'misc', label: ' ' },
      ],
    });
    expect(own).toEqual([{ id: 'cert', label: 'Certificate' }]);
  });

  it('stores ids and shows labels, so renaming a category changes every file', () => {
    const cats = [{ id: 'cert', label: 'Certificate' }];
    expect(categoryLabel('cert', cats)).toBe('Certificate');
    expect(categoryLabel('cert', [{ id: 'cert', label: 'Certificates' }])).toBe('Certificates');
    expect(categoryLabel('gone', cats)).toBe('Other');
    expect(categoryLabel(null, cats)).toBe('No category');
  });

  it('spots policies and procedures', () => {
    expect(looksLikeControlledDocument('Access control policy v3.pdf')).toBe(true);
    expect(looksLikeControlledDocument('SOP-12 cleaning.docx')).toBe(true);
    expect(looksLikeControlledDocument('procedures.pdf')).toBe(true);
    expect(looksLikeControlledDocument('invoice.pdf', 'procedure')).toBe(true);
    expect(looksLikeControlledDocument('police-report.pdf')).toBe(false);
    expect(looksLikeControlledDocument('invoice.pdf', 'contract')).toBe(false);
  });
});

describe('validityView', () => {
  const today = '2026-11-13';
  it('words validity with a symbol, never colour alone', () => {
    expect(validityView(null, today)).toBeNull();
    expect(validityView('2027-11-11', today)).toEqual({
      validity: 'valid',
      symbol: '✓',
      text: 'Valid to 11 Nov 2027',
    });
    expect(validityView('2026-11-25', today)).toEqual({
      validity: 'expiring',
      symbol: '⚠',
      text: 'Expires in 12 days',
    });
    expect(validityView('2026-11-13', today)?.text).toBe('Expires today');
    expect(validityView('2026-11-03', today)).toEqual({
      validity: 'expired',
      symbol: '✕',
      text: 'Expired 3 Nov 2026',
    });
  });
});

const version = (over: Partial<FileVersionRow> & { id: string }): FileVersionRow => ({
  ...makeFile({ itemId: 'doc', fieldId: null }),
  createdAt: '2026-01-01T10:00:00Z',
  uploadedBy: null,
  versionNo: 1,
  ...over,
});

describe('versions', () => {
  it('labels versions', () => {
    expect(versionLabel(3)).toBe('v3');
    expect(versionLabel(0)).toBe('v1');
    expect(versionLabel(undefined)).toBe('v1');
  });

  it('builds chains newest first, current version first', () => {
    const v1 = version({ id: 'a1', replacedBy: 'a2', createdAt: '2026-01-01T00:00:00Z' });
    const v2 = version({ id: 'a2', versionNo: 2, createdAt: '2026-02-01T00:00:00Z' });
    const other = version({ id: 'b1', createdAt: '2026-03-01T00:00:00Z' });
    const chains = fileChains([v1, other, v2]);
    expect(chains.map((c) => c.current.id)).toEqual(['b1', 'a2']);
    expect(chains[1]!.versions.map((v) => v.id)).toEqual(['a2', 'a1']);
  });

  it('marks current, approved and obsolete versions', () => {
    const old = version({ id: 'o', approvedAt: '2026-01-02', supersededAt: '2026-05-01' });
    const appr = version({ id: 'p', approvedAt: '2026-05-01' });
    const draft = version({ id: 'd' });
    expect(versionState(old, draft)).toBe('Obsolete');
    expect(versionState(appr, draft)).toBe('Approved');
    expect(versionState(appr, appr)).toBe('Current · Approved');
    expect(versionState(draft, draft)).toBe('Current');
    expect(versionState(version({ id: 'x' }), draft)).toBeNull();
  });
});

describe('filesMarker', () => {
  it('counts files, file field files and linked documents, and flags expired files', () => {
    const ev = makeField('evidence', {}, { id: 'f-ev', key: 'evidence' });
    const docs = makeField('link', {}, { id: 'f-docs', key: 'documents' });
    const item = makeItem({}, { id: 'i1' });
    const ctx = makeCtx({
      fields: [ev, docs],
      items: [item],
      files: [
        makeFile({ itemId: 'i1', fieldId: null, validUntil: '2026-11-01' }),
        makeFile({ itemId: 'i1', fieldId: null, replacedBy: 'x' }),
        makeFile({ itemId: 'i1', fieldId: 'f-ev' }),
      ],
      links: { 'i1:f-docs': ['d1'] },
    });
    expect(filesMarker(item, [ev], [docs], ctx)).toEqual({
      count: 3,
      expired: true,
      label: '3 files and documents, expired',
    });
    expect(filesMarker(makeItem({}, { id: 'none' }), [ev], [docs], ctx)).toEqual({
      count: 0,
      expired: false,
      label: '0 files and documents',
    });
  });
});
