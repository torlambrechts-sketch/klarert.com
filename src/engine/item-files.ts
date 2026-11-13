// Files on items (docs/02 §8, docs/05 §3.4 Files tab): what may be uploaded, file categories by id, classification,
// validity wording, version chains and the row marker. Pure: today is passed in; the browser and the upload commands
// share these checks (the server repeats them on the stored bytes).
import { EXPIRING_DAYS } from './fields/evidence';
import { daysBetween, formatDate } from './fields/helpers';
import type { Ctx, Field, FileRow, Item } from './types';

/** The most a single file may be (decision of the product owner; the bucket enforces the same limit). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// ───────────────────────── what may be uploaded ─────────────────────────

/** Never accepted: programs, scripts, web pages, macro-enabled Office files, shortcuts and disk images. */
export const BLOCKED_EXTENSIONS = new Set([
  'exe', 'dll', 'com', 'scr', 'pif', 'cpl', 'sys', 'msi', 'msp', 'msix', 'appx', 'app', 'dmg', 'pkg', 'deb', 'rpm',
  'apk', 'ipa', 'jar', 'class', 'bat', 'cmd', 'sh', 'bash', 'zsh', 'ps1', 'psm1', 'psd1', 'vb', 'vbs', 'vbe', 'js',
  'mjs', 'cjs', 'jse', 'ws', 'wsf', 'wsh', 'wsc', 'hta', 'html', 'htm', 'xhtml', 'shtml', 'mht', 'mhtml', 'php',
  'py', 'pl', 'rb', 'lnk', 'url', 'scf', 'reg', 'inf', 'gadget', 'iso', 'img', 'vhd', 'vhdx', 'docm', 'dotm',
  'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppam', 'ppsm', 'sldm', 'chm', 'application', 'elf', 'bin',
]); // prettier-ignore

type Sniff = 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'tiff' | 'bmp' | 'heic' | 'zip' | 'ole' | 'rtf' | 'text'
  | 'svg' | 'mp4'; // prettier-ignore

/** Extensions accepted, with the content their first bytes must show. */
const ALLOWED: Record<string, Sniff> = {
  pdf: 'pdf',
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  gif: 'gif',
  webp: 'webp',
  tif: 'tiff',
  tiff: 'tiff',
  bmp: 'bmp',
  heic: 'heic',
  heif: 'heic',
  docx: 'zip',
  xlsx: 'zip',
  pptx: 'zip',
  odt: 'zip',
  ods: 'zip',
  odp: 'zip',
  zip: 'zip',
  doc: 'ole',
  xls: 'ole',
  ppt: 'ole',
  msg: 'ole',
  rtf: 'rtf',
  txt: 'text',
  csv: 'text',
  md: 'text',
  json: 'text',
  xml: 'text',
  eml: 'text',
  svg: 'svg',
  mp4: 'mp4',
  mov: 'mp4',
  m4a: 'mp4',
};

/** The accept attribute of the Files tab's chooser. */
export const UPLOAD_ACCEPT = Object.keys(ALLOWED)
  .map((e) => `.${e}`)
  .join(',');

const startsWith = (b: Uint8Array, sig: number[], at = 0) =>
  b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);
const ascii = (b: Uint8Array, n = 512) =>
  Array.from(b.subarray(0, n), (c) => String.fromCharCode(c)).join('');

/** Programs and web pages, whatever the name says: Windows, Linux and Mac executables, Java classes, HTML. */
function executableContent(b: Uint8Array): boolean {
  if (startsWith(b, [0x4d, 0x5a])) return true; // MZ: Windows programs
  if (startsWith(b, [0x7f, 0x45, 0x4c, 0x46])) return true; // ELF
  if (startsWith(b, [0xca, 0xfe, 0xba, 0xbe])) return true; // Java class / Mach-O fat
  if (startsWith(b, [0xcf, 0xfa, 0xed, 0xfe]) || startsWith(b, [0xce, 0xfa, 0xed, 0xfe]))
    return true; // Mach-O
  if (startsWith(b, [0x23, 0x21])) return true; // #! scripts
  const head = ascii(b).trimStart().toLowerCase();
  return /^(<!doctype html|<html|<script|<head|<body|<iframe)/.test(head);
}

function matches(kind: Sniff, b: Uint8Array): boolean {
  switch (kind) {
    case 'pdf':
      return ascii(b, 1024).includes('%PDF-');
    case 'png':
      return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpeg':
      return startsWith(b, [0xff, 0xd8, 0xff]);
    case 'gif':
      return ascii(b, 6) === 'GIF87a' || ascii(b, 6) === 'GIF89a';
    case 'webp':
      return ascii(b, 4) === 'RIFF' && ascii(b.subarray(8), 4) === 'WEBP';
    case 'tiff':
      return startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a]);
    case 'bmp':
      return ascii(b, 2) === 'BM';
    case 'heic':
    case 'mp4':
      return ascii(b.subarray(4), 4) === 'ftyp';
    case 'zip':
      return startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]);
    case 'ole':
      return startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'rtf':
      return ascii(b, 5) === '{\\rtf';
    case 'text':
      return !b.subarray(0, 4096).includes(0);
    case 'svg': {
      if (b.subarray(0, 4096).includes(0)) return false;
      return /<svg[\s>]/i.test(ascii(b, 4096));
    }
  }
}

