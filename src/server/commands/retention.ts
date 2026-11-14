import 'server-only';
import { z } from 'zod';
import {
  describeRule,
  erasureMessage,
  queueState,
  readRetention,
  retentionProblems,
  retentionSettingsSchema,
  type QueueStatus,
  type RetentionAction,
} from '@/engine/retention';
import { todayIn } from '@/engine/sheet-data';
import type { Json } from '@/engine/types';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { retentionCheckMessage, runRetentionChecks } from '@/server/scheduler/retention-checks';
import { FIELD_COLUMNS, toField } from '@/lib/sheet-rows';
import { withOrg } from './context';

// Retention (docs/02 §18, owner decision "rules + review queue"): the rules per sheet (owners and admins), the review
// queue on Workspace admin › Retention (owners and admins: there is no DPO workspace role), approving an erasure,
// postponing with a reason and legal holds. Every write is one RPC; the RPCs check the role again and log.

const org = z.string().min(1).max(64);
const uuid = z.string().uuid();

export interface RetentionQueueRow {
  id: string;
  sheetId: string;
  sheetName: string;
  itemId: string;
  displayId: string;
  itemName: string;
  archived: boolean;
  ruleName: string;
  action: RetentionAction;
  dueOn: string;
  state: QueueStatus;
  postponedUntil: string | null;
  reason: string | null;
  holdReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface RetentionSheetRules {
  sheetId: string;
  sheetName: string;
  personalFields: string[];
  rules: { id: string; name: string; text: string; note: string | null }[];
}

export interface RetentionOverview {
  queue: RetentionQueueRow[];
  sheets: RetentionSheetRules[];
  lastCheck: string | null;
  erasedFilesLeft: number;
}

/** The queue (not done first, then the latest done), the rules per sheet and the last scheduled check. */
export async function retentionOverview(input: unknown): Promise<Result<RetentionOverview>> {
  const p = z.object({ org }).safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const [{ data: o }, queueRes, holdsRes, sheetsRes, checkRes, filesRes] = await Promise.all([
        supabase.from('orgs').select('time_zone').eq('id', orgId).maybeSingle(),
        supabase.from('retention_queue').select('*').eq('org_id', orgId).order('due_on').limit(500),
        supabase
          .from('retention_holds')
          .select('item_id, reason')
          .eq('org_id', orgId)
          .is('released_at', null),
        supabase
          .from('sheets')
          .select('id, name, settings')
          .eq('org_id', orgId)
          .is('archived_at', null)
          .order('position'),
        supabase
          .from('retention_checks')
          .select('day')
          .eq('org_id', orgId)
          .order('day', { ascending: false })
          .limit(1),
        supabase
          .from('files')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .not('erased_at', 'is', null),
      ]);
      if (queueRes.error) return fromDbError(queueRes.error);
      const today = todayIn(new Date(), o?.time_zone ?? 'UTC');
      const holds = new Map((holdsRes.data ?? []).map((h) => [h.item_id, h.reason]));
      const rows = queueRes.data ?? [];
      const itemIds = [...new Set(rows.map((r) => r.item_id))];
      const { data: items } = itemIds.length
        ? await supabase.from('items').select('id, display_id, name, archived_at').in('id', itemIds)
        : { data: [] };
      const itemOf = new Map((items ?? []).map((i) => [i.id, i]));
      const sheetName = new Map((sheetsRes.data ?? []).map((s) => [s.id, s.name]));
      const queue: RetentionQueueRow[] = rows
        .filter((r) => itemOf.has(r.item_id))
        .map((r) => {
          const it = itemOf.get(r.item_id)!;
          return {
            id: r.id,
            sheetId: r.sheet_id,
            sheetName: sheetName.get(r.sheet_id) ?? 'An archived sheet',
            itemId: r.item_id,
            displayId: it.display_id,
            itemName: it.name,
            archived: !!it.archived_at,
            ruleName: r.rule_name,
            action: r.action as RetentionAction,
            dueOn: r.due_on,
            state: queueState(
              {
                status: r.status as 'due' | 'postponed' | 'done',
                postponedUntil: r.postponed_until,
              },
              holds.has(r.item_id),
              today,
            ),
            postponedUntil: r.postponed_until,
            reason: r.reason,
            holdReason: holds.get(r.item_id) ?? null,
            decidedBy: r.decided_by,
            decidedAt: r.decided_at,
          };
        });
      const order: Record<QueueStatus, number> = { due: 0, held: 1, postponed: 2, done: 3 };
      queue.sort((a, b) => order[a.state] - order[b.state] || a.dueOn.localeCompare(b.dueOn));
      const sheets: RetentionSheetRules[] = [];
      for (const s of sheetsRes.data ?? []) {
        const r = readRetention(s.settings);
        if (!r.rules.length) continue;
        const fields = await sheetFields(supabase, s.id);
        sheets.push({
          sheetId: s.id,
          sheetName: s.name,
          personalFields: fields
            .filter((f) => (f.config as { personalData?: unknown }).personalData === true)
            .map((f) => f.name),
          rules: r.rules.map((rule) => ({
            id: rule.id,
            name: rule.name,
            text: describeRule(rule, fields),
            note: rule.note ?? null,
          })),
        });
      }
      return ok({
        queue,
        sheets,
        lastCheck: checkRes.data?.[0]?.day ?? null,
        erasedFilesLeft: filesRes.count ?? 0,
      });
    },
    'retentionOverview',
  );
}

