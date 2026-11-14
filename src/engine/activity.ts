// Activity log lines (docs/05 §3.4, FR-28/FR-39): one readable sentence per entry of an item's chain. Pure: the
// lookups for fields, groups, items and people are passed in; values are shown with the field type's toText.
import { isErasedValue, isMaskedValue } from './access';
import { formatDate } from './fields/helpers';
import { resolveFieldType } from './fields/resolve';
import type { Ctx, Field, Json } from './types';

export interface ActivityEntry {
  id: number;
  at: string;
  actorKind: 'user' | 'automation' | 'system' | 'form';
  actorId: string | null;
  action: string;
  fieldId: string | null;
  oldValue: Json | null;
  newValue: Json | null;
  note: string | null;
  hash: string;
}

export interface ActivityLookup {
  ctx: Ctx;
  /** Fields of the item's sheet, including deleted ones (old entries refer to them). */
  field(id: string): Field | undefined;
  groupName(id: string): string | undefined;
  /** Display id of any item (links point across sheets). */
  displayId(itemId: string): string | undefined;
  personName(id: string): string | undefined;
  automationName?(id: string): string | undefined;
}

export interface ActivityLine {
  who: string;
  text: string;
  /** First 8 characters of the entry's hash, shown in mono. */
  shortHash: string;
}

const EMPTY = 'empty';
const RESTRICTED = 'Restricted';
const ERASED = 'erased';

function valueText(field: Field | undefined, v: Json | null, look: ActivityLookup): string {
  if (v === null || v === undefined) return EMPTY;
  // personal data erased under a retention rule (docs/02 §18): the log keeps only its marker
  if (isErasedValue(v)) return ERASED;
  // a restricted value (docs/02 §16): the log keeps a marker; people who may see it read it from its own store
  if (isMaskedValue(v)) return RESTRICTED;
  const def = field ? resolveFieldType(field.type) : undefined;
  if (!field || !def) return typeof v === 'string' ? v : JSON.stringify(v);
  try {
    const t = def.toText(v as never, field.config, look.ctx);
    return t || EMPTY;
  } catch {
    return EMPTY;
  }
}

const fieldName = (field: Field | undefined) => field?.name ?? 'A deleted field';
const quote = (s: string) => `“${s}”`;

function ids(v: Json | null): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** "v2" of a file event's value, when it names one. */
function fileVersion(v: Json | null): string {
  return v && typeof v === 'object' && !Array.isArray(v) && typeof v.version_no === 'number'
    ? ` (v${v.version_no})`
    : '';
}

const FILE_DETAIL: Record<string, string> = {
  description: 'description',
  category: 'category',
  valid_until: 'valid until',
  classification: 'classification',
  personal_data: 'personal data',
};

function fileName(v: Json | null): string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'a file';
  if (isErasedValue(v.filename)) return 'an erased file';
  if (isMaskedValue(v.filename)) return 'a file (restricted)';
  return typeof v.filename === 'string' ? v.filename : 'a file';
}

/** An item name in the log: erased, restricted (personal names the reader may not see) or the name. */
function nameText(v: Json | null): string {
  if (isErasedValue(v)) return ERASED;
  if (isMaskedValue(v)) return RESTRICTED;
  return quote(String(v ?? ''));
}

const PERIOD_WORDS: Record<string, string> = {
  erase: 'erase the personal data',
  anonymise: 'anonymise it',
  archive: 'archive it',
};

/** Retention entries (docs/02 §18): due, postponed, holds, and the tombstone of an erasure. */
function retentionText(e: ActivityEntry): string | null {
  const v = objOf(e.newValue);
  const rule = v && typeof v.rule === 'string' ? quote(v.rule) : 'a retention rule';
  switch (e.action) {
    case 'retention.due':
      return `Due for retention review under ${rule}: ${PERIOD_WORDS[String(v?.action)] ?? 'review it'}`;
    case 'retention.postponed':
      return `Retention postponed to ${typeof v?.until === 'string' ? formatDate(v.until) : 'a later date'}${e.note ? ` · Reason: ${quote(e.note)}` : ''}`;
    case 'retention.hold_placed':
      return `Legal hold placed${e.note ? ` · Reason: ${quote(e.note)}` : ''}`;
    case 'retention.hold_released':
      return `Legal hold released${e.note ? ` · ${quote(e.note)}` : ''}`;
    case 'retention.archived':
      return `Archived under ${rule}${e.note ? ` · Note: ${quote(e.note)}` : ''}`;
    case 'retention.erased':
    case 'retention.anonymised': {
      const fields = Array.isArray(v?.fields)
        ? v.fields.map((f) => String(objOf(f)?.name ?? '')).filter(Boolean)
        : [];
      const parts = [
        fields.length ? fields.join(', ') : 'no fields',
        Number(v?.files) ? `${Number(v?.files)} ${Number(v?.files) === 1 ? 'file' : 'files'}` : '',
        Number(v?.comments)
          ? `${Number(v?.comments)} ${Number(v?.comments) === 1 ? 'comment' : 'comments'}`
          : '',
        v?.renamed === true ? 'the name' : '',
      ].filter(Boolean);
      return `${e.action === 'retention.anonymised' ? 'Anonymised' : 'Personal data erased'} under ${rule}: ${parts.join(', ')}${e.note ? ` · Note: ${quote(e.note)}` : ''}`;
    }
    default:
      return null;
  }
}

