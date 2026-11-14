// Controlled documents (docs/02 §14, ISO 7.5): a sheet flagged `settings.register = 'documents'` is a documents
// register; its status field's done option means Approved (the approval workflow is enforced in SQL). This projects
// one document for the places that show it: the version and status chip, the file to hand out (the last APPROVED
// version, never a draft) and whether a newer draft is in review. Pure: today is passed in.
import { itemStatusField } from './fields/item-status';
import { daysBetween, formatDate } from './fields/helpers';
import { fileChains, versionLabel, type FileVersionRow } from './item-files';
import type { Ctx, Field, Item, Sheet } from './types';
import { defOf } from './values';

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

/**
 * The record of an approval on a documents register: who approved the current version and when. The database fills
 * them in when the document is approved (`_document_transition`) and refuses them from anyone else, so they are empty
 * until then and an approval workflow can neither take its approvers from them nor require them before submitting
 * (the people field "Approve by" names who should approve).
 */
export const APPROVAL_RECORD_KEYS: readonly string[] = [
  DOCUMENT_KEYS.approver,
  DOCUMENT_KEYS.approvedOn,
];

/** Field keys of a sheet that only an approval fills in (none outside a documents register). */
export const approvalRecordKeys = (
  sheet: Pick<Sheet, 'register'> | null | undefined,
): readonly string[] => (isDocumentsRegister(sheet) ? APPROVAL_RECORD_KEYS : []);

/**
 * What approving a document writes besides its status, as the database does: the person approving as Approver and
 * today as Approved on (by field id). Checks made before the database (a status rule that asks for an approver) then
 * see the document as it will be saved.
 */
export function documentApprovalValues(
  fields: Field[],
  by: string,
  today: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const approver = fields.find((f) => f.key === DOCUMENT_KEYS.approver && f.type === 'people');
  if (approver) out[approver.id] = [by];
  const on = fields.find((f) => f.key === DOCUMENT_KEYS.approvedOn && f.type === 'date');
  if (on) out[on.id] = today;
  return out;
}

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

/** One document as the Files tab, the link search and the register list it. */
export interface DocumentSummary {
  itemId: string;
  sheetId: string;
  displayId: string;
  name: string;
  /** The Document ID field's text ("POL-007"), or null. */
  documentId: string | null;
  /** Owner names, joined. */
  owner: string | null;
  view: DocumentView;
}

const textOf = (item: Item, field: Field | undefined, ctx: Ctx): string | null => {
  if (!field) return null;
  const v = item.values[field.id];
  if (v === undefined || v === null || v === '') return null;
  const t = defOf(field).toText(v as never, field.config, ctx);
  return t ? t : null;
};

/**
 * A document of a register: its status (the status field's option; done = Approved), Document ID, owner, next review
 * and its item files. `fields` are the register's fields, `files` every version of the document's item files.
 */
export function summariseDocument(
  item: Item,
  fields: Field[],
  files: FileVersionRow[],
  ctx: Ctx,
): DocumentSummary {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const status = itemStatusField(ctx, fields);
  const statusId = status ? item.values[status.id] : undefined;
  const option =
    status && typeof statusId === 'string'
      ? defOf(status)
          .options?.(status.config, ctx)
          .find((o) => o.id === statusId)
      : undefined;
  const next = byKey.get(DOCUMENT_KEYS.nextReview);
  const nextValue = next ? item.values[next.id] : undefined;
  return {
    itemId: item.id,
    sheetId: item.sheetId,
    displayId: item.displayId,
    name: item.name,
    documentId: textOf(item, byKey.get(DOCUMENT_KEYS.documentId), ctx),
    owner: textOf(item, byKey.get(DOCUMENT_KEYS.owner), ctx),
    view: documentView(
      {
        statusLabel: option?.label ?? null,
        approved: !!option?.done,
        files: files.filter((f) => f.itemId === item.id && f.fieldId === null),
        nextReview:
          typeof nextValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(nextValue)
            ? nextValue.slice(0, 10)
            : null,
      },
      ctx.today,
    ),
  };
}
