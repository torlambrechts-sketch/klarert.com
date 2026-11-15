// The automation builder's rules (docs/04 §10), pure: which triggers, fields and actions are compatible, the plain
// words for a trigger, a condition and an action, the auto name, inline validation with the self-trigger guard, and
// "Test on an item" (trigger, conditions and planned steps without writing). The builder UI and the commands both
// use these, so the browser shows what the server will accept.
import { matches, conditionProblem, OP_LABEL } from '../conditions';
import { addDays, formatDate } from '../fields/helpers';
import { isVersionField } from '../fields/version';
import type { Automation, Condition, Ctx, Field, Item, Json, TriggerId } from '../types';
import { dateOf, defOf, keysOfValue, kindOf, valueOf } from '../values';
import { NO_VALUE_OPS } from '../views/apply';
import { isActionId, planActions, valueLabel, type PlanEnv } from './actions';
import { matchTrigger } from './triggers';
import { isItemFilesSource } from './schedule';
import { earliestValidUntil } from '../fields/evidence';
import { subitemRows } from './subitem-actions';
import { subitemTriggerField } from './subitem-triggers';
import { childSheetIdOf, subitemLabel, subitemsOf } from '../subitems';
import { type ActionId, type ActionJson, type AutomationEvent, type PlannedStep } from './types';
import { isWebhookPreset, savedWebhookHost } from './webhook';

type Trigger = Automation['trigger'];

/** What the builder edits and the commands save. */
export interface AutomationDraft {
  name: string;
  trigger: Trigger;
  conditions: Condition[];
  actions: ActionJson[];
}

/** The parameter a trigger takes besides its field (docs/04 §3). */
export type TriggerParam = 'value' | 'threshold' | 'offsetDays' | 'hoursLeft' | 'days' | null;

export const TRIGGER_IDS: TriggerId[] = [
  'field_becomes',
  'field_changed',
  'item_created',
  'form_submitted',
  'number_above',
  'number_below',
  'date_arrives',
  'clock_warning',
  'evidence_expiring',
  'button_clicked',
  'checklist_no',
  'subitem_created',
  'subitem_field_becomes',
  'all_subitems_done',
  'workflow_step_decided',
  'workflow_approved',
  'workflow_rejected',
  'approval_overdue',
];

export const TRIGGER_CATALOGUE: Record<
  TriggerId,
  {
    label: string;
    field: boolean;
    param: TriggerParam;
    scheduled?: true;
    /** The trigger can watch the item's Files tab instead of a field (source 'item_files', docs/04 §8). */
    itemFiles?: true;
    /** Sub-item triggers: the sheet must have sub-items; the field is a field of the sub-items. */
    subitems?: true;
    /** Approval workflow triggers: the sheet must have an approval workflow; `workflowId` null = any. */
    workflow?: true;
  }
> = {
  field_becomes: { label: 'a field becomes a value', field: true, param: 'value' },
  field_changed: { label: 'a field changes', field: true, param: null },
  item_created: { label: 'an item is created', field: false, param: null },
  form_submitted: { label: 'a form is submitted', field: false, param: null },
  number_above: { label: 'a number goes above', field: true, param: 'threshold' },
  number_below: { label: 'a number goes below', field: true, param: 'threshold' },
  date_arrives: { label: 'a date arrives', field: true, param: 'offsetDays', scheduled: true },
  clock_warning: { label: 'a clock runs low', field: true, param: 'hoursLeft', scheduled: true },
  evidence_expiring: {
    label: 'evidence is about to expire',
    field: true,
    param: 'days',
    scheduled: true,
    itemFiles: true,
  },
  button_clicked: { label: 'a button is clicked', field: true, param: null },
  checklist_no: { label: 'a checklist answer is No', field: true, param: null },
  subitem_created: { label: 'a sub-item is added', field: false, param: null, subitems: true },
  subitem_field_becomes: {
    label: 'a sub-item field becomes a value',
    field: true,
    param: 'value',
    subitems: true,
  },
  all_subitems_done: { label: 'every sub-item is done', field: false, param: null, subitems: true },
  workflow_step_decided: {
    label: 'an approval step is decided',
    field: false,
    param: null,
    workflow: true,
  },
  workflow_approved: {
    label: 'an approval is approved',
    field: false,
    param: null,
    workflow: true,
  },
  workflow_rejected: {
    label: 'an approval is rejected',
    field: false,
    param: null,
    workflow: true,
  },
  approval_overdue: {
    label: 'an approval step is overdue',
    field: false,
    param: null,
    scheduled: true,
    workflow: true,
  },
};

export const ACTION_CATALOGUE: Record<ActionId, { label: string }> = {
  set_field: { label: 'set a field' },
  notify: { label: 'notify people' },
  request_update: { label: 'ask for an update' },
  assign: { label: 'assign a person' },
  move_to_group: { label: 'move to a group' },
  lock_item: { label: 'lock the item' },
  post_update: { label: 'post an update' },
  create_item: { label: 'create an item' },
  update_linked: { label: 'update linked items' },
  raise_version: { label: 'raise a version' },
  webhook: { label: 'send a webhook' },
  create_subitems: { label: 'add sub-items' },
  set_parent_field: { label: 'set a field on the parent' },
  update_subitems: { label: 'update the sub-items' },
  sync_requirement_checks: { label: 'sync requirement checks' },
  start_workflow: { label: 'submit for approval' },
};

/** Builder order of the actions (most used first). */
export const ACTION_ORDER: ActionId[] = [
  'set_field',
  'notify',
  'request_update',
  'assign',
  'move_to_group',
  'lock_item',
  'post_update',
  'create_item',
  'update_linked',
  'raise_version',
  'webhook',
  'create_subitems',
  'update_subitems',
  'set_parent_field',
  'sync_requirement_checks',
  'start_workflow',
];

