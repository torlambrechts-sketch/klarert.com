import 'server-only';
import { canEdit as canEditLevel, toLevel } from '@/engine/access';
import {
  autoName,
  draftProblems,
  withWorkspaceFields,
  type AutomationDraft,
} from '@/engine/automations';
import type { Ctx, Json } from '@/engine/types';
import { FIELD_COLUMNS, toField } from '@/lib/sheet-rows';
import type { Db } from '@/lib/sheet-query';
import {
  automationModeInput,
  automationRefInput,
  createAutomationInput,
  pauseAutomationInput,
  toggleAutomationInput,
  updateAutomationInput,
} from '@/lib/schemas/automations';
import { isAdminRole, type Role } from '@/server/auth';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { loadWriteContext } from '@/server/sheet-context';
import { withOrg } from './context';

// Automations (docs/04 §10, FR-32–FR-34). Automations are structure: written with the person's client under RLS
// (editors; locked automations only admins), logged on the sheet's chain by the audit trigger. The engine checks the
// draft against the sheet (compatible fields, values, the self-trigger guard) exactly as the builder does. Pauses go
// through set_automation_pause, which logs on the item's chain.

const notFound = () => fail('not_found', 'This automation no longer exists.');
const LOCKED =
  'This automation is locked. Only owners and admins can change it. Duplicate it to make your own.';

type Who = { orgId: string; userId: string; role: Role };

/** The sheet's Ctx with every field of the workspace, and the workspace's sheets (for create_item and names). */
async function builderCtx(
  db: Db,
  who: Who,
  sheetId: string,
): Promise<{ ctx: Ctx; sheets: { id: string; name: string }[] } | null> {
  const wc = await loadWriteContext(db, who, sheetId, []);
  if (!wc) return null;
  const [sheets, fields] = await Promise.all([
    db.from('sheets').select('id, name').eq('org_id', who.orgId).is('archived_at', null),
    db.from('fields').select(FIELD_COLUMNS).eq('org_id', who.orgId).is('archived_at', null),
  ]);
  return {
    ctx: withWorkspaceFields(wc.ctx, (fields.data ?? []).map(toField)),
    sheets: sheets.data ?? [],
  };
}

/** Validate a draft for a sheet; the saved name is the auto name when left empty. */
async function prepare(
  db: Db,
  who: Who,
  sheetId: string,
  draft: AutomationDraft,
): Promise<Result<{ name: string }>> {
  const b = await builderCtx(db, who, sheetId);
  if (!b) return fail('not_found', 'This sheet no longer exists.');
  const problems = draftProblems(draft, b.ctx, { sheetIds: b.sheets.map((s) => s.id) });
  const keys = Object.keys(problems);
  if (keys.length > 0) return fail('invalid', problems[keys[0]!]!, problems);
  const names = new Map(b.sheets.map((s) => [s.id, s.name]));
  // automations run as the system: they may only write where their author may edit (docs/02 §16)
  const writes = new Set<string>();
  for (const a of draft.actions as { type: string; sheetId?: unknown; linkFieldKey?: unknown }[]) {
    if (typeof a.sheetId === 'string' && a.sheetId) writes.add(a.sheetId);
    if (a.type === 'update_linked' && typeof a.linkFieldKey === 'string') {
      const t = (b.ctx.fieldsByKey.get(a.linkFieldKey)?.config as { targetSheetId?: unknown })
        ?.targetSheetId;
      if (typeof t === 'string' && t) writes.add(t);
    }
  }
  writes.delete(sheetId);
  if (writes.size > 0) {
    const { data } = await db.rpc('sheet_levels', { p_sheets: [...writes] });
    const blocked = (data ?? []).filter((r) => !canEditLevel(toLevel(r.level)));
    if (blocked.length > 0)
      return fail(
        'forbidden',
        `You cannot edit ${names.get(blocked[0]!.sheet_id) ?? 'a sheet this automation writes to'}, so this automation cannot write to it.`,
      );
  }
  return ok({ name: draft.name.trim() || autoName(draft, b.ctx, (id) => names.get(id)) });
}

const asJson = (v: unknown) => v as NonNullable<Json>;

export async function createAutomation(input: unknown): Promise<Result<{ id: string }>> {
  const p = createAutomationInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role, user }) => {
      const draft = v.draft as AutomationDraft;
      const prepared = await prepare(supabase, { orgId, role, userId: user.id }, v.sheetId, draft);
      if (!prepared.ok) return prepared;
      const { data, error } = await supabase
        .from('automations')
        .insert({
          org_id: orgId,
          sheet_id: v.sheetId,
          name: prepared.data.name,
          enabled: v.enabled,
          trigger: asJson(draft.trigger),
          conditions: asJson(draft.conditions),
          actions: asJson(draft.actions),
          source: v.source,
          created_by: user.id,
        })
        .select('id')
        .single();
      if (error) return fromDbError(error);
      return ok({ id: data.id });
    },
    'createAutomation',
  );
}