/** "Check now": the scheduler's retention check for this workspace, as the owner or admin. */
export async function checkRetentionNow(input: unknown): Promise<Result<{ message: string }>> {
  const p = z.object({ org }).safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      try {
        const s = await runRetentionChecks(supabase, orgId, { now: new Date() });
        return ok({ message: retentionCheckMessage(s) });
      } catch (e) {
        return fromDbError({ message: e instanceof Error ? e.message : String(e) });
      }
    },
    'checkRetentionNow',
  );
}

const approveInput = z.object({
  org,
  queueId: uuid,
  note: z.string().trim().max(1000).optional(),
});

/**
 * Approve a due entry: retention_execute erases (or anonymises, or archives) in one transaction and returns the
 * storage paths of the erased files, which are then removed through the Storage API with the person's own client
 * (the storage policy lets owners and admins delete erased files only).
 */
export async function approveRetention(input: unknown): Promise<Result<{ message: string }>> {
  const p = approveInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { data: q } = await supabase
        .from('retention_queue')
        .select('id, action')
        .eq('id', v.queueId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!q) return fail('not_found', 'This retention review no longer exists.');
      const { data, error } = await supabase.rpc('retention_execute', {
        p_queue: v.queueId,
        ...(v.note ? { p_note: v.note } : {}),
      });
      if (error) return fromDbError(error);
      const r = (data ?? {}) as {
        paths?: string[];
        fields?: number;
        files?: number;
        comments?: number;
        in_clear?: number;
      };
      const removeFailed = await removeObjects(supabase, r.paths ?? []);
      return ok({
        message: erasureMessage({
          action: q.action as RetentionAction,
          fields: r.fields ?? 0,
          files: r.files ?? 0,
          comments: r.comments ?? 0,
          in_clear: r.in_clear ?? 0,
          removeFailed,
        }),
      });
    },
    'approveRetention',
  );
}

type Supa = Parameters<Parameters<typeof withOrg>[2]>[0]['supabase'];

async function sheetFields(supabase: Supa, sheetId: string) {
  const { data, error } = await supabase
    .from('fields')
    .select(FIELD_COLUMNS)
    .eq('sheet_id', sheetId)
    .is('archived_at', null)
    .order('position');
  if (error) throw new Error(error.message);
  return (data ?? []).map(toField);
}

/** Removes stored objects; returns how many could not be removed (objects already gone count as removed). */
async function removeObjects(supabase: Supa, paths: string[]): Promise<number> {
  if (!paths.length) return 0;
  let failed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error } = await supabase.storage.from('files').remove(batch);
    if (error) failed += batch.length;
  }
  return failed;
}

