// Retention rules (docs/02 §18, owner decision "rules + review queue"). A sheet keeps its rules as data in
// sheets.settings.retention; packs ship them in their manifests. Pure: which items are due, the rules in words, and
// which fields are personal data. Nothing here erases anything: due items go to the review queue, a person approves.
import { z } from 'zod';
import { checkConditions } from '../automations';
import { addDays, addMonths, formatDate, isoDateInZone } from '../fields/helpers';
import { itemStatusField } from '../fields/item-status';
import { dateOf, isDoneOf } from '../values';
import type { Condition, Ctx, Field, Item, Json } from '../types';

export const RETENTION_ACTIONS = ['erase', 'anonymise', 'archive'] as const;
export type RetentionAction = (typeof RETENTION_ACTIONS)[number];
export const RETENTION_UNITS = ['days', 'months', 'years'] as const;

const fieldKey = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const conditionSchema = z.object({
  fieldKey: z.string().min(1).max(60),
  op: z.string().min(1).max(40),
  value: z.custom<Json>().optional(),
});

/** When the clock starts: a date field of the item, or when the item was created or last changed. */
export const retentionFromSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('field'), fieldKey }),
  z.object({ kind: z.literal('created') }),
  z.object({ kind: z.literal('updated') }),
]);

const ruleBase = z.object({
  /** Stable id: the queue's dedupe key names it. */
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
  name: z.string().trim().min(1).max(80),
  from: retentionFromSchema,
  period: z.object({ n: z.number().int().min(1).max(1200), unit: z.enum(RETENTION_UNITS) }),
  action: z.enum(RETENTION_ACTIONS),
  /** Personal-data fields to erase (keys); absent or empty: every field marked personal data. */
  fieldKeys: z.array(fieldKey).max(100).optional(),
  /** Also erase the item files marked personal data (anonymise always does). */
  files: z.boolean().optional(),
  /** Also remove the item's comments (anonymise always does). */
  comments: z.boolean().optional(),
  /** Archive the item once erased. */
  archiveItem: z.boolean().optional(),
  /** Only items that are done (the sheet's status field). */
  onlyDone: z.boolean().optional(),
  /** Only items matching every condition (the view filter operators). */
  conditions: z.array(conditionSchema).max(10).optional(),
  /** Why this period: shown with the rule and in the queue. */
  note: z.string().trim().max(500).optional(),
});

/** A rule as stored in sheets.settings.retention.rules: groups by id. */
export const retentionRuleSchema = ruleBase.extend({
  groupIds: z.array(z.string().min(1).max(64)).max(50).optional(),
});
export type RetentionRule = z.infer<typeof retentionRuleSchema>;

/** A rule in a template or pack manifest: groups by the sheet's group refs. */
export const templateRetentionRuleSchema = ruleBase.extend({
  groups: z.array(z.string().min(1).max(80)).max(50).optional(),
});
export type TemplateRetentionRule = z.infer<typeof templateRetentionRuleSchema>;

export const retentionSettingsSchema = z.object({
  /** Item names on this sheet may hold personal data: the log masks them and anonymise replaces them. */
  personalNames: z.boolean().optional(),
  rules: z.array(retentionRuleSchema).max(20),
});
export type RetentionSettings = z.infer<typeof retentionSettingsSchema>;

/** Rules must have distinct ids. */
export function retentionProblems(rules: readonly { id: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rules) {
    if (seen.has(r.id)) out.push(`Two retention rules share the id ${r.id}.`);
    seen.add(r.id);
  }
  return out;
}

/** sheets.settings.retention, read leniently: broken rules are dropped. */
export function readRetention(settings: unknown): RetentionSettings {
  const raw =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as { retention?: unknown }).retention
      : undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { rules: [] };
  const r = raw as { personalNames?: unknown; rules?: unknown };
  const rules = (Array.isArray(r.rules) ? r.rules : [])
    .map((x) => retentionRuleSchema.safeParse(x))
    .filter((p) => p.success)
    .map((p) => p.data);
  return { ...(r.personalNames === true ? { personalNames: true } : {}), rules };
}

/** The field is personal data (fields.config.personalData). */
export function isPersonalField(field: Pick<Field, 'config'>): boolean {
  const c = field.config as { personalData?: unknown } | null;
  return !!c && typeof c === 'object' && c.personalData === true;
}

/** The fields a rule erases: its keys among the personal-data fields, or all of them. */
export function erasedFields(rule: RetentionRule, fields: readonly Field[]): Field[] {
  const personal = fields.filter(isPersonalField);
  if (!rule.fieldKeys?.length) return personal;
  const keys = new Set(rule.fieldKeys);
  return personal.filter((f) => keys.has(f.key));
}

/** anchor + the period, YYYY-MM-DD. */
export function addPeriod(anchor: string, period: RetentionRule['period']): string {
  if (period.unit === 'days') return addDays(anchor, period.n);
  return addMonths(anchor, period.unit === 'years' ? period.n * 12 : period.n);
}

/** The date the rule's clock starts for an item (YYYY-MM-DD), or null (no date yet). */
export function retentionAnchor(rule: RetentionRule, item: Item, ctx: Ctx): string | null {
  if (rule.from.kind === 'created') return isoDateInZone(item.createdAt, ctx.timeZone);
  if (rule.from.kind === 'updated') return isoDateInZone(item.updatedAt, ctx.timeZone);
  const f = ctx.fieldsByKey.get(rule.from.fieldKey);
  if (!f) return null;
  const d = dateOf(item, f, ctx);
  if (!d) return null;
  return typeof d === 'string' ? d.slice(0, 10) : isoDateInZone(d, ctx.timeZone);
}

