import 'server-only';
import { keyBetween } from '@/engine/ordering';
import { resolveFieldType } from '@/engine/fields/resolve';
import type { Field, Json } from '@/engine/types';
import {
  emptyConfig,
  parseViewConfig,
  STORED_VIEW_TYPE,
  type FormLayout,
  type SavedView,
} from '@/engine/views/config';
import {
  asNewCopy,
  checkFormAnswers,
  defaultFormLayout,
  formFingerprint,
  formLayoutProblems,
  formQuestions,
  formStatus,
  mapFormToSheet,
  nextNotice,
  noticeVersion,
  openProblems,
} from '@/engine/views/form';
import { fetchSheetMeta, type Db } from '@/lib/sheet-query';
import { toView } from '@/lib/sheet-rows';
import {
  copyFormInput,
  createFormInput,
  deleteFormInput,
  duplicateFormInput,
  formLinkInput,
  internalSubmitInput,
  saveFormInput,
} from '@/lib/schemas/views';
import { runAutomations } from '@/server/automations';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { loadWriteContext } from '@/server/sheet-context';
import { withOrg } from './context';

// Forms (docs/05 §3.3, docs/02 §8): many per sheet, each a shared `views` row of type form. Owners and admins create,
// change, copy and delete forms and their links (RLS says the same); editors fill in internal forms. Every saved
// change is versioned and logged by the database (views_form_guard, 0022), and opening a public form needs a complete
// privacy notice reviewed by an owner or admin, checked here first and again in the database.

const notFound = () => fail('not_found', 'This form no longer exists.');

async function loadForm(db: Db, orgId: string, viewId: string) {
  const { data } = await db
    .from('views')
    .select('*')
    .eq('id', viewId)
    .eq('org_id', orgId)
    .eq('type', 'form')
    .maybeSingle();
  return data ? { row: data, view: toView(data) } : null;
}

async function lastViewPosition(db: Db, sheetId: string) {
  const { data } = await db
    .from('views')
    .select('position')
    .eq('sheet_id', sheetId)
    .order('position', { ascending: false })
    .limit(1);
  return data?.[0]?.position ?? null;
}

async function insertForm(
  db: Db,
  row: { orgId: string; sheetId: string; name: string; form: FormLayout },
): Promise<Result<{ view: SavedView }>> {
  const { data, error } = await db
    .from('views')
    .insert({
      org_id: row.orgId,
      sheet_id: row.sheetId,
      name: row.name,
      type: STORED_VIEW_TYPE.form,
      config: { ...emptyConfig(), form: row.form } as unknown as NonNullable<Json>,
      owner_id: null,
      position: keyBetween(await lastViewPosition(db, row.sheetId), null),
    })
    .select('*')
    .single();
  if (error) return fromDbError(error);
  return ok({ view: toView(data) });
}

/** Hidden prefilled values as stored: each normalised by its field type; unknown people are refused. */
async function cleanSettings(
  db: Db,
  orgId: string,
  form: FormLayout,
  fields: Field[],
  ctx: Parameters<NonNullable<ReturnType<typeof resolveFieldType>>['normalize']>[2],
): Promise<Result<FormLayout>> {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const prefill: NonNullable<FormLayout['prefill']> = [];
  for (const p of form.prefill ?? []) {
    const f = byKey.get(p.key);
    const def = f && resolveFieldType(f.type);
    if (!f || !def) continue;
    const v = def.normalize(p.value, f.config, ctx);
    if (v === null) return fail('invalid', `Hidden value: ${f.name} is not valid.`);
    prefill.push({ key: p.key, value: v as Json });
  }
  const notify = [...new Set(form.notify ?? [])];
  if (notify.length) {
    const { data } = await db
      .from('memberships')
      .select('user_id')
      .eq('org_id', orgId)
      .in('user_id', notify);
    if ((data ?? []).length !== notify.length)
      return fail('invalid', 'Choose people of this workspace to notify.');
  }
  const { prefill: _p, notify: _n, ...rest } = form;
  void _p;
  void _n;
  return ok({
    ...rest,
    ...(prefill.length ? { prefill } : {}),
    ...(notify.length ? { notify } : {}),
  });
}

export async function createForm(input: unknown): Promise<Result<{ view: SavedView }>> {
  const p = createFormInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId }) => {
      const meta = await fetchSheetMeta(supabase, v.sheetId);
      if (!meta || meta.sheet.orgId !== orgId)
        return fail('not_found', 'This sheet no longer exists.');
      return insertForm(supabase, {
        orgId,
        sheetId: v.sheetId,
        name: v.name,
        form: { ...defaultFormLayout(meta.fields, v.access), notice: undefined },
      });
    },
    'createForm',
  );
}