export const isTriggerId = (id: unknown): id is TriggerId =>
  typeof id === 'string' && Object.prototype.hasOwnProperty.call(TRIGGER_CATALOGUE, id);

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const sheetFields = (ctx: Ctx) => ctx.fieldsOf(ctx.sheet.id);

// ───────────────────────── compatibility ─────────────────────────

/**
 * Fields a trigger can watch (the field type lists the trigger in `def.triggers`): this sheet's, or for a sub-item
 * trigger the sub-items' fields that can "become" a value.
 */
export function triggerFields(type: TriggerId, ctx: Ctx): Field[] {
  if (TRIGGER_CATALOGUE[type]?.subitems) {
    const child = childSheetIdOf(ctx);
    return child
      ? ctx.fieldsOf(child).filter((f) => defOf(f).triggers.includes('field_becomes'))
      : [];
  }
  return sheetFields(ctx).filter(
    (f) =>
      defOf(f).triggers.includes(type) &&
      // a type whose kind depends on its settings (a formula) watches a date only when it gives a date
      (type !== 'date_arrives' || !defOf(f).effectiveKind || kindOf(f, ctx) === 'date'),
  );
}

/** The field a trigger names: this sheet's, or a sub-item field for sub-item triggers. */
export function triggerFieldOf(trigger: Trigger, ctx: Ctx): Field | undefined {
  if (TRIGGER_CATALOGUE[trigger.type]?.subitems) return subitemTriggerField(trigger, ctx);
  return typeof trigger.fieldKey === 'string' ? ctx.fieldsByKey.get(trigger.fieldKey) : undefined;
}

/** Triggers the sheet can use: those without a field, and those with at least one compatible field. */
export function availableTriggers(ctx: Ctx): TriggerId[] {
  return TRIGGER_IDS.filter((t) => {
    const spec = TRIGGER_CATALOGUE[t];
    if (spec.subitems && !childSheetIdOf(ctx)) return false;
    if (spec.workflow && !(ctx.sheet.workflows ?? []).length) return false;
    return !spec.field || !!spec.itemFiles || triggerFields(t, ctx).length > 0;
  });
}

const isStored = (f: Field) => defOf(f).storage === 'values';
const isPeople = (f: Field, ctx: Ctx) => kindOf(f, ctx) === 'people';

/** People fields (stored or lookups of people fields): recipients of notify, request_update. */
export function peopleFields(ctx: Ctx, sheetId = ctx.sheet.id): Field[] {
  return ctx.fieldsOf(sheetId).filter((f) => isPeople(f, ctx));
}

/** Stored fields of any sheet: what set_field, update_linked and create_item may write. */
export function storedFields(ctx: Ctx, sheetId = ctx.sheet.id): Field[] {
  return ctx.fieldsOf(sheetId).filter(isStored);
}

/** Fields an action can use for its `fieldKey` (docs/04 §10): set_field stored, assign people, raise_version version. */
export function actionFields(type: ActionId, ctx: Ctx): Field[] {
  const all = sheetFields(ctx);
  switch (type) {
    case 'set_field':
      return all.filter(isStored);
    case 'assign':
      return all.filter((f) => isStored(f) && isPeople(f, ctx));
    case 'request_update':
      return all.filter((f) => isPeople(f, ctx));
    case 'raise_version':
      return all.filter((f) => isStored(f) && isVersionField(f));
    case 'update_linked':
      return all.filter((f) => defOf(f).storage === 'links');
    case 'update_subitems': {
      const child = childSheetIdOf(ctx);
      return child ? storedFields(ctx, child) : [];
    }
    case 'set_parent_field':
      return ctx.sheet.parentSheetId ? storedFields(ctx, ctx.sheet.parentSheetId) : [];
    default:
      return [];
  }
}

const NEEDS_FIELD = new Set<ActionId>([
  'set_field',
  'assign',
  'request_update',
  'raise_version',
  'update_linked',
  'update_subitems',
  'set_parent_field',
]);

/** Actions the sheet can use (those that need a field only when one fits; sub-item actions only with sub-items). */
export function availableActions(ctx: Ctx): ActionId[] {
  return ACTION_ORDER.filter((a) => {
    if (a === 'create_subitems' && !childSheetIdOf(ctx)) return false;
    if (a === 'start_workflow' && !(ctx.sheet.workflows ?? []).length) return false;
    return !NEEDS_FIELD.has(a) || actionFields(a, ctx).length > 0;
  });
}

/** Link fields of this sheet and their target sheets (update_linked, direction out). */
export function linkTargetSheet(field: Field | undefined): string | null {
  const t = field ? (field.config as { targetSheetId?: unknown }).targetSheetId : null;
  return typeof t === 'string' ? t : null;
}

/** Link fields on other sheets that point at this sheet (update_linked, direction in). */
export function incomingLinkFields(ctx: Ctx, sheetIds: string[]): Field[] {
  return sheetIds
    .filter((id) => id !== ctx.sheet.id)
    .flatMap((id) => ctx.fieldsOf(id))
    .filter((f) => defOf(f).storage === 'links' && linkTargetSheet(f) === ctx.sheet.id);
}

// ───────────────────────── defaults ─────────────────────────

/** A new trigger of a type with the first compatible field and default parameters. */
export function defaultTrigger(type: TriggerId, ctx: Ctx): Trigger {
  const field = triggerFields(type, ctx)[0];
  const t: Trigger = { type };
  if (TRIGGER_CATALOGUE[type].field) t.fieldKey = field?.key ?? null;
  const param = TRIGGER_CATALOGUE[type].param;
  if (param === 'value') t.value = null;
  if (param === 'threshold') t.threshold = 0;
  if (param === 'offsetDays') t.offsetDays = 0;
  if (param === 'hoursLeft') t.hoursLeft = 24;
  if (param === 'days') t.days = 30;
  if (type === 'form_submitted') t.formId = null;
  if (TRIGGER_CATALOGUE[type].workflow) t.workflowId = null;
  if (type === 'workflow_step_decided') t.decision = null;
  return t;
}

