import 'server-only';
import { keyBetween } from '@/engine/ordering';
import type { Json } from '@/engine/types';
import {
  parseViewConfig,
  STORED_VIEW_TYPE,
  type SavedView,
  type ViewConfig,
  type ViewType,
} from '@/engine/views/config';
import { formLayoutProblems } from '@/engine/views/form';
import { dropTab, readTabSettings } from '@/engine/views/tabs';
import { fetchSheetMeta, type Db } from '@/lib/sheet-query';
import { toView } from '@/lib/sheet-rows';
import {
  createViewInput,
  deleteViewInput,
  disableFormLinkInput,
  duplicateViewInput,
  filterItemsInput,
  formLinkInput,
  setDefaultViewInput,
  setSheetTabsInput,
  updateViewInput,
} from '@/lib/schemas/views';
import { isEditorRole } from '@/server/auth';
import { buildFilterSql } from '@/server/query/filters';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { loadWriteContext } from '@/server/sheet-context';
import { withOrg } from './context';
import { setSheetTabsWith, type SheetTabsResult } from './sheet-tabs-core';

// Saved views (docs/01 FR-26) and form links (FR-25). Views are structure: written with the user's client under RLS
// (personal views: their owner; shared views: editors). Form links are created and disabled by editors.

const SHARED_NEEDS_EDITOR = 'Viewers can save personal views only. Ask an editor to share one.';
const viewNotFound = () => fail('not_found', 'This view no longer exists.');

/** Problems in the parts of a config that point at fields (form layout). */
async function configProblem(db: Db, sheetId: string, config: ViewConfig) {
  if (!config.form) return null;
  const meta = await fetchSheetMeta(db, sheetId);
  if (!meta) return 'This sheet no longer exists.';
  const problems = formLayoutProblems(config.form, meta.fields);
  if (config.form.groupId && !meta.groups.some((g) => g.id === config.form!.groupId))
    problems.push('Choose a group of this sheet for new items.');
  return problems[0] ?? null;
}

async function lastPosition(db: Db, sheetId: string) {
  const { data } = await db
    .from('views')
    .select('position')
    .eq('sheet_id', sheetId)
    .order('position', { ascending: false })
    .limit(1);
  return data?.[0]?.position ?? null;
}

async function insertView(
  db: Db,
  row: {
    orgId: string;
    sheetId: string;
    name: string;
    type: ViewType;
    config: ViewConfig;
    ownerId: string | null;
  },
): Promise<Result<{ view: SavedView }>> {
  const { data, error } = await db
    .from('views')
    .insert({
      org_id: row.orgId,
      sheet_id: row.sheetId,
      name: row.name,
      type: STORED_VIEW_TYPE[row.type],
      config: row.config as unknown as NonNullable<Json>,
      owner_id: row.ownerId,
      position: keyBetween(await lastPosition(db, row.sheetId), null),
    })
    .select('*')
    .single();
  if (error) return fromDbError(error);
  return ok({ view: toView(data) });
}

export async function createView(input: unknown): Promise<Result<{ view: SavedView }>> {
  const p = createViewInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId, role, user }) => {
      if (v.shared && !isEditorRole(role)) return fail('forbidden', SHARED_NEEDS_EDITOR);
      const { data: sheet } = await supabase
        .from('sheets')
        .select('id')
        .eq('id', v.sheetId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!sheet) return fail('not_found', 'This sheet no longer exists.');
      const problem = await configProblem(supabase, v.sheetId, v.config);
      if (problem) return fail('invalid', problem);
      return insertView(supabase, {
        orgId,
        sheetId: v.sheetId,
        name: v.name,
        type: v.type,
        config: v.config,
        ownerId: v.shared ? null : user.id,
      });
    },
    'createView',
  );
}

