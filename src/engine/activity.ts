// Activity log lines (docs/05 §3.4, FR-28/FR-39): one readable sentence per entry of an item's chain. Pure: the
// lookups for fields, groups, items and people are passed in; values are shown with the field type's toText.
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

function valueText(field: Field | undefined, v: Json | null, look: ActivityLookup): string {
  if (v === null || v === undefined) return EMPTY;
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

function fileName(v: Json | null): string {
  return v && typeof v === 'object' && !Array.isArray(v) && typeof v.filename === 'string'
    ? v.filename
    : 'a file';
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

/** The sentence for one entry: "Status: Working on it → Done", "Moved from Open to Done", … */
export function activityText(e: ActivityEntry, look: ActivityLookup): string {
  const field = e.fieldId ? look.field(e.fieldId) : undefined;
  const comment = e.note && e.action === 'value.changed' ? ` · Comment: ${quote(e.note)}` : '';
  switch (e.action) {
    case 'item.created': {
      const g =
        e.newValue && typeof e.newValue === 'object' && !Array.isArray(e.newValue)
          ? look.groupName(String(e.newValue.group_id ?? ''))
          : undefined;
      return g ? `Created in ${g}` : 'Created';
    }
    case 'value.changed': {
      const before = valueText(field, e.oldValue, look);
      const after = valueText(field, e.newValue, look);
      if (before === EMPTY) return `${fieldName(field)} set to ${after}${comment}`;
      if (after === EMPTY) return `${fieldName(field)} cleared (was ${before})${comment}`;
      return `${fieldName(field)}: ${before} → ${after}${comment}`;
    }
    case 'item.renamed':
      return `Renamed: ${quote(String(e.oldValue ?? ''))} → ${quote(String(e.newValue ?? ''))}`;
    case 'item.moved': {
      const from = look.groupName(String(e.oldValue ?? '')) ?? 'a deleted group';
      const to = look.groupName(String(e.newValue ?? '')) ?? 'a deleted group';
      return `Moved from ${from} to ${to}`;
    }
    case 'item.archived':
      return 'Archived';
    case 'item.restored':
      return 'Restored';
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
      return `${fieldName(field)}: added ${fileName(e.newValue)}`;
    case 'file.replaced':
      return `${fieldName(field)}: replaced ${fileName(e.oldValue)} with ${fileName(e.newValue)}`;
    case 'protected.changed':
      return `${fieldName(field)} changed (value hidden)`;
    case 'protected.cleared':
      return `${fieldName(field)} cleared`;
    case 'update.edited':
      return 'Edited an update';
    case 'update.deleted':
      return 'Deleted an update';
    default:
      return e.action;
  }
}

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