export const extensionOf = (filename: string) => {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
};

export type UploadCheck = { ok: true } | { ok: false; reason: string };

const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

/**
 * May this file be uploaded? Size up to 25 MB, an extension on the allow-list (never a blocked one) and first bytes
 * that match the extension. `head` is the start of the file (4 KB is enough); the server checks the stored bytes.
 */
export function checkUpload(filename: string, size: number, head: Uint8Array): UploadCheck {
  if (size <= 0) return { ok: false, reason: 'The file is empty.' };
  if (size > MAX_UPLOAD_BYTES)
    return { ok: false, reason: `Files can be at most ${mb(MAX_UPLOAD_BYTES)}.` };
  const ext = extensionOf(filename);
  // every dotted part counts: "invoice.pdf.exe" and "report.exe.pdf" are both refused
  const parts = filename.toLowerCase().split('.').slice(1);
  const blocked = parts.find((p) => BLOCKED_EXTENSIONS.has(p));
  if (blocked)
    return {
      ok: false,
      reason: `.${blocked} files are not allowed: programs, scripts, web pages and macro-enabled files can harm computers.`,
    };
  const kind = ALLOWED[ext];
  if (!kind)
    return {
      ok: false,
      reason: ext
        ? `.${ext} files are not accepted. Use PDF, an image, an Office or OpenDocument file, text or CSV.`
        : 'Files need an extension such as .pdf or .docx.',
    };
  if (executableContent(head))
    return { ok: false, reason: 'This file contains a program or web page and is not allowed.' };
  if (!matches(kind, head))
    return {
      ok: false,
      reason: `This file is not a real .${ext} file. Its content does not match its name.`,
    };
  return { ok: true };
}

/** Shown in the browser: PDFs and images (not SVG, which is download-only), with a forced content type. */
export type PreviewKind = 'pdf' | 'image';

const PREVIEW: Record<string, { kind: PreviewKind; type: string }> = {
  pdf: { kind: 'pdf', type: 'application/pdf' },
  png: { kind: 'image', type: 'image/png' },
  jpg: { kind: 'image', type: 'image/jpeg' },
  jpeg: { kind: 'image', type: 'image/jpeg' },
  gif: { kind: 'image', type: 'image/gif' },
  webp: { kind: 'image', type: 'image/webp' },
};

export function previewOf(filename: string): { kind: PreviewKind; type: string } | null {
  return PREVIEW[extensionOf(filename)] ?? null;
}

// ───────────────────────── categories and classification ─────────────────────────

export interface FileCategory {
  id: string;
  label: string;
}

/** The default categories (orgs.settings.fileCategories replaces them). Stored by id, shown by label. */
export const DEFAULT_FILE_CATEGORIES: FileCategory[] = [
  { id: 'evidence', label: 'Evidence' },
  { id: 'contract', label: 'Contract' },
  { id: 'photo', label: 'Photo' },
  { id: 'report', label: 'Report' },
  { id: 'document', label: 'Document' },
  { id: 'policy', label: 'Policy' },
  { id: 'procedure', label: 'Procedure' },
  { id: 'other', label: 'Other' },
];

/** The workspace's categories: orgs.settings.fileCategories when it is a valid list, else the defaults. */
export function fileCategories(orgSettings: unknown): FileCategory[] {
  const raw = (orgSettings as { fileCategories?: unknown } | null)?.fileCategories;
  if (!Array.isArray(raw)) return DEFAULT_FILE_CATEGORIES;
  const out = raw.filter(
    (c): c is FileCategory =>
      !!c &&
      typeof c === 'object' &&
      typeof (c as FileCategory).id === 'string' &&
      /^[a-z][a-z0-9_]{0,39}$/.test((c as FileCategory).id) &&
      typeof (c as FileCategory).label === 'string' &&
      (c as FileCategory).label.trim() !== '',
  );
  return out.length ? out : DEFAULT_FILE_CATEGORIES;
}

/** The label of a stored category id; an id no longer in the list shows as "Other". */
export function categoryLabel(id: string | null | undefined, categories: FileCategory[]): string {
  if (!id) return 'No category';
  return categories.find((c) => c.id === id)?.label ?? 'Other';
}

