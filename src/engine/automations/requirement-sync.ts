// Requirement checks (docs/04 §5 `sync_requirement_checks`, docs/11 Supplier management): one check item per subject
// (a supplier) and library requirement, kept in step with the requirement library's Applies-to rules. Pure: the
// planner turns the action into one effect; the executor reads the library and the existing checks and asks
// `planRequirementSync` what to create, flag and reopen. Nothing is ever deleted, and a check's answer (its status
// and evidence) is never overwritten, except the sync's own "No longer applies" flag.
import type { Ctx, Field, Item, Json } from '../types';
import { defOf, keysOf, valueOf } from '../values';
import type { ActionJson, PlannedStep } from './types';

/** Field keys and option ids the sync reads and writes; the defaults are the supplier pack's (docs/11). */
export interface SyncConfig {
  /** On the checks sheet. */
  subjectLinkKey: string;
  requirementLinkKey: string;
  statusKey: string;
  sourceKey: string;
  noteKey: string;
  status: { notChecked: string; met: string; notApplicable: string; noLongerApplies: string };
  source: { rule: string; manual: string; art28: string };
  /** On the subject sheet (the supplier register). */
  categoryKey: string;
  criticalityKey: string;
  personalDataKey: string;
  /** A requirement link field of the subject: requirements added by hand. */
  manualKey: string;
  /** On the library sheet. */
  appliesKey: string;
  categoriesKey: string;
  minCriticalityKey: string;
  applies: { all: string; rules: string; processors: string; manual: string };
  /** A people field of the subject told when the share met drops because checks were added; null: nobody. */
  notifyFieldKey: string | null;
  /** At most this many checks are created in one run (the rest on the next sync). */
  limit: number;
}

export const SYNC_LIMIT = 200;
/** Rows per database call. */
export const SYNC_BATCH = 50;

export const SYNC_DEFAULTS: SyncConfig = {
  subjectLinkKey: 'supplier',
  requirementLinkKey: 'requirement',
  statusKey: 'status',
  sourceKey: 'source',
  noteKey: 'sync_note',
  status: {
    notChecked: 'opt_not_checked',
    met: 'opt_met',
    notApplicable: 'opt_na',
    noLongerApplies: 'opt_no_longer',
  },
  source: { rule: 'opt_rule', manual: 'opt_manual', art28: 'opt_art28' },
  categoryKey: 'category',
  criticalityKey: 'criticality',
  personalDataKey: 'processes_personal_data',
  manualKey: 'requirements',
  appliesKey: 'applies_when',
  categoriesKey: 'applies_categories',
  minCriticalityKey: 'min_criticality',
  applies: {
    all: 'opt_all',
    rules: 'opt_rules',
    processors: 'opt_processors',
    manual: 'opt_manual_only',
  },
  notifyFieldKey: null,
  limit: SYNC_LIMIT,
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const obj = (v: unknown): Record<string, Json> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, Json>) : {};

/** The action's settings over the defaults (unknown or malformed keys fall back). */
export function syncConfig(action: ActionJson): SyncConfig {
  const c: SyncConfig = structuredClone(SYNC_DEFAULTS);
  const keys = [
    'subjectLinkKey',
    'requirementLinkKey',
    'statusKey',
    'sourceKey',
    'noteKey',
    'categoryKey',
    'criticalityKey',
    'personalDataKey',
    'manualKey',
    'appliesKey',
    'categoriesKey',
    'minCriticalityKey',
  ] as const;
  for (const k of keys) c[k] = str(action[k]) ?? c[k];
  for (const group of ['status', 'source', 'applies'] as const) {
    const o = obj(action[group]);
    const target = c[group] as Record<string, string>;
    for (const k of Object.keys(target)) target[k] = str(o[k]) ?? target[k]!;
  }
  c.notifyFieldKey = str(action.notifyFieldKey);
  const limit = action.limit;
  if (typeof limit === 'number' && Number.isInteger(limit) && limit > 0)
    c.limit = Math.min(limit, 1000);
  return c;
}

