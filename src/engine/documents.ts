// Controlled documents (docs/02 §14, ISO 7.5): a sheet flagged `settings.register = 'documents'` is a documents
// register; its status field's done option means Approved (the approval workflow is enforced in SQL). This projects
// one document for the places that show it: the version and status chip, the file to hand out (the last APPROVED
// version, never a draft) and whether a newer draft is in review. Pure: today is passed in.
import { daysBetween, formatDate } from './fields/helpers';
import { fileChains, versionLabel, type FileVersionRow } from './item-files';
import type { Sheet } from './types';

export const DOCUMENTS_REGISTER = 'documents';

export const isDocumentsRegister = (sheet: Pick<Sheet, 'register'> | null | undefined) =>
  sheet?.register === DOCUMENTS_REGISTER;

/** Field keys the workflow reads and writes (stable keys, docs/02 §14). */
export const DOCUMENT_KEYS = {
  documentId: 'document_id',
  owner: 'owner',
  author: 'author',
  approver: 'approver',
  approvedOn: 'approved_on',
  version: 'version',
  nextReview: 'next_review',
} as const;

export interface DocumentStatusInput {
  /** The status option's label ("Approved", "Draft"), or null without a status. */
  statusLabel: string | null;
  /** Is the status the done option (Approved)? */
  approved: boolean;
  /** Every version of the document's item files (field_id null), archived ones left out. */
  files: FileVersionRow[];
  /** ISO date of the next review, if any. */
  nextReview: string | null;
}

export interface DocumentView {
  /** "v4 · Approved", "v1 · Draft", "No file · Draft". */
  chip: string;
  /** "✓" approved, "•" otherwise: colour is never the only signal. */
  symbol: '✓' | '•';
  tone: 'done' | 'open';
  /** The file people download: the approved version, or null when nothing is approved yet. */
  approvedFile: FileVersionRow | null;
  /** The newest version of the document file. */
  latestFile: FileVersionRow | null;
  /** A newer version than the approved one exists: "⚠ Draft in review". */
  draftInReview: boolean;
  nextReview: { text: string; overdue: boolean } | null;
}

/** The document file's chain: the newest chain with category "document", else the newest chain. */
function documentChain(files: FileVersionRow[]) {
  const chains = fileChains(files.filter((f) => !f.archivedAt));
  return chains.find((c) => c.current.category === 'document') ?? chains[0] ?? null;
}

export function documentView(input: DocumentStatusInput, today: string): DocumentView {
  const chain = documentChain(input.files);
  const latestFile = chain?.current ?? null;
  const approvedFile =
    input.files
      .filter((f) => f.approvedAt && !f.supersededAt && !f.archivedAt)
      .sort((a, b) => (b.approvedAt ?? '').localeCompare(a.approvedAt ?? ''))[0] ?? null;
  const status = input.statusLabel ?? 'No status';
  const shown = input.approved && approvedFile ? approvedFile : latestFile;
  const chip = `${shown ? versionLabel(shown.versionNo) : 'No file'} · ${status}`;
  const draftInReview = !!approvedFile && !!latestFile && latestFile.id !== approvedFile.id;
  let nextReview: DocumentView['nextReview'] = null;
  if (input.nextReview) {
    const left = daysBetween(input.nextReview, today);
    nextReview =
      left < 0
        ? { text: `Review overdue since ${formatDate(input.nextReview)}`, overdue: true }
        : { text: `Next review ${formatDate(input.nextReview)}`, overdue: false };
  }
  return {
    chip,
    symbol: input.approved ? '✓' : '•',
    tone: input.approved ? 'done' : 'open',
    approvedFile,
    latestFile,
    draftInReview,
    nextReview,
  };
}