/**
 * Save a form's name, layout and settings. Nothing changed: nothing is written (no new version). The notice's
 * version follows its words; a review sent with the new version is stamped by the database.
 */
export async function saveForm(input: unknown): Promise<Result<{ view: SavedView }>> {
  const p = saveFormInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId, role, user }) => {
      const found = await loadForm(supabase, orgId, v.viewId);
      if (!found) return notFound();
      const w = await loadWriteContext(
        supabase,
        { orgId, userId: user.id, role },
        found.row.sheet_id,
        [],
      );
      if (!w) return fail('not_found', 'This sheet no longer exists.');
      const before = found.view.config.form ?? { fields: [] };
      let form: FormLayout = v.form;
      if (form.notice) {
        const expected = nextNotice(before.notice, form.notice);
        const reviewed = form.notice.reviewedVersion === noticeVersion(expected);
        form = {
          ...form,
          notice: {
            ...expected,
            ...(reviewed ? { reviewedVersion: noticeVersion(expected) } : {}),
            ...(reviewed && expected.reviewedAt ? { reviewedAt: expected.reviewedAt } : {}),
            ...(reviewed && expected.reviewedBy ? { reviewedBy: expected.reviewedBy } : {}),
          },
        };
        if (!reviewed) delete form.notice!.reviewedVersion;
      }
      const problems =
        formStatus(form) === 'open' ? openProblems(form, w.fields) : formLayoutProblems(form, w.fields);
      if (form.groupId && !w.data.groups.some((g) => g.id === form.groupId))
        problems.push('Choose a group of this sheet for new items.');
      if (problems.length) return fail('invalid', problems[0]!);
      const cleaned = await cleanSettings(supabase, orgId, form, w.fields, w.ctx);
      if (!cleaned.ok) return cleaned;
      const name = v.name ?? found.view.name;
      const sameReview =
        (before.notice?.reviewedVersion ?? null) === (cleaned.data.notice?.reviewedVersion ?? null);
      if (
        sameReview &&
        formFingerprint(name, cleaned.data) === formFingerprint(found.view.name, before)
      )
        return ok({ view: found.view });
      const { data, error } = await supabase
        .from('views')
        .update({
          name,
          config: {
            ...found.view.config,
            form: cleaned.data,
          } as unknown as NonNullable<Json>,
        })
        .eq('id', found.row.id)
        .select('*')
        .single();
      if (error) return fromDbError(error);
      return ok({ view: toView(data) });
    },
    'saveForm',
  );
}

export async function duplicateForm(input: unknown): Promise<Result<{ view: SavedView }>> {
  const p = duplicateFormInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId }) => {
      const found = await loadForm(supabase, orgId, v.viewId);
      if (!found) return notFound();
      return insertForm(supabase, {
        orgId,
        sheetId: found.row.sheet_id,
        name: v.name,
        form: asNewCopy(found.view.config.form ?? { fields: [] }),
      });
    },
    'duplicateForm',
  );
}

/** A copy on another sheet of the workspace: questions mapped by field key; the ones that do not exist are listed. */
export async function copyFormToSheet(
  input: unknown,
): Promise<Result<{ view: SavedView; sheetId: string; missing: string[] }>> {
  const p = copyFormInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId }) => {
      const found = await loadForm(supabase, orgId, v.viewId);
      if (!found) return notFound();
      const [source, target] = await Promise.all([
        fetchSheetMeta(supabase, found.row.sheet_id),
        fetchSheetMeta(supabase, v.targetSheetId),
      ]);
      if (!source) return notFound();
      if (!target || target.sheet.orgId !== orgId || target.sheet.parentSheetId)
        return fail('not_found', 'Choose a sheet of this workspace.');
      const mapped = mapFormToSheet(found.view.config.form ?? { fields: [] }, source, target);
      const made = await insertForm(supabase, {
        orgId,
        sheetId: target.sheet.id,
        name: v.name,
        form: mapped.form,
      });
      if (!made.ok) return made;
      return ok({ view: made.data.view, sheetId: target.sheet.id, missing: mapped.missing });
    },
    'copyFormToSheet',
  );
}