/** Try again to remove the stored objects of erased files (owners and admins). */
export async function removeErasedFiles(input: unknown): Promise<Result<{ message: string }>> {
  const p = z.object({ org }).safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { data, error } = await supabase
        .from('files')
        .select('storage_path')
        .eq('org_id', orgId)
        .not('erased_at', 'is', null)
        .limit(1000);
      if (error) return fromDbError(error);
      const paths = (data ?? []).map((f) => f.storage_path);
      const failed = await removeObjects(supabase, paths);
      return ok({
        message: failed
          ? `${failed} stored ${failed === 1 ? 'file' : 'files'} could not be removed. Try again later.`
          : 'Erased files are removed from storage.',
      });
    },
    'removeErasedFiles',
  );
}

const postponeInput = z.object({
  org,
  queueId: uuid,
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.'),
  reason: z.string().trim().min(1, 'Say why.').max(1000),
});

export async function postponeRetention(input: unknown): Promise<Result<{ message: string }>> {
  const p = postponeInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase }) => {
      const { error } = await supabase.rpc('retention_postpone', {
        p_queue: v.queueId,
        p_until: v.until,
        p_reason: v.reason,
      });
      if (error) return fromDbError(error);
      return ok({ message: 'Postponed. It comes back to the queue on that date.' });
    },
    'postponeRetention',
  );
}

const holdInput = z.object({
  org,
  itemId: uuid,
  on: z.union([z.boolean(), z.enum(['true', 'false']).transform((x) => x === 'true')]),
  reason: z.string().trim().max(1000).optional(),
});

export async function setRetentionHold(input: unknown): Promise<Result<{ message: string }>> {
  const p = holdInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  if (v.on && !v.reason) return fail('invalid', 'Say why.', { reason: 'Say why.' });
  return withOrg(
    v.org,
    'admin',
    async ({ supabase }) => {
      const { error } = await supabase.rpc('set_retention_hold', {
        p_item: v.itemId,
        p_on: v.on,
        p_reason: v.reason ?? '',
      });
      if (error) return fromDbError(error);
      return ok({
        message: v.on
          ? 'Legal hold placed. Nothing is erased while it holds.'
          : 'Legal hold released.',
      });
    },
    'setRetentionHold',
  );
}

const rulesInput = z.object({
  org,
  sheetId: uuid,
  retention: retentionSettingsSchema,
});

/**
 * Save a sheet's retention rules (owners and admins). Field keys must exist; the rules' fields to erase must be
 * marked personal data. The settings write is logged by the sheets audit trigger.
 */
export async function saveRetentionRules(input: unknown): Promise<Result<null>> {
  const p = rulesInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  const problems = retentionProblems(v.retention.rules);
  if (problems.length) return fail('invalid', problems[0]!);
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { data: s } = await supabase
        .from('sheets')
        .select('id, settings')
        .eq('id', v.sheetId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!s) return fail('not_found', 'This sheet no longer exists.');
      const fields = await sheetFields(supabase, s.id);
      const byKey = new Map(fields.map((f) => [f.key, f]));
      for (const r of v.retention.rules) {
        if (r.from.kind === 'field' && !byKey.has(r.from.fieldKey))
          return fail('invalid', `${r.name}: the date field no longer exists.`);
        for (const k of r.fieldKeys ?? [])
          if (
            (byKey.get(k)?.config as { personalData?: unknown } | undefined)?.personalData !== true
          )
            return fail('invalid', `${r.name}: only fields marked personal data can be erased.`);
      }
      const settings = {
        ...((s.settings ?? {}) as Record<string, Json>),
        retention: v.retention as unknown as Json,
      };
      const { error } = await supabase
        .from('sheets')
        .update({ settings: settings as NonNullable<Json>, updated_at: new Date().toISOString() })
        .eq('id', s.id)
        .eq('org_id', orgId);
      return error ? fromDbError(error) : ok(null);
    },
    'saveRetentionRules',
  );
}