function itemList(list: string[], look: ActivityLookup): string {
  return list.map((id) => look.displayId(id) ?? 'an item you cannot see').join(', ');
}

export function who(e: Pick<ActivityEntry, 'actorKind' | 'actorId'>, look: ActivityLookup) {
  if (e.actorKind === 'automation')
    return e.actorId && look.automationName?.(e.actorId)
      ? `Automation · ${look.automationName(e.actorId)}`
      : 'Automation';
  if (e.actorKind === 'form') return 'Form';
  if (e.actorKind === 'system') return 'System';
  return (e.actorId && look.personName(e.actorId)) || 'Former member';
}

/** Approval workflow entries (docs/04 §13): submitted, each decision with its step and comment, the end. */
function approvalText(e: ActivityEntry): string {
  const v = objOf(e.newValue);
  const name = v && typeof v.workflow === 'string' ? v.workflow : 'an approval workflow';
  const note = e.note
    ? ` · ${e.action === 'workflow.decided' ? 'Comment' : 'Note'}: ${quote(e.note)}`
    : '';
  switch (e.action) {
    case 'workflow.submitted': {
      const steps = Array.isArray(v?.steps) ? v.steps.length : 0;
      return `Submitted for approval: ${name}${steps ? ` (${steps} ${steps === 1 ? 'step' : 'steps'})` : ''}${note}`;
    }
    case 'workflow.decided': {
      const i = typeof v?.step_index === 'number' ? v.step_index + 1 : null;
      const step = typeof v?.step === 'string' ? v.step : '';
      const what = v?.decision === 'rejected' ? 'Rejected' : 'Approved';
      return `${what} ${i ? `step ${i}, ${step}` : 'a step'} of ${name}${note}`;
    }
    case 'workflow.approved':
      return `Approval complete: ${name}`;
    case 'workflow.rejected':
      return `${v?.end_reason === 'closed' ? 'Rejected and closed' : 'Rejected and back to draft'}: ${name}${note}`;
    default:
      return `Withdrew the approval: ${name}${note}`;
  }
}

// ───────────────────────── where an item came from ─────────────────────────

/** How an item was added, as its item.created entry records it (`source`). */
export type CreatedVia = 'dialog' | 'inline' | 'form';

/** The source of an item.created entry: the dialog, an inline row, or a form (public or internal). */
export function createdVia(newValue: unknown): {
  via: CreatedVia;
  form?: string;
  channel?: string;
} | null {
  const o = newValue && typeof newValue === 'object' && !Array.isArray(newValue) ? newValue : null;
  const s = o && (o as { source?: unknown }).source;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const src = s as Record<string, unknown>;
  if (typeof src.form_id === 'string' || src.channel === 'public' || src.channel === 'internal')
    return { via: 'form', channel: typeof src.channel === 'string' ? src.channel : undefined };
  if (src.via === 'dialog')
    return {
      via: 'dialog',
      form: typeof src.intake_form === 'string' ? src.intake_form : undefined,
    };
  if (src.via === 'inline') return { via: 'inline' };
  return null;
}

/** The words for the source: "with the New item dialog", "in a table row", "from a public form". */
export function createdViaText(newValue: unknown): string | null {
  const s = createdVia(newValue);
  if (!s) return null;
  if (s.via === 'dialog')
    return s.form ? `with the New item dialog (form “${s.form}”)` : 'with the New item dialog';
  if (s.via === 'inline') return 'in a table row';
  return s.channel === 'public' ? 'from a public form' : 'from a form';
}