/** A new action of a type with the first compatible field. */
export function defaultAction(type: ActionId, ctx: Ctx): ActionJson {
  const first = actionFields(type, ctx)[0]?.key ?? null;
  switch (type) {
    case 'set_field':
      return { type, fieldKey: first, value: null };
    case 'notify': {
      const p = peopleFields(ctx)[0];
      return { type, to: p ? [`field:${p.key}`] : [], message: '{id} {name}' };
    }
    case 'request_update':
      return { type, fieldKey: first, message: 'Please update {name}.' };
    case 'create_item':
      return {
        type,
        sheetId: null,
        groupId: null,
        name: 'Follow-up: {name}',
        values: {},
        link: true,
      };
    case 'update_linked':
      return {
        type,
        path: { direction: 'out', linkFieldKey: first },
        fieldKey: null,
        value: null,
      };
    case 'move_to_group': {
      const g = [...ctx.groups.values()].sort((a, b) => (a.position < b.position ? -1 : 1));
      return { type, groupId: g.at(-1)?.id ?? null };
    }
    case 'assign':
      return { type, fieldKey: first, who: 'actor' };
    case 'lock_item':
      return { type, reason: '' };
    case 'post_update':
      return { type, message: '' };
    case 'webhook':
      return { type, url: '', preset: 'generic' };
    case 'raise_version':
      return { type, fieldKey: first, kind: 'minor' };
    case 'create_subitems':
      return ctx.sheet.subitems?.template.length
        ? { type, fromTemplate: true }
        : { type, items: [{ name: '', values: {} }] };
    case 'update_subitems':
      return { type, fieldKey: first, value: null, onlyOpen: false };
    case 'set_parent_field':
      return { type, fieldKey: first, value: null };
    case 'sync_requirement_checks':
      return { type, sheetId: null };
    case 'start_workflow':
      return { type, workflowId: enabledWorkflowOf(ctx)?.id ?? null };
  }
}

const enabledWorkflowOf = (ctx: Ctx) =>
  (ctx.sheet.workflows ?? []).find((w) => w.enabled) ?? ctx.sheet.workflows?.[0];

/** The approval workflow a trigger or action names, by id, on this sheet. */
export function workflowName(id: unknown, ctx: Ctx): string | null {
  return typeof id === 'string'
    ? ((ctx.sheet.workflows ?? []).find((w) => w.id === id)?.name ?? null)
    : null;
}

/** A blank draft: the first trigger the sheet supports, no conditions, one empty slot for an action. */
export function emptyDraft(ctx: Ctx): AutomationDraft {
  const first = availableTriggers(ctx)[0] ?? 'item_created';
  return {
    name: '',
    trigger: defaultTrigger(first, ctx),
    conditions: [],
    actions: [defaultAction('notify', ctx)],
  };
}

// ───────────────────────── value tokens ─────────────────────────

export type ValueToken = { id: string; label: string };

/** Tokens a set_field value can use besides a literal (docs/04 §5): dates, the person who made the change, empty. */
export function valueTokens(field: Field, ctx: Ctx): ValueToken[] {
  const kind = kindOf(field, ctx);
  const out: ValueToken[] = [];
  if (kind === 'date')
    out.push(
      { id: '$today', label: 'Today, the day it runs' },
      { id: '$in:7', label: 'In 7 days' },
    );
  if (kind === 'people') out.push({ id: '$actor', label: 'The person who made the change' });
  out.push({ id: '$empty', label: 'Empty' });
  return out;
}

export const isToken = (v: unknown): v is string =>
  typeof v === 'string' && /^\$(today|empty|actor|in:-?\d{1,4})$/.test(v.trim());

export function tokenLabel(token: string): string {
  const t = token.trim();
  if (t === '$today') return 'Today';
  if (t === '$empty') return 'empty';
  if (t === '$actor') return 'the person who made the change';
  const m = t.match(/^\$in:(-?\d{1,4})$/);
  if (m) {
    const n = Number(m[1]);
    return n === 0 ? 'Today' : n < 0 ? `${dayWords(-n)} before today` : `${dayWords(n)} from today`;
  }
  return t;
}

/** How a set_field value reads: a token ("Today", "in 14 days") or the value as the field shows it. */
export function setValueText(field: Field | undefined, raw: Json | undefined, ctx: Ctx): string {
  if (raw === undefined || raw === null) return '…';
  if (isToken(raw)) return tokenLabel(raw);
  return field ? valueLabel(field, raw, ctx) : String(raw);
}

// ───────────────────────── plain words ─────────────────────────

const fieldName = (key: unknown, ctx: Ctx) =>
  (typeof key === 'string' && ctx.fieldsByKey.get(key)?.name) || 'a field';

/** The key a field_becomes trigger compares, read from any raw value the field's editor commits. */
export function becomesKey(
  field: Field,
  raw: unknown,
  ctx: Ctx,
  previous?: unknown,
): string | null {
  const v =
    raw === null || raw === undefined ? null : defOf(field).normalize(raw, field.config, ctx);
  const keys = keysOfValue(field, v);
  return keys.find((k) => k !== previous) ?? keys[0] ?? null;
}

/** The label of one key of a field (an option, a person, Yes/No). */
export function keyLabel(field: Field, key: string, ctx: Ctx): string {
  const def = defOf(field);
  const option = def.options?.(field.config, ctx).find((o) => o.id === key);
  if (option) return option.label;
  const person = ctx.people.get(key);
  if (person) return person.name;
  const v = def.normalize(key, field.config, ctx);
  return (v === null ? '' : def.toText(v, field.config, ctx)) || key;
}

function dayWords(n: number) {
  return `${n} ${Math.abs(n) === 1 ? 'day' : 'days'}`;
}