async function loadRow(db: Db, orgId: string, id: string) {
  const { data } = await db
    .from('automations')
    .select('*')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
  return data;
}

export async function updateAutomation(input: unknown): Promise<Result<{ id: string }>> {
  const p = updateAutomationInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role, user }) => {
      const row = await loadRow(supabase, orgId, v.automationId);
      if (!row) return notFound();
      if (row.locked && !isAdminRole(role)) return fail('forbidden', LOCKED);
      const draft = v.draft as AutomationDraft;
      const prepared = await prepare(
        supabase,
        { orgId, role, userId: user.id },
        row.sheet_id,
        draft,
      );
      if (!prepared.ok) return prepared;
      const { error } = await supabase
        .from('automations')
        .update({
          name: prepared.data.name,
          trigger: asJson(draft.trigger),
          conditions: asJson(draft.conditions),
          actions: asJson(draft.actions),
          version: row.version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .select('id')
        .single();
      if (error) return fromDbError(error);
      return ok({ id: row.id });
    },
    'updateAutomation',
  );
}

export async function toggleAutomation(input: unknown): Promise<Result<{ enabled: boolean }>> {
  const p = toggleAutomationInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role }) => {
      const row = await loadRow(supabase, orgId, v.automationId);
      if (!row) return notFound();
      if (row.locked && !isAdminRole(role)) return fail('forbidden', LOCKED);
      const { error } = await supabase
        .from('automations')
        .update({ enabled: v.enabled, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .select('id')
        .single();
      if (error) return fromDbError(error);
      return ok({ enabled: v.enabled });
    },
    'toggleAutomation',
  );
}

/**
 * Test mode (docs/04 §14): an automation in test mode runs and logs what it would do; live, it performs its actions.
 * Owners and admins only (a guard trigger holds the database to it); the audit trigger logs the change.
 */
export async function setAutomationMode(
  input: unknown,
): Promise<Result<{ mode: 'live' | 'test' }>> {
  const p = automationModeInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId }) => {
      const row = await loadRow(supabase, orgId, v.automationId);
      if (!row) return notFound();
      const { error } = await supabase
        .from('automations')
        .update({ mode: v.mode, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .select('id')
        .single();
      if (error) return fromDbError(error);
      return ok({ mode: v.mode });
    },
    'setAutomationMode',
  );
}

/** A copy on the same sheet, unlocked and custom, turned off so it does not run twice until someone turns it on. */
export async function duplicateAutomation(input: unknown): Promise<Result<{ id: string }>> {
  const p = automationRefInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, user }) => {
      const row = await loadRow(supabase, orgId, v.automationId);
      if (!row) return notFound();
      const { data, error } = await supabase
        .from('automations')
        .insert({
          org_id: orgId,
          sheet_id: row.sheet_id,
          name: `Copy of ${row.name}`.slice(0, 200),
          enabled: false,
          trigger: row.trigger,
          conditions: row.conditions,
          actions: row.actions,
          source: 'custom',
          created_by: user.id,
        })
        .select('id')
        .single();
      if (error) return fromDbError(error);
      return ok({ id: data.id });
    },
    'duplicateAutomation',
  );
}

export async function deleteAutomation(input: unknown): Promise<Result<null>> {
  const p = automationRefInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role }) => {
      const row = await loadRow(supabase, orgId, v.automationId);
      if (!row) return notFound();
      if (row.locked && !isAdminRole(role)) return fail('forbidden', LOCKED);
      const { error, count } = await supabase
        .from('automations')
        .delete({ count: 'exact' })
        .eq('id', row.id);
      if (error) return fromDbError(error);
      if (!count) return fail('forbidden', 'You do not have permission to do that.');
      return ok(null);
    },
    'deleteAutomation',
  );
}

/** Pause or resume an automation for one item (docs/04 §7.7). Logged on the item's chain. */
export async function setAutomationPause(input: unknown): Promise<Result<{ paused: boolean }>> {
  const p = pauseAutomationInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId }) => {
      const row = await loadRow(supabase, orgId, v.automationId);
      if (!row) return notFound();
      const { data, error } = await supabase.rpc('set_automation_pause', {
        p_automation: row.id,
        p_item: v.itemId,
        p_paused: v.paused,
      });
      if (error)
        return /automation not found/.test(error.message)
          ? fail('not_found', 'This item or automation no longer exists.')
          : fromDbError(error);
      return ok({ paused: data === true });
    },
    'setAutomationPause',
  );
}