export async function updateView(input: unknown): Promise<Result<{ view: SavedView }>> {
  const p = updateViewInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId, role, user }) => {
      const { data: row } = await supabase
        .from('views')
        .select('*')
        .eq('id', v.viewId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!row) return viewNotFound();
      if (row.owner_id === null && !isEditorRole(role))
        return fail(
          'forbidden',
          'Only editors can change a shared view. Save it as your own view.',
        );
      if (row.owner_id !== null && row.owner_id !== user.id) return viewNotFound();
      if (v.config) {
        const problem = await configProblem(supabase, row.sheet_id, v.config);
        if (problem) return fail('invalid', problem);
      }
      const { data, error } = await supabase
        .from('views')
        .update({
          ...(v.name !== undefined ? { name: v.name } : {}),
          ...(v.config ? { config: v.config as unknown as NonNullable<Json> } : {}),
        })
        .eq('id', row.id)
        .select('*')
        .single();
      if (error) return fromDbError(error);
      // a form's links follow the form's group for new items
      if (v.config?.form && row.type === 'form') {
        const { error: linkError } = await supabase
          .from('form_links')
          .update({ group_id: v.config.form.groupId ?? null })
          .eq('view_id', row.id);
        if (linkError) return fromDbError(linkError);
      }
      return ok({ view: toView(data) });
    },
    'updateView',
  );
}

export async function duplicateView(input: unknown): Promise<Result<{ view: SavedView }>> {
  const p = duplicateViewInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId, role, user }) => {
      if (v.shared && !isEditorRole(role)) return fail('forbidden', SHARED_NEEDS_EDITOR);
      const { data: row } = await supabase
        .from('views')
        .select('*')
        .eq('id', v.viewId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!row) return viewNotFound();
      return insertView(supabase, {
        orgId,
        sheetId: row.sheet_id,
        name: v.name,
        type: row.type as ViewType,
        config: parseViewConfig(row.config),
        ownerId: v.shared ? null : user.id,
      });
    },
    'duplicateView',
  );
}

export async function deleteView(input: unknown): Promise<Result<null>> {
  const p = deleteViewInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId, role, user }) => {
      const { data: row } = await supabase
        .from('views')
        .select('id, sheet_id, owner_id')
        .eq('id', v.viewId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!row) return viewNotFound();
      if (row.owner_id === null && !isEditorRole(role))
        return fail('forbidden', 'Only editors can delete a shared view.');
      if (row.owner_id !== null && row.owner_id !== user.id) return viewNotFound();
      const { data: deleted, error } = await supabase
        .from('views')
        .delete()
        .eq('id', row.id)
        .select('id');
      if (error) return fromDbError(error);
      if (!deleted.length) return fail('forbidden', 'You do not have permission to do that.');
      // a deleted view leaves the sheet's tabs, and a deleted default view falls back to the Table
      if (isEditorRole(role)) {
        const { data: sheet } = await supabase
          .from('sheets')
          .select('settings')
          .eq('id', row.sheet_id)
          .maybeSingle();
        const settings = (sheet?.settings ?? {}) as Record<string, Json>;
        const next = dropTab(settings, row.id);
        if (next !== settings)
          await supabase.from('sheets').update({ settings: next }).eq('id', row.sheet_id);
      }
      return ok(null);
    },
    'deleteView',
  );
}

export async function setDefaultView(input: unknown): Promise<Result<{ viewId: string }>> {
  const p = setDefaultViewInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId }) => {
      const { data: sheet } = await supabase
        .from('sheets')
        .select('id, settings')
        .eq('id', v.sheetId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!sheet) return fail('not_found', 'This sheet no longer exists.');
      if (v.viewId.includes('-')) {
        const { data: view } = await supabase
          .from('views')
          .select('id, owner_id')
          .eq('id', v.viewId)
          .eq('sheet_id', sheet.id)
          .maybeSingle();
        if (!view) return viewNotFound();
        if (view.owner_id !== null)
          return fail('invalid', 'Only a shared view can be the default. Share it first.');
      }
      // a hidden tab cannot open first (sheets.settings.tabs)
      if (readTabSettings(sheet.settings).tabs?.some((t) => t.id === v.viewId && t.hidden))
        return fail('invalid', 'This tab is hidden. Show it in Customise tabs first.');
      const settings = {
        ...((sheet.settings ?? {}) as Record<string, Json>),
        defaultViewId: v.viewId,
      };
      const { error } = await supabase.from('sheets').update({ settings }).eq('id', sheet.id);
      return error ? fromDbError(error) : ok({ viewId: v.viewId });
    },
    'setDefaultView',
  );
}

/**
 * The sheet's tab set (docs/02 sheets.settings.tabs): order, hidden tabs, labels and the view that opens first. Owners
 * and admins only. Every view tab must be a shared view of this sheet; a default that the new set hides falls back to
 * the Table (and the result says so). Logged by the sheets audit trigger as sheets.update on the sheet's chain.
 */