/** "When Status becomes Done", "When Review date is 30 days away". */
export function describeTrigger(trigger: Trigger, ctx: Ctx): string {
  const field = triggerFieldOf(trigger, ctx);
  const name = isItemFilesSource(trigger)
    ? 'an item file'
    : (field?.name ?? fieldName(trigger.fieldKey, ctx));
  const sub = subitemLabel(ctx.sheet, 1).toLowerCase();
  switch (trigger.type) {
    case 'item_created': {
      const label = ctx.sheet.itemLabel.trim().toLowerCase() || 'item';
      return `When ${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label} is created`;
    }
    case 'form_submitted':
      return 'When a form is submitted';
    case 'field_changed':
      return `When ${name} changes`;
    case 'field_becomes': {
      const v = str(trigger.value);
      return `When ${name} becomes ${v && field ? keyLabel(field, v, ctx) : '…'}`;
    }
    case 'number_above':
      return `When ${name} goes above ${isNum(trigger.threshold) ? trigger.threshold : '…'}`;
    case 'number_below':
      return `When ${name} goes below ${isNum(trigger.threshold) ? trigger.threshold : '…'}`;
    case 'date_arrives': {
      const n = isNum(trigger.offsetDays) ? trigger.offsetDays : 0;
      if (n === 0) return `When ${name} arrives`;
      return n < 0 ? `When ${name} is ${dayWords(-n)} away` : `When ${name} is ${dayWords(n)} past`;
    }
    case 'clock_warning': {
      const h = isNum(trigger.hoursLeft) ? trigger.hoursLeft : 0;
      return `When ${name} has less than ${h} ${h === 1 ? 'hour' : 'hours'} left`;
    }
    case 'evidence_expiring':
      return `When ${name} expires within ${dayWords(isNum(trigger.days) ? trigger.days : 0)}`;
    case 'button_clicked':
      return `When ${name} is clicked`;
    case 'checklist_no':
      return `When ${name} gets a No answer`;
    case 'subitem_created':
      return `When ${/^[aeiou]/.test(sub) ? 'an' : 'a'} ${sub} is added`;
    case 'subitem_field_becomes': {
      const v = str(trigger.value);
      return `When ${/^[aeiou]/.test(sub) ? 'an' : 'a'} ${sub}'s ${name} becomes ${v && field ? keyLabel(field, v, ctx) : '…'}`;
    }
    case 'all_subitems_done':
      return `When every ${sub} is done`;
    case 'workflow_step_decided': {
      const w = workflowName(trigger.workflowId, ctx);
      const what =
        trigger.decision === 'approved'
          ? 'is approved'
          : trigger.decision === 'rejected'
            ? 'is rejected'
            : 'is decided';
      return `When a step of ${w ?? 'an approval'} ${what}`;
    }
    case 'workflow_approved':
      return `When ${workflowName(trigger.workflowId, ctx) ?? 'an approval'} is approved`;
    case 'workflow_rejected':
      return `When ${workflowName(trigger.workflowId, ctx) ?? 'an approval'} is rejected`;
    case 'approval_overdue':
      return `When a step of ${workflowName(trigger.workflowId, ctx) ?? 'an approval'} is overdue`;
  }
  return 'When something happens';
}

const SPECIAL_NAMES: Record<string, string> = {
  __name: 'Name',
  __group: 'Group',
  __id: 'ID',
  __missing: 'Missing required',
};

/** Label of one chosen value of a condition (an option, a person, a group). */
function conditionValueLabel(key: string, id: string, ctx: Ctx): string {
  if (key === '__group') return ctx.groups.get(id)?.name ?? id;
  if (id === 'me') return 'me';
  const field = ctx.fieldsByKey.get(key);
  return field ? keyLabel(field, id, ctx) : id;
}

/** "Severity is at least High", "Group is any of Open, Review". */
export function describeCondition(cond: Condition, ctx: Ctx): string {
  const name =
    SPECIAL_NAMES[cond.fieldKey] ?? ctx.fieldsByKey.get(cond.fieldKey)?.name ?? cond.fieldKey;
  const op = OP_LABEL[cond.op] ?? cond.op;
  if (NO_VALUE_OPS.has(cond.op)) return `${name} ${op}`;
  const v = cond.value;
  if (op.includes('…')) return `${name} ${op.replace('…', String(v ?? '…'))}`;
  if (Array.isArray(v)) {
    if (cond.op === 'between')
      return `${name} ${op} ${String(v[0] ?? '…')} and ${String(v[1] ?? '…')}`;
    const labels = v.map((x) => conditionValueLabel(cond.fieldKey, String(x), ctx));
    return `${name} ${op} ${labels.join(', ') || '…'}`;
  }
  if (v === null || v === undefined || v === '') return `${name} ${op} …`;
  return `${name} ${op} ${conditionValueLabel(cond.fieldKey, String(v), ctx)}`;
}

/** Recipients in words: "Owner", "Maria Pereira", "the person who made the change". */
export function describeRecipients(to: Json | undefined, ctx: Ctx): string {
  const names = (Array.isArray(to) ? to : []).flatMap((entry) => {
    if (typeof entry !== 'string') return [];
    if (entry === 'actor') return ['the person who made the change'];
    const i = entry.indexOf(':');
    const kind = entry.slice(0, i);
    const id = entry.slice(i + 1);
    if (kind === 'field') return [ctx.fieldsByKey.get(id)?.name ?? id];
    if (kind === 'user') return [ctx.people.get(id)?.name ?? 'someone'];
    if (kind === 'team') return [ctx.teams.get(id)?.name ?? 'a team'];
    if (kind === 'jobRole') return [ctx.jobRoles.get(id)?.name ?? 'a job role'];
    return [];
  });
  return joinWords(names) || 'no one';
}