// ───────────────────────── facts ─────────────────────────

export interface Option {
  id: string;
  label: string;
}

/** What the rules read on a subject. */
export interface SubjectFacts {
  category: Option | null;
  /** The criticality's rank (0 = lowest), null when not set. */
  criticality: number | null;
  personalData: boolean;
  /** Requirement item ids added by hand on the subject. */
  manual: string[];
}

export type AppliesMode = 'all' | 'rules' | 'processors' | 'manual';

/** A library requirement's Applies-to rules. */
export interface RequirementRule {
  id: string;
  name: string;
  mode: AppliesMode;
  categories: Option[];
  /** The lowest criticality it applies to (rank), null: any. */
  minCriticality: number | null;
}

export interface ExistingCheck {
  id: string;
  requirementId: string;
  status: string | null;
  source: string | null;
}

const fieldOf = (ctx: Ctx, sheetId: string, key: string): Field | undefined =>
  ctx.fieldsOf(sheetId).find((f) => f.key === key);

function optionsOf(item: Item, field: Field | undefined, ctx: Ctx): Option[] {
  if (!field) return [];
  const def = defOf(field);
  const all = def.options?.(field.config, ctx) ?? [];
  return keysOf(item, field, ctx).map((k) => ({
    id: k,
    label: all.find((o) => o.id === k)?.label ?? k,
  }));
}

function rankOf(item: Item, field: Field | undefined, ctx: Ctx): number | null {
  if (!field) return null;
  const v = valueOf(item, field, ctx);
  if (v === null || v === undefined || v === '') return null;
  return defOf(field).rank?.(v, field.config) ?? null;
}

/** The subject's facts, read through the field registry. */
export function subjectFacts(item: Item, ctx: Ctx, cfg: SyncConfig): SubjectFacts {
  const at = (k: string) => fieldOf(ctx, item.sheetId, k);
  const manualField = at(cfg.manualKey);
  return {
    category: optionsOf(item, at(cfg.categoryKey), ctx)[0] ?? null,
    criticality: rankOf(item, at(cfg.criticalityKey), ctx),
    personalData: (() => {
      const f = at(cfg.personalDataKey);
      return f ? valueOf(item, f, ctx) === true : false;
    })(),
    manual:
      manualField && defOf(manualField).storage === 'links'
        ? ctx.links(item.id, manualField.id)
        : [],
  };
}

/** A library item's rules. Without a mode: by the rules when it names categories or a criticality, else by hand. */
export function requirementRule(item: Item, ctx: Ctx, cfg: SyncConfig): RequirementRule {
  const at = (k: string) => fieldOf(ctx, item.sheetId, k);
  const categories = optionsOf(item, at(cfg.categoriesKey), ctx);
  const minCriticality = rankOf(item, at(cfg.minCriticalityKey), ctx);
  const raw = optionsOf(item, at(cfg.appliesKey), ctx)[0]?.id ?? null;
  const mode: AppliesMode =
    raw === cfg.applies.all
      ? 'all'
      : raw === cfg.applies.processors
        ? 'processors'
        : raw === cfg.applies.manual
          ? 'manual'
          : raw === cfg.applies.rules || categories.length > 0 || minCriticality !== null
            ? 'rules'
            : 'manual';
  return { id: item.id, name: item.name, mode, categories, minCriticality };
}

// ───────────────────────── matching ─────────────────────────

const sameOption = (a: Option, b: Option) =>
  a.id === b.id || a.label.trim().toLowerCase() === b.label.trim().toLowerCase();

/** Whether the subject has what the category and criticality rules need. */
export const hasProfile = (s: SubjectFacts) => s.category !== null && s.criticality !== null;

/**
 * Why a requirement applies to a subject: `rule` (category and criticality), `art28` (the subject processes personal
 * data and the requirement is in the Art. 28 set) or null. Category and criticality rules wait until both are set.
 */