export async function setSheetTabs(input: unknown): Promise<Result<SheetTabsResult>> {
  const p = setSheetTabsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId, role }) =>
      setSheetTabsWith(
        {
          role,
          loadSettings: async () => {
            const { data } = await supabase
              .from('sheets')
              .select('settings')
              .eq('id', v.sheetId)
              .eq('org_id', orgId)
              .maybeSingle();
            return data ? ((data.settings ?? {}) as Record<string, Json>) : null;
          },
          views: async () => {
            const { data } = await supabase
              .from('views')
              .select('id, name, type, owner_id, position')
              .eq('sheet_id', v.sheetId)
              .eq('org_id', orgId);
            return (data ?? []).map((r) => ({
              id: r.id,
              name: r.name,
              type: r.type,
              ownerId: r.owner_id,
              position: r.position,
            }));
          },
          saveSettings: async (settings) => {
            const { error } = await supabase
              .from('sheets')
              .update({
                settings: settings as NonNullable<Json>,
                updated_at: new Date().toISOString(),
              })
              .eq('id', v.sheetId)
              .eq('org_id', orgId);
            return error ? fromDbError(error) : ok(null);
          },
        },
        { tabs: v.tabs, defaultViewId: v.defaultViewId },
      ),
    'setSheetTabs',
  );
}

// ───────────────────────── server-side filters ─────────────────────────

/**
 * Ids of the sheet's items that match the conditions the database can evaluate (sheets above 2 000 items,
 * docs/03 §4). `clientOnly` lists the conditions the browser applies to the loaded items.
 */
export async function filterItemIds(
  input: unknown,
): Promise<Result<{ ids: string[]; clientOnly: number[] }>> {
  const p = filterItemsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId, role, user }) => {
      const w = await loadWriteContext(supabase, { orgId, userId: user.id, role }, v.sheetId, []);
      if (!w) return fail('not_found', 'This sheet no longer exists.');
      const built = buildFilterSql(v.conditions, w.ctx);
      const { data, error } = await supabase.rpc('filter_item_ids', {
        p_sheet: v.sheetId,
        p_where: built.where,
        p_params: built.params,
      });
      if (error) return fromDbError(error);
      return ok({
        ids: data ?? [],
        clientOnly: built.clientOnly.map((c) => v.conditions.indexOf(c)),
      });
    },
    'filterItemIds',
  );
}

// ───────────────────────── form links ─────────────────────────

export type FormLink = { id: string; token: string; enabled: boolean };

/** The form's public link: the enabled one, or a new one (32 random bytes, generated by the database). */
export async function createFormLink(input: unknown): Promise<Result<{ link: FormLink }>> {
  const p = formLinkInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, user }) => {
      const { data: view } = await supabase
        .from('views')
        .select('*')
        .eq('id', v.viewId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!view || view.type !== 'form') return viewNotFound();
      if (view.owner_id !== null)
        return fail('invalid', 'Share this form view before you publish a link.');
      const { data: existing } = await supabase
        .from('form_links')
        .select('id, token, enabled')
        .eq('view_id', view.id)
        .eq('enabled', true)
        .limit(1);
      if (existing?.[0]) return ok({ link: existing[0] });
      const cfg = parseViewConfig(view.config);
      const { data, error } = await supabase
        .from('form_links')
        .insert({
          org_id: orgId,
          sheet_id: view.sheet_id,
          view_id: view.id,
          group_id: cfg.form?.groupId ?? null,
          created_by: user.id,
        })
        .select('id, token, enabled')
        .single();
      if (error) return fromDbError(error);
      return ok({ link: data });
    },
    'createFormLink',
  );
}

/** Revoke a public link. A new link gets a new token; the old one never works again. */
export async function disableFormLink(input: unknown): Promise<Result<null>> {
  const p = disableFormLinkInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId }) => {
      const { data, error } = await supabase
        .from('form_links')
        .update({ enabled: false })
        .eq('id', v.linkId)
        .eq('org_id', orgId)
        .select('id');
      if (error) return fromDbError(error);
      return data.length ? ok(null) : fail('not_found', 'This link no longer exists.');
    },
    'disableFormLink',
  );
}