/** Delete a form: its links go with it (form_links.view_id cascades), so the link stops working. */
export async function deleteForm(input: unknown): Promise<Result<null>> {
  const p = deleteFormInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId }) => {
      const found = await loadForm(supabase, orgId, v.viewId);
      if (!found) return notFound();
      const { data, error } = await supabase
        .from('views')
        .delete()
        .eq('id', found.row.id)
        .select('id');
      if (error) return fromDbError(error);
      if (!data.length) return fail('forbidden', 'Only owners and admins can do that.');
      return ok(null);
    },
    'deleteForm',
  );
}

export type FormLink = { id: string; token: string; enabled: boolean } | null;

/** The form's link: create one, regenerate it (the old one stops working at once) or disable it. */
export async function changeFormLink(input: unknown): Promise<Result<{ link: FormLink }>> {
  const p = formLinkInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg<{ link: FormLink }>(
    v.org,
    'admin',
    async ({ supabase, orgId }) => {
      const found = await loadForm(supabase, orgId, v.viewId);
      if (!found) return notFound();
      if (v.op === 'disable') {
        const { error } = await supabase.rpc('form_link_disable', { p_view: found.row.id });
        return error ? fromDbError(error) : ok({ link: null });
      }
      const { data, error } = await supabase.rpc(
        v.op === 'create' ? 'form_link_create' : 'form_link_regenerate',
        { p_view: found.row.id },
      );
      if (error) return fromDbError(error);
      return ok({ link: { id: data.id, token: data.token, enabled: data.enabled } });
    },
    'changeFormLink',
  );
}

// ───────────────────────── internal submit ─────────────────────────

const REFUSED: Record<string, string> = {
  draft: 'This form is a draft. It takes answers once it is open.',
  closed: 'This form is closed.',
  scheduled: 'This form is not open yet.',
  full: 'This form has all the answers it takes.',
  not_found: 'This form no longer exists.',
  invalid: 'Check your answers and try again.',
};

export type InternalSubmitResult = { itemId: string; displayId: string; sheetId: string };

/** An editor fills in a form (internal, or a public form inside the app): logged as them, with the form as source. */
export async function submitInternalForm(input: unknown): Promise<Result<InternalSubmitResult>> {
  const p = internalSubmitInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role, user }) => {
      const found = await loadForm(supabase, orgId, v.viewId);
      if (!found) return notFound();
      const w = await loadWriteContext(
        supabase,
        { orgId, userId: user.id, role },
        found.row.sheet_id,
        [],
      );
      if (!w) return notFound();
      const form = parseViewConfig(found.row.config).form ?? { fields: [] };
      const nameLabel = form.nameLabel?.trim() || w.data.sheet.itemLabel;
      const questions = formQuestions({ ...form, access: 'internal' }, w.fields);
      const check = checkFormAnswers(questions, v.name, v.answers, w.ctx, nameLabel);
      if (Object.keys(check.errors).length > 0)
        return fail('invalid', 'Check the highlighted answers.', check.errors);
      const groups = [...w.data.groups].sort((a, b) => (a.position < b.position ? -1 : 1));
      const groupId = groups.find((g) => g.id === form.groupId)?.id ?? groups[0]?.id;
      if (!groupId) return fail('invalid', 'This sheet has no group for new items.');
      const { data: last } = await supabase
        .from('items')
        .select('position')
        .eq('group_id', groupId)
        .is('archived_at', null)
        .order('position', { ascending: false })
        .limit(1);
      const { data, error } = await supabase.rpc('submit_internal_form', {
        p_view: found.row.id,
        p_name: v.name.trim(),
        p_values: check.values as Json,
        p_position: keyBetween(last?.[0]?.position ?? null, null),
      });
      if (error) return fromDbError(error);
      const r = (data ?? {}) as {
        ok?: boolean;
        reason?: string;
        id?: string;
        display_id?: string;
        sheet_id?: string;
      };
      if (!r.ok) return fail('invalid', REFUSED[r.reason ?? 'invalid'] ?? REFUSED.invalid!);
      const { messages } = await runAutomations(
        [
          {
            type: 'form.submitted',
            sheetId: r.sheet_id!,
            itemId: r.id!,
            formId: found.row.id,
            actor: { kind: 'user', id: user.id },
          },
        ],
        { orgId, userId: user.id, workspace: v.org },
      );
      void messages;
      return ok({ itemId: r.id!, displayId: r.display_id!, sheetId: r.sheet_id! });
    },
    'submitInternalForm',
  );
}