export function ruleMatch(rule: RequirementRule, s: SubjectFacts): 'rule' | 'art28' | null {
  if (rule.mode === 'processors') return s.personalData ? 'art28' : null;
  if (rule.mode === 'manual' || !hasProfile(s)) return null;
  if (rule.mode === 'all') return 'rule';
  const catOk =
    rule.categories.length === 0 || rule.categories.some((c) => sameOption(c, s.category!));
  const critOk = rule.minCriticality === null || s.criticality! >= rule.minCriticality;
  return catOk && critOk ? 'rule' : null;
}

// ───────────────────────── the plan ─────────────────────────

export type CheckSource = 'rule' | 'art28' | 'manual';

export interface SyncPlan {
  create: { requirementId: string; name: string; source: CheckSource }[];
  /** Checks that no longer apply: flagged, never deleted. */
  flag: { checkId: string; requirementId: string; reason: string }[];
  /** Checks the sync had flagged that apply again: back to Not checked. */
  reopen: { checkId: string; requirementId: string }[];
  /** Creates left for the next run (over the limit). */
  deferred: number;
}

export const NOT_CHECKED_YET = 'Choose a category and criticality first.';

/**
 * The diff between what the rules want and the checks the subject has. `only` limits it to some requirements (a
 * library change re-syncs one requirement across subjects). Checks a person added by hand (source manual or none)
 * are never flagged; Not applicable is a person's decision and never reopened.
 */
export function planRequirementSync(input: {
  facts: SubjectFacts;
  rules: RequirementRule[];
  checks: ExistingCheck[];
  cfg: SyncConfig;
  only?: ReadonlySet<string>;
  /** Creates still allowed in this run. */
  limit?: number;
}): SyncPlan {
  const { facts, rules, checks, cfg, only } = input;
  const inScope = (id: string) => !only || only.has(id);
  const byId = new Map(rules.map((r) => [r.id, r]));
  const wanted = new Map<string, CheckSource>();
  for (const r of rules) {
    if (!inScope(r.id)) continue;
    const m = ruleMatch(r, facts);
    if (m) wanted.set(r.id, m);
  }
  for (const id of facts.manual)
    if (inScope(id) && byId.has(id) && !wanted.has(id)) wanted.set(id, 'manual');

  const existing = new Map<string, ExistingCheck>();
  for (const c of checks) if (!existing.has(c.requirementId)) existing.set(c.requirementId, c);

  const plan: SyncPlan = { create: [], flag: [], reopen: [], deferred: 0 };
  let room = input.limit ?? cfg.limit;
  for (const r of rules) {
    const source = wanted.get(r.id);
    if (!source || existing.has(r.id)) continue;
    if (room <= 0) {
      plan.deferred += 1;
      continue;
    }
    room -= 1;
    plan.create.push({ requirementId: r.id, name: r.name, source });
  }
  for (const c of checks) {
    if (!inScope(c.requirementId) || existing.get(c.requirementId) !== c) continue;
    const wantedNow = wanted.has(c.requirementId);
    if (wantedNow) {
      if (c.status === cfg.status.noLongerApplies)
        plan.reopen.push({ checkId: c.id, requirementId: c.requirementId });
      continue;
    }
    const bySync = c.source === cfg.source.rule || c.source === cfg.source.art28;
    if (!bySync) continue;
    if (c.status === cfg.status.notApplicable || c.status === cfg.status.noLongerApplies) continue;
    plan.flag.push({
      checkId: c.id,
      requirementId: c.requirementId,
      reason: flagReason(c, byId.get(c.requirementId), facts, cfg),
    });
  }
  return plan;
}