export const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  public: 'Public',
  internal: 'Internal',
  confidential: 'Confidential',
  restricted: 'Restricted',
};
export const isClassification = (s: unknown): s is Classification =>
  typeof s === 'string' && (CLASSIFICATIONS as readonly string[]).includes(s);

/** Uploads that look like a policy or procedure: the Files tab suggests linking the controlled document instead. */
export function looksLikeControlledDocument(filename: string, category?: string | null): boolean {
  if (category === 'policy' || category === 'procedure') return true;
  return /(^|[^a-z])(polic(y|ies)|procedures?|sop)([^a-z]|$)/i.test(filename);
}

// ───────────────────────── validity ─────────────────────────

export type Validity = 'valid' | 'expiring' | 'expired';

export interface ValidityView {
  validity: Validity;
  /** "✓", "⚠", "✕": colour is never the only signal. */
  symbol: string;
  /** "Valid to 11 Nov 2027", "Expires in 12 days", "Expires today", "Expired 3 Nov 2026". */
  text: string;
}

const days = (n: number) => (n === 1 ? '1 day' : `${n} days`);

export function validityView(
  validUntil: string | null | undefined,
  today: string,
): ValidityView | null {
  if (!validUntil) return null;
  const left = daysBetween(validUntil, today);
  if (left < 0)
    return { validity: 'expired', symbol: '✕', text: `Expired ${formatDate(validUntil)}` };
  if (left <= EXPIRING_DAYS)
    return {
      validity: 'expiring',
      symbol: '⚠',
      text: left === 0 ? 'Expires today' : `Expires in ${days(left)}`,
    };
  return { validity: 'valid', symbol: '✓', text: `Valid to ${formatDate(validUntil)}` };
}

// ───────────────────────── versions ─────────────────────────

/** "v3". */
export const versionLabel = (n: number | null | undefined) => `v${n && n > 0 ? n : 1}`;

/** One version as the history and the Files tab read it. */
export interface FileVersionRow extends FileRow {
  createdAt: string;
  uploadedBy: string | null;
  description?: string | null;
  category?: string | null;
  versionNo: number;
  versionNote?: string | null;
  classification?: string;
  personalData?: boolean;
  archivedAt?: string | null;
  scanStatus?: string;
  approvedAt?: string | null;
  supersededAt?: string | null;
}

export interface FileChain<T extends FileVersionRow = FileVersionRow> {
  current: T;
  /** Every version, newest first (the current one first). */
  versions: T[];
}

/** The version chains of some files (one item's): current version first, older versions newest first. */
export function fileChains<T extends FileVersionRow>(rows: T[]): FileChain<T>[] {
  const byReplacement = new Map<string, T>();
  for (const r of rows) if (r.replacedBy) byReplacement.set(r.replacedBy, r);
  return rows
    .filter((r) => !r.replacedBy)
    .map((current) => {
      const versions: T[] = [current];
      const seen = new Set<string>([current.id]);
      let prev = byReplacement.get(current.id);
      while (prev && !seen.has(prev.id)) {
        versions.push(prev);
        seen.add(prev.id);
        prev = byReplacement.get(prev.id);
      }
      return { current, versions };
    })
    .sort((a, b) => b.current.createdAt.localeCompare(a.current.createdAt));
}

/** A version's state in the history: "Current", "Approved", "Obsolete" (a superseded approved version) or null. */
export function versionState(v: FileVersionRow, current: FileVersionRow): string | null {
  if (v.approvedAt && v.supersededAt) return 'Obsolete';
  if (v.approvedAt) return v.id === current.id ? 'Current · Approved' : 'Approved';
  return v.id === current.id ? 'Current' : null;
}

// ───────────────────────── the row marker ─────────────────────────

export interface FilesMarker {
  /** Current files (item files and file fields) plus linked documents. */
  count: number;
  /** Any current file whose validity has run out. */
  expired: boolean;
  /** "3 files and documents, one expired". */
  label: string;
}

/**
 * The paperclip on a row: current files of the item (the Files tab and file fields) and the documents it links to
 * through link fields pointing at a documents register.
 */
export function filesMarker(
  item: Item,
  fileFields: Field[],
  documentLinkFields: Field[],
  ctx: Ctx,
): FilesMarker {
  const files = [
    ...ctx.files(item.id, null),
    ...fileFields.flatMap((f) => ctx.files(item.id, f.id)),
  ].filter((f) => !f.replacedBy);
  const docs = documentLinkFields.reduce((n, f) => n + ctx.links(item.id, f.id).length, 0);
  const count = files.length + docs;
  const expired = files.some((f) => !!f.validUntil && daysBetween(f.validUntil, ctx.today) < 0);
  const label = `${count} ${count === 1 ? 'file or document' : 'files and documents'}${expired ? ', expired' : ''}`;
  return { count, expired, label };
}