export function joinWords(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** "notify Owner", "set Date to Today", "lock". `sheetName` names target sheets of create_item. */
export function describeAction(
  action: ActionJson,
  ctx: Ctx,
  sheetName: (id: string) => string | undefined = () => undefined,
): string {
  const field =
    typeof action.fieldKey === 'string' ? ctx.fieldsByKey.get(action.fieldKey) : undefined;
  const name = fieldName(action.fieldKey, ctx);
  switch (action.type) {
    case 'set_field':
      return `set ${name} to ${setValueText(field, action.value, ctx)}`;
    case 'notify':
      return `notify ${describeRecipients(action.to, ctx)}`;
    case 'request_update':
      return `ask ${name} for an update`;
    case 'create_item': {
      const s = str(action.sheetId);
      return `create an item on ${(s && sheetName(s)) || '…'}`;
    }
    case 'update_linked': {
      const path = (
        action.path && typeof action.path === 'object' && !Array.isArray(action.path)
          ? action.path
          : {}
      ) as Record<string, Json>;
      const link = str(path.linkFieldKey);
      if (path.direction === 'in') return 'update items that link here';
      return `update ${(link && ctx.fieldsByKey.get(link)?.name) || 'linked items'}`;
    }
    case 'move_to_group':
      return `move to ${ctx.groups.get(str(action.groupId) ?? '')?.name ?? '…'}`;
    case 'assign': {
      const who = str(action.who);
      const person =
        who === 'actor'
          ? 'the person who made the change'
          : who?.startsWith('user:')
            ? (ctx.people.get(who.slice(5))?.name ?? 'someone')
            : '…';
      return `assign ${person} to ${name}`;
    }
    case 'lock_item':
      return 'lock';
    case 'post_update':
      return 'post an update';
    case 'webhook': {
      const preset = action.preset;
      return preset === 'teams'
        ? 'post to Teams'
        : preset === 'slack'
          ? 'post to Slack'
          : 'send a webhook';
    }
    case 'raise_version':
      return `raise ${name}`;
    case 'create_subitems': {
      const n = subitemRows(action, ctx).length;
      return `add ${n} ${subitemLabel(ctx.sheet, n).toLowerCase()}`;
    }
    case 'update_subitems': {
      const f = actionFields('update_subitems', ctx).find((x) => x.key === action.fieldKey);
      return `set ${f?.name ?? 'a field'} on the ${subitemLabel(ctx.sheet).toLowerCase()} to ${setValueText(f, action.value, ctx)}`;
    }
    case 'set_parent_field': {
      const f = actionFields('set_parent_field', ctx).find((x) => x.key === action.fieldKey);
      return `set ${f?.name ?? 'a field'} on the parent to ${setValueText(f, action.value, ctx)}`;
    }
    case 'sync_requirement_checks': {
      const s = str(action.sheetId);
      return `sync the requirement checks on ${(s && sheetName(s)) || '…'}`;
    }
    case 'start_workflow':
      return `submit for approval (${workflowName(action.workflowId, ctx) ?? '…'})`;
  }
  return 'do something';
}

/** The auto name (docs/04 §10): "When Status becomes Done → notify Owner". */
export function autoName(
  draft: Pick<AutomationDraft, 'trigger' | 'actions'>,
  ctx: Ctx,
  sheetName?: (id: string) => string | undefined,
): string {
  const then = joinWords(draft.actions.map((a) => describeAction(a, ctx, sheetName)));
  return `${describeTrigger(draft.trigger, ctx)} → ${then || '…'}`.slice(0, 200);
}

/** The whole rule as one sentence: "When Status becomes Done, and only if Severity is High, then notify Owner and lock." */
export function describeAutomation(
  draft: Pick<AutomationDraft, 'trigger' | 'conditions' | 'actions'>,
  ctx: Ctx,
  sheetName?: (id: string) => string | undefined,
): string {
  const when = describeTrigger(draft.trigger, ctx);
  const ifs = (draft.conditions ?? []).map((c) => describeCondition(c, ctx));
  const then = joinWords(draft.actions.map((a) => describeAction(a, ctx, sheetName)));
  const only = ifs.length ? `, and only if ${joinWords(ifs)}` : '';
  return then ? `${when}${only}, then ${then}.` : `${when}${only}, then …`;
}

// ───────────────────────── validation ─────────────────────────

/** Actions that write a field of the item they run on. */
const WRITES_OWN_FIELD = new Set(['set_field', 'assign', 'raise_version']);

export const SELF_TRIGGER = 'This would trigger itself';

/**
 * The instant loop (docs/04 §10): a field_changed automation that sets the field it watches. Returns the indexes of
 * the actions that would.
 */
export function selfTriggering(draft: Pick<AutomationDraft, 'trigger' | 'actions'>): number[] {
  if (draft.trigger.type !== 'field_changed') return [];
  const key = str(draft.trigger.fieldKey);
  if (!key) return [];
  return draft.actions.flatMap((a, i) =>
    WRITES_OWN_FIELD.has(a.type) && a.fieldKey === key ? [i] : [],
  );
}

export interface ValidationEnv {
  /** Sheets of the workspace (create_item, update_linked in). Unknown sheets fail validation when given. */
  sheetIds?: string[];
}

/** Problems keyed by where the builder shows them: `name`, `trigger`, `conditions.<i>`, `actions`, `actions.<i>`. */
export type DraftProblems = Record<string, string>;

const blankValue = (v: Json | undefined) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function triggerProblem(trigger: Trigger, ctx: Ctx): string | null {
  if (!isTriggerId(trigger.type)) return 'Choose a trigger.';
  const spec = TRIGGER_CATALOGUE[trigger.type];
  if (spec.subitems && !childSheetIdOf(ctx)) return 'Turn on sub-items for this sheet first.';
  if (spec.workflow) {
    if (!(ctx.sheet.workflows ?? []).length)
      return 'Set up an approval workflow for this sheet first.';
    if (
      trigger.workflowId !== null &&
      trigger.workflowId !== undefined &&
      !workflowName(trigger.workflowId, ctx)
    )
      return 'This approval workflow no longer exists.';
  }
  if (spec.field && !(spec.itemFiles && isItemFilesSource(trigger))) {
    const key = str(trigger.fieldKey);
    const field = triggerFieldOf(trigger, ctx);
    if (!field) return key ? `The field "${key}" no longer exists.` : 'Choose a field.';
    if (!spec.subitems && !defOf(field).triggers.includes(trigger.type))
      return `${field.name} cannot be used with this trigger.`;
  }
  switch (spec.param) {
    case 'value':
      return str(trigger.value) ? null : 'Choose a value.';
    case 'threshold':
      return isNum(trigger.threshold) ? null : 'Enter a number.';
    case 'offsetDays':
      return isNum(trigger.offsetDays) &&
        Number.isInteger(trigger.offsetDays) &&
        Math.abs(trigger.offsetDays) <= 3650
        ? null
        : 'Enter a whole number of days.';
    case 'hoursLeft':
      return isNum(trigger.hoursLeft) && trigger.hoursLeft > 0
        ? null
        : 'Enter a number of hours above 0.';
    case 'days':
      return isNum(trigger.days) && Number.isInteger(trigger.days) && trigger.days > 0
        ? null
        : 'Enter a number of days above 0.';
  }
  return null;
}

function conditionProblemOf(cond: Condition, ctx: Ctx): string | null {
  const p = conditionProblem(cond, ctx);
  if (p) return p;
  if (!NO_VALUE_OPS.has(cond.op) && blankValue(cond.value)) return 'Choose a value.';
  return null;
}

/** A literal or token for a field: tokens must suit the field, literals must normalise. */
function valueProblem(field: Field, raw: Json | undefined, ctx: Ctx): string | null {
  if (raw === undefined || raw === null || raw === '') return 'Choose a value.';
  if (isToken(raw)) {
    const ok = valueTokens(field, ctx).some(
      (t) => t.id === raw || (raw.startsWith('$in:') && t.id.startsWith('$in:')),
    );
    return ok ? null : `${field.name} cannot take this value.`;
  }
  return defOf(field).normalize(raw, field.config, ctx) === null
    ? `This value does not fit ${field.name}.`
    : null;
}

function fieldOf(action: ActionJson, list: Field[]): Field | string {
  const key = str(action.fieldKey);
  const field = key ? list.find((f) => f.key === key) : undefined;
  return field ?? (key ? 'This field cannot be used here.' : 'Choose a field.');
}

function actionProblem(action: ActionJson, ctx: Ctx, env: ValidationEnv): string | null {
  if (!isActionId(action.type)) return 'This action is not supported.';
  const type = action.type;
  if (NEEDS_FIELD.has(type) && type !== 'update_linked') {
    const f = fieldOf(action, actionFields(type, ctx));
    if (typeof f === 'string') return f;
    if (type === 'set_field' || type === 'set_parent_field' || type === 'update_subitems')
      return valueProblem(f, action.value, ctx);
    if (type === 'raise_version')
      return action.kind === 'major' || action.kind === 'minor' ? null : 'Choose minor or major.';
    if (type === 'assign') {
      const who = str(action.who);
      if (who === 'actor') return null;
      return who?.startsWith('user:') && ctx.people.has(who.slice(5)) ? null : 'Choose a person.';
    }
    return null;
  }
  switch (type) {
    case 'notify': {
      const to = Array.isArray(action.to) ? action.to : [];
      if (to.length === 0) return 'Choose who to notify.';
      for (const entry of to) {
        if (typeof entry !== 'string') return 'Choose who to notify.';
        if (entry.startsWith('field:')) {
          const f = ctx.fieldsByKey.get(entry.slice(6));
          if (!f || !isPeople(f, ctx)) return 'Choose a people field.';
        }
      }
      return null;
    }
    case 'create_item': {
      const s = str(action.sheetId);
      if (!s || (env.sheetIds && !env.sheetIds.includes(s)))
        return 'Choose the sheet to create on.';
      return str(action.name) ? null : 'Enter a name for the new item.';
    }
    case 'update_linked': {
      const path = (
        action.path && typeof action.path === 'object' && !Array.isArray(action.path)
          ? action.path
          : {}
      ) as Record<string, Json>;
      const linkKey = str(path.linkFieldKey);
      let target: string | null;
      if (path.direction === 'in') {
        const from = str(path.sheetId);
        if (!from || (env.sheetIds && !env.sheetIds.includes(from)))
          return 'Choose the sheet that links here.';
        const link = ctx.fieldsOf(from).find((f) => f.key === linkKey);
        if (!link || linkTargetSheet(link) !== ctx.sheet.id) return 'Choose the link field.';
        target = from;
      } else {
        const link = linkKey
          ? actionFields('update_linked', ctx).find((f) => f.key === linkKey)
          : undefined;
        if (!link) return 'Choose the link field.';
        target = linkTargetSheet(link);
      }
      const fieldKey = str(action.fieldKey);
      if (!fieldKey) return 'Choose the field to set on the linked items.';
      const targetFields = target ? storedFields(ctx, target) : [];
      const tf = targetFields.find((f) => f.key === fieldKey);
      if (!tf) return targetFields.length ? 'Choose the field to set on the linked items.' : null;
      return valueProblem(tf, action.value, ctx);
    }
    case 'move_to_group':
      return ctx.groups.has(str(action.groupId) ?? '') ? null : 'Choose a group.';
    case 'sync_requirement_checks': {
      const s = str(action.sheetId);
      return !s || (env.sheetIds && !env.sheetIds.includes(s))
        ? 'Choose the sheet that holds the checks.'
        : null;
    }
    case 'create_subitems':
      if (!childSheetIdOf(ctx)) return 'Turn on sub-items for this sheet first.';
      return subitemRows(action, ctx).length > 0 ? null : 'Add at least one sub-item with a name.';
    case 'lock_item':
      return null;
    case 'start_workflow':
      return workflowName(action.workflowId, ctx)
        ? null
        : str(action.workflowId)
          ? 'This approval workflow no longer exists.'
          : 'Choose an approval workflow.';
    case 'post_update':
      return str(action.message) ? null : 'Write the update to post.';
    case 'webhook': {
      const url = str(action.url)?.trim() ?? '';
      let ok = false;
      try {
        ok = url.startsWith('https://') && !!new URL(url).host;
      } catch {
        ok = false;
      }
      // the address saved before (0056) is kept unless a new one is typed
      if (!url && savedWebhookHost(action)) ok = true;
      if (!ok) return 'Enter an address that starts with https://.';
      return isWebhookPreset(action.preset) ? null : 'Choose a format.';
    }
  }
  return null;
}

/** Inline validation (docs/04 §10). Empty when the draft can be saved. */
export function draftProblems(
  draft: AutomationDraft,
  ctx: Ctx,
  env: ValidationEnv = {},
): DraftProblems {
  const out: DraftProblems = {};
  if (draft.name.trim().length > 200) out.name = 'Use at most 200 characters.';
  const t = triggerProblem(draft.trigger, ctx);
  if (t) out.trigger = t;
  draft.conditions.forEach((c, i) => {
    const p = conditionProblemOf(c, ctx);
    if (p) out[`conditions.${i}`] = p;
  });
  if (draft.actions.length === 0) out.actions = 'Add an action.';
  draft.actions.forEach((a, i) => {
    const p = actionProblem(a, ctx, env);
    if (p) out[`actions.${i}`] = p;
  });
  for (const i of selfTriggering(draft))
    out[`actions.${i}`] = `${SELF_TRIGGER}: it sets the field it watches.`;
  return out;
}

// ───────────────────────── Test on an item ─────────────────────────

export type TriggerCheck = 'matches' | 'no_match' | 'event';

export interface TestResult {
  trigger: { check: TriggerCheck; text: string };
  conditions: { text: string; ok: boolean }[];
  conditionsOk: boolean;
  steps: PlannedStep[];
  /** The trigger matches (or is an event) and every condition holds. */
  wouldRun: boolean;
}

const actorOf = (ctx: Ctx) => ({ kind: 'user' as const, id: ctx.userId });

/** The event a trigger would see for the item as it is now (before = empty). */
function eventFor(
  trigger: Trigger,
  item: Item,
  field: Field | undefined,
  ctx: Ctx,
): AutomationEvent {
  const base = { sheetId: item.sheetId, itemId: item.id, actor: actorOf(ctx) };
  switch (trigger.type) {
    case 'item_created':
      return { type: 'item.created', ...base };
    case 'form_submitted':
      return { type: 'form.submitted', ...base, formId: str(trigger.formId) };
    case 'button_clicked':
      return { type: 'button.clicked', ...base, fieldId: field?.id ?? '' };
    case 'date_arrives':
    case 'clock_warning':
    case 'evidence_expiring':
    case 'approval_overdue':
      return { type: 'schedule', ...base, automationId: 'test', occurrence: ctx.today };
    case 'workflow_step_decided':
    case 'workflow_approved':
    case 'workflow_rejected': {
      const w =
        (ctx.sheet.workflows ?? []).find((x) => x.id === trigger.workflowId) ??
        ctx.sheet.workflows?.[0];
      const decision =
        trigger.type === 'workflow_rejected' || trigger.decision === 'rejected'
          ? 'rejected'
          : 'approved';
      return {
        type: 'workflow.event',
        ...base,
        kind:
          trigger.type === 'workflow_step_decided'
            ? 'decided'
            : trigger.type === 'workflow_approved'
              ? 'approved'
              : 'rejected',
        workflowId: w?.id ?? '',
        instanceId: 'test',
        stepIndex: 0,
        stepId: w?.steps[0]?.id ?? '',
        decision,
      };
    }
    case 'subitem_created':
    case 'subitem_field_becomes':
    case 'all_subitems_done': {
      // the item's first sub-item, as if it had just been added (or its field had just changed to its value)
      const child = subitemsOf(item, ctx)[0];
      const childBase = {
        sheetId: child?.sheetId ?? '',
        itemId: child?.id ?? '',
        actor: actorOf(ctx),
      };
      return {
        type: 'subitem.event',
        ...base,
        subitemId: child?.id ?? '',
        event:
          trigger.type === 'subitem_field_becomes' && field && child
            ? {
                type: 'value.changed',
                ...childBase,
                fieldId: field.id,
                before: null,
                after: valueOf(child, field, ctx),
              }
            : { type: 'item.created', ...childBase },
      };
    }
    default:
      return {
        type: 'value.changed',
        ...base,
        fieldId: field?.id ?? '',
        before: null,
        after: field ? valueOf(item, field, ctx) : null,
      };
  }
}

function checkTrigger(trigger: Trigger, item: Item, ctx: Ctx): TestResult['trigger'] {
  const field = triggerFieldOf(trigger, ctx);
  if (TRIGGER_CATALOGUE[trigger.type]?.subitems) {
    const first = subitemsOf(item, ctx)[0];
    if (!first)
      return {
        check: 'no_match',
        text: `${item.displayId} has no ${subitemLabel(ctx.sheet).toLowerCase()}, so the test has nothing to go on.`,
      };
    if (trigger.type === 'subitem_created')
      return {
        check: 'event',
        text: `${describeTrigger(trigger, ctx)}. The test acts as if ${first.displayId} had just been added.`,
      };
    const ok = matchTrigger(trigger, eventFor(trigger, item, field, ctx), ctx, 'test');
    return {
      check: ok ? 'matches' : 'no_match',
      text: ok
        ? `${describeTrigger(trigger, ctx)}: this matches ${first.displayId} as it is now.`
        : `${describeTrigger(trigger, ctx)}: this does not match as things are now.`,
    };
  }
  const now = field ? valueOf(item, field, ctx) : null;
  const shown = field && now !== null ? defOf(field).toText(now as never, field.config, ctx) : '';
  const is = shown ? `${field?.name} is ${shown}` : `${field?.name ?? 'The field'} is empty`;
  switch (trigger.type) {
    case 'item_created':
    case 'form_submitted':
    case 'button_clicked':
    case 'workflow_step_decided':
    case 'workflow_approved':
    case 'workflow_rejected':
      return {
        check: 'event',
        text: `${describeTrigger(trigger, ctx)}. The test acts as if that just happened.`,
      };
    case 'field_changed':
      return {
        check: 'event',
        text: `${describeTrigger(trigger, ctx)}. The test acts as if it just changed to its current value.`,
      };
    case 'approval_overdue':
      return {
        check: 'event',
        text: `${describeTrigger(trigger, ctx)}. Date checks run it once per step when its time limit passes.`,
      };
    case 'date_arrives':
    case 'clock_warning':
    case 'evidence_expiring': {
      const date = isItemFilesSource(trigger)
        ? earliestValidUntil(ctx.files(item.id, null))
        : field
          ? dateOf(item, field, ctx)
          : null;
      if (!date)
        return {
          check: 'no_match',
          text: isItemFilesSource(trigger)
            ? 'No item file has a valid-until date, so date checks skip this item.'
            : `${is}, so date checks skip this item.`,
        };
      const offset =
        trigger.type === 'date_arrives'
          ? isNum(trigger.offsetDays)
            ? trigger.offsetDays
            : 0
          : trigger.type === 'clock_warning'
            ? -Math.ceil((isNum(trigger.hoursLeft) ? trigger.hoursLeft : 0) / 24)
            : -(isNum(trigger.days) ? trigger.days : 0);
      const moment = addDays(date, offset);
      const passed = ctx.today >= moment;
      return {
        check: passed ? 'matches' : 'no_match',
        text: passed
          ? `The moment, ${formatDate(moment)}, has passed. Date checks would run it for this item.`
          : `The moment is ${formatDate(moment)}, still to come.`,
      };
    }
  }
  const ok = matchTrigger(trigger, eventFor(trigger, item, field, ctx), ctx, 'test');
  return {
    check: ok ? 'matches' : 'no_match',
    text: ok ? `${is}, so this matches.` : `${is}, so this does not match.`,
  };
}

/**
 * "Test on an item" (docs/04 §10): does the trigger match the item as it is, do the conditions hold, and which steps
 * would run. Pure: plans with planActions and writes nothing.
 */
export function testOnItem(
  draft: AutomationDraft,
  item: Item,
  ctx: Ctx,
  env: Omit<PlanEnv, 'actor'>,
): TestResult {
  const trigger = checkTrigger(draft.trigger, item, ctx);
  const conditions = draft.conditions.map((c) => ({
    text: describeCondition(c, ctx),
    ok: !conditionProblem(c, ctx) && matches(c, item, ctx),
  }));
  const conditionsOk = conditions.every((c) => c.ok);
  const event = eventFor(draft.trigger, item, triggerFieldOf(draft.trigger, ctx), ctx);
  const steps = planActions(draft.actions, item, event, ctx, { ...env, actor: actorOf(ctx) });
  return {
    trigger,
    conditions,
    conditionsOk,
    steps,
    wouldRun: trigger.check !== 'no_match' && conditionsOk,
  };
}

/** Template keys for `{` autocomplete in messages (docs/04 §6): the built-ins, then the sheet's field keys. */
export function templateKeys(ctx: Ctx): { key: string; label: string }[] {
  return [
    { key: 'name', label: 'Item name' },
    { key: 'id', label: 'Item ID' },
    { key: 'sheet', label: 'Sheet name' },
    { key: 'group', label: 'Group name' },
    { key: 'link', label: 'Link to the item' },
    { key: 'actor', label: 'Person who made the change' },
    ...sheetFields(ctx)
      .filter((f) => defOf(f).storage !== 'none')
      .map((f) => ({ key: f.key, label: f.name })),
  ];
}

/** The `{` token being typed at the caret, if any: the partial key and where it starts. */
export function templateQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = before.match(/\{([A-Za-z0-9_]*)$/);
  return m ? { start: caret - m[0].length, query: m[1]!.toLowerCase() } : null;
}

/** Insert `{key}` for the token at the caret; returns the new text and caret. */
export function insertTemplateKey(
  text: string,
  caret: number,
  key: string,
): { text: string; caret: number } {
  const q = templateQuery(text, caret);
  const start = q ? q.start : caret;
  const token = `{${key}}`;
  return { text: text.slice(0, start) + token + text.slice(caret), caret: start + token.length };
}

/**
 * The builder's Ctx: the sheet's own Ctx, with the fields of every other sheet of the workspace (create_item values,
 * update_linked targets and incoming links). Pure; the browser and the commands build it the same way.
 */
export function withWorkspaceFields(ctx: Ctx, fields: Field[]): Ctx {
  const bySheet = new Map<string, Field[]>();
  for (const f of [...fields].sort((a, b) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
  )) {
    if (f.sheetId === ctx.sheet.id) continue;
    bySheet.set(f.sheetId, [...(bySheet.get(f.sheetId) ?? []), f]);
  }
  return {
    ...ctx,
    fieldsOf: (sheetId) =>
      sheetId === ctx.sheet.id
        ? ctx.fieldsOf(sheetId)
        : (bySheet.get(sheetId) ?? ctx.fieldsOf(sheetId)),
  };
}