/** The sentence for one entry: "Status: Working on it → Done", "Moved from Open to Done", … */
export function activityText(e: ActivityEntry, look: ActivityLookup): string {
  const field = e.fieldId ? look.field(e.fieldId) : undefined;
  // files of the item's Files tab have no field
  const files = e.fieldId ? fieldName(field) : 'Files';
  const comment = e.note && e.action === 'value.changed' ? ` · Comment: ${quote(e.note)}` : '';
  const retention = retentionText(e);
  if (retention) return retention;
  // links and files of a restricted field: what changed is not shown to everyone
  if (
    e.action !== 'value.changed' &&
    e.action !== 'item.renamed' &&
    (isMaskedValue(e.oldValue) || isMaskedValue(e.newValue))
  )
    return `${e.fieldId ? fieldName(field) : files}: changed (restricted)`;
  switch (e.action) {
    case 'item.created': {
      const o =
        e.newValue && typeof e.newValue === 'object' && !Array.isArray(e.newValue)
          ? e.newValue
          : null;
      if (o && typeof o.parent === 'string') return `Created under ${o.parent}`;
      const g = o ? look.groupName(String(o.group_id ?? '')) : undefined;
      // where it was added (0046): the New item dialog, a table row or a form
      const via = createdViaText(o);
      return `${g ? `Created in ${g}` : 'Created'}${via ? ` ${via}` : ''}`;
    }
    // sub-items (docs/02 §12): the pointer entries on the parent, and a sub-item moving between parents
    case 'subitem.added':
    case 'subitem.removed':
    case 'subitem.archived':
    case 'subitem.restored': {
      const v = (e.action === 'subitem.removed' ? e.oldValue : e.newValue) as Record<
        string,
        unknown
      > | null;
      const what = v
        ? `${String(v.display_id ?? '')} ${quote(String(v.name ?? ''))}`.trim()
        : 'a sub-item';
      if (e.action === 'subitem.added')
        return v && typeof v.from === 'string'
          ? `Sub-item ${what} moved here from ${v.from}`
          : `Sub-item added: ${what}`;
      if (e.action === 'subitem.removed')
        return v && typeof v.to === 'string'
          ? `Sub-item ${what} moved to ${v.to}`
          : `Sub-item removed: ${what}`;
      return e.action === 'subitem.archived'
        ? `Sub-item archived: ${what}`
        : `Sub-item restored: ${what}`;
    }
    case 'subitem.moved': {
      const from = (e.oldValue as Record<string, unknown> | null)?.parent;
      const to = (e.newValue as Record<string, unknown> | null)?.parent;
      return `Moved from ${String(from ?? 'another item')} to ${String(to ?? 'another item')}. The ID stays.`;
    }
    case 'value.changed': {
      const before = valueText(field, e.oldValue, look);
      const after = valueText(field, e.newValue, look);
      if (before === EMPTY) return `${fieldName(field)} set to ${after}${comment}`;
      if (after === EMPTY) return `${fieldName(field)} cleared (was ${before})${comment}`;
      return `${fieldName(field)}: ${before} → ${after}${comment}`;
    }
    case 'item.renamed':
      return `Renamed: ${nameText(e.oldValue)} → ${nameText(e.newValue)}`;
    case 'item.moved': {
      const from = look.groupName(String(e.oldValue ?? '')) ?? 'a deleted group';
      const to = look.groupName(String(e.newValue ?? '')) ?? 'a deleted group';
      return `Moved from ${from} to ${to}`;
    }
    case 'item.archived':
      return e.note ? `Archived (${e.note.charAt(0).toLowerCase()}${e.note.slice(1)})` : 'Archived';
    case 'item.restored':
      return e.note ? `Restored (${e.note.charAt(0).toLowerCase()}${e.note.slice(1)})` : 'Restored';
    case 'item.locked':
      return e.note ? `Locked: ${e.note}` : 'Locked';
    case 'item.unlocked':
      return 'Unlocked';
    case 'link.changed': {
      const before = ids(e.oldValue);
      const after = ids(e.newValue);
      const added = after.filter((id) => !before.includes(id));
      const removed = before.filter((id) => !after.includes(id));
      const parts = [
        added.length ? `added ${itemList(added, look)}` : '',
        removed.length ? `removed ${itemList(removed, look)}` : '',
      ].filter(Boolean);
      return `${fieldName(field)}: ${parts.join('; ') || 'links reordered'}`;
    }
    case 'file.added':
      return `${files}: added ${fileName(e.newValue)}${fileVersion(e.newValue)}`;
    case 'file.replaced':
      return `${files}: replaced ${fileName(e.oldValue)} with ${fileName(e.newValue)}${fileVersion(e.newValue)}${e.note ? ` · Note: ${quote(e.note)}` : ''}`;
    case 'file.updated': {
      const v =
        e.newValue && typeof e.newValue === 'object' && !Array.isArray(e.newValue)
          ? e.newValue
          : {};
      const changed = Object.keys(FILE_DETAIL)
        .filter((k) => k in v)
        .map((k) => FILE_DETAIL[k]);
      return `${files}: changed the ${changed.join(', ') || 'details'} of ${fileName(e.newValue)}`;
    }
    case 'file.archived':
      return `${files}: archived ${fileName(e.oldValue)} and its versions${e.note ? ` (${e.note})` : ''}`;
    case 'file.restored':
      return `${files}: restored ${fileName(e.newValue)} and its versions`;
    case 'file.approved':
      return `Approved ${fileName(e.newValue)}${fileVersion(e.newValue)}${
        e.oldValue ? `; ${fileName(e.oldValue)}${fileVersion(e.oldValue)} is now obsolete` : ''
      }${e.note ? ` · Note: ${quote(e.note)}` : ''}`;
    case 'protected.changed':
      return `${fieldName(field)} changed (value hidden)`;
    case 'protected.cleared':
      return `${fieldName(field)} cleared`;
    case 'update.edited':
      return 'Edited an update';
    case 'update.deleted':
      return 'Deleted an update';
    case 'workflow.submitted':
    case 'workflow.decided':
    case 'workflow.approved':
    case 'workflow.rejected':
    case 'workflow.withdrawn':
      return approvalText(e);
    case 'automation.paused':
      return e.note
        ? `Paused the automation ${quote(e.note)} for this item`
        : 'Paused an automation';
    case 'automation.resumed':
      return e.note
        ? `Resumed the automation ${quote(e.note)} for this item`
        : 'Resumed an automation';
    default:
      return accessText(e, look) ?? e.action;
  }
}