/** The item falls under the rule (groups, done, conditions), whatever the date. */
export function ruleApplies(rule: RetentionRule, item: Item, ctx: Ctx): boolean {
  if (rule.groupIds?.length && !rule.groupIds.includes(item.groupId)) return false;
  if (rule.onlyDone) {
    const status = itemStatusField(ctx);
    if (!status || !isDoneOf(item, status, ctx)) return false;
  }
  if (rule.conditions?.length && !checkConditions(rule.conditions as Condition[], item, ctx))
    return false;
  return true;
}

export interface RetentionDue {
  sheetId: string;
  itemId: string;
  ruleId: string;
  /** The date the period ended (the dedupe key with the item and the rule). */
  dueOn: string;
}

/**
 * Items whose period has ended by `ctx.today` under each rule. An archived item is due under erase and anonymise
 * rules (it still holds the data) but not under archive rules. Sub-items are not covered (their sheet has its own).
 */
export function retentionDue(rules: readonly RetentionRule[], items: readonly Item[], ctx: Ctx): RetentionDue[] {
  const out: RetentionDue[] = [];
  for (const rule of rules) {
    for (const item of items) {
      if (rule.action === 'archive' && item.archivedAt) continue;
      if (!ruleApplies(rule, item, ctx)) continue;
      const anchor = retentionAnchor(rule, item, ctx);
      if (!anchor) continue;
      const dueOn = addPeriod(anchor, rule.period);
      if (dueOn > ctx.today) continue;
      out.push({ sheetId: item.sheetId, itemId: item.id, ruleId: rule.id, dueOn });
    }
  }
  return out;
}

const ACTION_WORDS: Record<RetentionAction, string> = {
  erase: 'erase the personal data',
  anonymise: 'anonymise the item',
  archive: 'archive the item',
};

/** "3 years after Closed on: erase the personal data (Requester, Email), files and comments" */
export function describeRule(rule: RetentionRule | TemplateRetentionRule, fields: readonly Field[]): string {
  const n = rule.period.n;
  const unit = n === 1 ? rule.period.unit.replace(/s$/, '') : rule.period.unit;
  const from =
    rule.from.kind === 'created'
      ? 'creation'
      : rule.from.kind === 'updated'
        ? 'the last change'
        : (fields.find((f) => f.key === (rule.from as { fieldKey: string }).fieldKey)?.name ??
          'a deleted field');
  let what = ACTION_WORDS[rule.action];
  if (rule.action !== 'archive') {
    const keys = rule.fieldKeys?.length ? new Set(rule.fieldKeys) : null;
    const names = fields
      .filter((f) => isPersonalField(f) && (!keys || keys.has(f.key)))
      .map((f) => f.name);
    what += names.length ? ` (${names.join(', ')})` : ' (no field is marked personal data yet)';
    const extra = [
      rule.action === 'anonymise' || rule.files ? 'personal files' : '',
      rule.action === 'anonymise' || rule.comments ? 'comments' : '',
    ].filter(Boolean);
    if (extra.length) what += `, ${extra.join(' and ')}`;
    if (rule.archiveItem) what += ', then archive it';
  }
  const scope = rule.onlyDone ? ' once done' : '';
  return `${n} ${unit} after ${from}${scope}: ${what}`;
}

/** Queue entries as people read them. */
export type QueueStatus = 'due' | 'postponed' | 'held' | 'done';

/** A queue entry's state today: postponed entries come back when the date passes; a hold wins. */
export function queueState(
  e: { status: 'due' | 'postponed' | 'done'; postponedUntil: string | null },
  held: boolean,
  today: string,
): QueueStatus {
  if (e.status === 'done') return 'done';
  if (held) return 'held';
  if (e.status === 'postponed' && e.postponedUntil && e.postponedUntil > today) return 'postponed';
  return 'due';
}

/** The toast after an approval. */
export function erasureMessage(r: {
  action: RetentionAction;
  fields: number;
  files: number;
  comments: number;
  in_clear: number;
  removeFailed?: number;
}): string {
  if (r.action === 'archive') return 'Archived under the retention rule.';
  const parts = [
    `${r.fields} ${r.fields === 1 ? 'field' : 'fields'}`,
    ...(r.files ? [`${r.files} ${r.files === 1 ? 'file' : 'files'}`] : []),
    ...(r.comments ? [`${r.comments} ${r.comments === 1 ? 'comment' : 'comments'}`] : []),
  ];
  let msg = `${r.action === 'anonymise' ? 'Anonymised' : 'Erased'}: ${parts.join(', ')}.`;
  if (r.in_clear)
    msg += ` ${r.in_clear} older log ${r.in_clear === 1 ? 'entry was' : 'entries were'} written before the field was marked personal data and still ${r.in_clear === 1 ? 'holds its value' : 'hold their values'}.`;
  if (r.removeFailed)
    msg += ` ${r.removeFailed} stored ${r.removeFailed === 1 ? 'file' : 'files'} could not be removed yet. They are no longer listed; use "Remove erased files" on this page to try again.`;
  return msg;
}

/** "Due 11 Nov 2026" */
export const dueText = (dueOn: string) => `Due ${formatDate(dueOn)}`;