function flagReason(
  c: ExistingCheck,
  rule: RequirementRule | undefined,
  s: SubjectFacts,
  cfg: SyncConfig,
): string {
  if (!rule) return 'The requirement is no longer in the library.';
  if (c.source === cfg.source.art28 && !s.personalData)
    return 'The supplier no longer processes personal data.';
  if (rule.mode === 'manual') return 'The requirement is now only added by hand.';
  if (!hasProfile(s)) return 'The supplier has no category or criticality.';
  return 'The category or criticality no longer matches the requirement.';
}

/** The source option a created check gets. */
export const sourceOption = (source: CheckSource, cfg: SyncConfig) => cfg.source[source];

/** Met out of the checks that count (Not applicable and No longer applies are left out). */
export function metShare(statuses: (string | null)[], cfg: SyncConfig) {
  const counted = statuses.filter(
    (s) => s !== cfg.status.notApplicable && s !== cfg.status.noLongerApplies,
  );
  const met = counted.filter((s) => s === cfg.status.met).length;
  return { met, total: counted.length, pct: counted.length ? (met / counted.length) * 100 : null };
}

/** The share before and after the plan: whether the owner should hear that it dropped because checks were added. */
export function shareDrop(checks: ExistingCheck[], plan: SyncPlan, cfg: SyncConfig) {
  const flagged = new Set(plan.flag.map((f) => f.checkId));
  const reopened = new Set(plan.reopen.map((r) => r.checkId));
  const before = metShare(
    checks.map((c) => c.status),
    cfg,
  );
  const after = metShare(
    [
      ...checks.map((c) =>
        flagged.has(c.id)
          ? cfg.status.noLongerApplies
          : reopened.has(c.id)
            ? cfg.status.notChecked
            : c.status,
      ),
      ...plan.create.map(() => cfg.status.notChecked),
    ],
    cfg,
  );
  const dropped =
    plan.create.length > 0 && before.pct !== null && after.pct !== null && after.pct < before.pct;
  return { before, after, dropped };
}

/** "Added 4, flagged 1" (the toast and the run log). */
export function syncMessage(counts: {
  added: number;
  flagged: number;
  reopened?: number;
  deferred?: number;
  subjects?: number;
}): string {
  const parts = [`Added ${counts.added}`, `flagged ${counts.flagged}`];
  if (counts.reopened) parts.push(`reopened ${counts.reopened}`);
  let out = parts.join(', ');
  if (counts.subjects !== undefined)
    out += ` across ${counts.subjects} ${counts.subjects === 1 ? 'supplier' : 'suppliers'}`;
  if (counts.deferred) out += `; ${counts.deferred} more on the next sync`;
  return out;
}

const pctText = (n: number | null) => (n === null ? '–' : `${Math.round(n)}%`);

/** The owner's notice when new checks lower the share met. */
export function dropNotice(
  subject: Item,
  drop: ReturnType<typeof shareDrop>,
  added: number,
): string {
  return `${subject.displayId} ${subject.name}: ${added} new ${
    added === 1 ? 'requirement' : 'requirements'
  } to check. Requirements met went from ${pctText(drop.before.pct)} to ${pctText(drop.after.pct)}.`;
}

// ───────────────────────── the action ─────────────────────────

/** The planner (docs/04 §5): one effect; the executor reads the library and the checks. */
export function planSyncAction(action: ActionJson, item: Item, ctx: Ctx): PlannedStep {
  const checksSheetId = str(action.sheetId);
  const library = !!ctx.sheet.isLibrary;
  const summary = library
    ? 'Sync requirement checks for this requirement'
    : 'Sync requirement checks';
  if (!checksSheetId)
    return {
      action: 'sync_requirement_checks',
      summary,
      effects: [],
      outcome: 'failed',
      message: 'Choose the sheet that holds the checks.',
    };
  return {
    action: 'sync_requirement_checks',
    summary,
    effects: [
      {
        kind: 'sync_requirement_checks',
        sheetId: item.sheetId,
        itemId: item.id,
        checksSheetId,
        mode: library ? 'requirement' : 'subject',
        config: syncConfig(action) as unknown as Json,
      },
    ],
  };
}