const LEVEL_WORDS: Record<string, string> = {
  editor: 'can edit',
  commenter: 'can comment',
  viewer: 'can view',
};
const objOf = (v: Json | null) =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, Json>) : null;

/**
 * Access control entries (docs/02 §16) on a sheet's or the workspace's chain: restricting and opening, people listed
 * and taken off, restricted fields, an owner opening a restricted sheet. Null for other actions.
 */
export function accessText(
  e: Pick<ActivityEntry, 'action' | 'oldValue' | 'newValue' | 'note'>,
  look: Pick<ActivityLookup, 'personName'>,
): string | null {
  const o = objOf(e.oldValue);
  const n = objOf(e.newValue);
  const person = (v: Record<string, Json> | null) =>
    (typeof v?.user_id === 'string' && look.personName(v.user_id)) || 'A former member';
  const level = (v: Record<string, Json> | null) =>
    LEVEL_WORDS[String(v?.level ?? '')] ?? 'has access';
  const where = (v: Record<string, Json> | null) => (v?.folder_id ? ' on the folder' : '');
  switch (e.action) {
    case 'access.changed':
      return n?.mode === 'restricted'
        ? 'Restricted the sheet to the people listed'
        : n?.mode === 'open'
          ? 'Opened the sheet to everyone in the workspace'
          : 'The sheet now follows its folder';
    case 'access.granted':
    case 'folder.access.granted':
      return `${person(n)} ${level(n)}${where(n)}`;
    case 'access.level_changed':
    case 'folder.access.level_changed':
      return `${person(n)}: ${level(o)} → ${level(n)}${where(n)}`;
    case 'access.revoked':
    case 'folder.access.revoked':
      return `${person(o)} no longer has access${where(o)}`;
    case 'folder.access_changed':
      return n?.restricted ? (e.note ?? 'Restricted a folder') : (e.note ?? 'Opened a folder');
    case 'restricted.accessed':
      return 'Opened this restricted sheet as an owner who is not on the list';
    case 'field.restricted':
      return `Restricted the field ${quote(e.note ?? '')}`;
    case 'field.restriction_changed':
      return `Changed who sees the field ${quote(e.note ?? '')}`;
    case 'field.unrestricted':
      return `Lifted the restriction on the field ${quote(e.note ?? '')}`;
    case 'member.added':
      return `Added an auditor${n?.expires_at ? ` until ${String(n.expires_at).slice(0, 10)}` : ''}`;
    case 'member.changed':
      return `Changed a member's role to ${String(n?.role ?? '')}`;
    case 'member.removed':
      return 'Removed a member';
    default:
      return null;
  }
}

/** The access entries a sheet's Access panel lists (newest first). */
export const ACCESS_ACTIONS = [
  'access.changed',
  'access.granted',
  'access.level_changed',
  'access.revoked',
  'restricted.accessed',
  'field.restricted',
  'field.restriction_changed',
  'field.unrestricted',
] as const;

export function activityLine(e: ActivityEntry, look: ActivityLookup): ActivityLine {
  return { who: who(e, look), text: activityText(e, look), shortHash: e.hash.slice(0, 8) };
}

/** Item ids that link.changed entries mention: the panel loads their display ids. */
export function linkedIdsInLog(entries: ActivityEntry[]): string[] {
  const out = new Set<string>();
  for (const e of entries)
    if (e.action === 'link.changed')
      for (const id of [...ids(e.oldValue), ...ids(e.newValue)]) out.add(id);
  return [...out];
}

/** Item-chain entries only: schema entries live on the sheet chain and are not shown in the panel. */
export const isItemEntry = (e: { action: string }) =>
  !/^(sheets|fields|groups|automations)\./.test(e.action);
