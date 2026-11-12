import 'server-only';
import { createHash } from 'node:crypto';
import { createClient as createSupabase } from '@supabase/supabase-js';
import { z } from 'zod';
import { keyBetween } from '@/engine/ordering';
import type { Ctx, Field, Json } from '@/engine/types';
import { formLayoutSchema } from '@/engine/views/config';
import { checkFormAnswers, formCtx, formQuestions } from '@/engine/views/form';
import type { Database } from '@/lib/database.types';
import { env } from '@/lib/env';
import { toField } from '@/lib/sheet-rows';
import { publicSubmitInput } from '@/lib/schemas/views';
import { runAutomations } from '@/server/automations';
import { fail, invalid, ok, type Result } from '@/server/result';
import { newId } from '@/server/sheet-context';
import { log } from './context';

// Public forms (docs/01 FR-25, /f/[token]): no session, no service role. The visitor's requests use the anon key and
// two functions granted to anon: get_public_form (the layout and only its fields) and submit_public_form (rate limit
// 10/min per hashed IP, honeypot, only fields on the form, then submit_form). The answers are checked with the field
// registry here first, exactly as the builder's preview does.

/** A client with the anon key and no session: what a signed-out visitor may do, nothing more. */
const anon = () =>
  createSupabase<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

const publicFormSchema = z.object({
  sheet: z.object({
    id: z.uuid(),
    name: z.string(),
    itemLabel: z.string(),
    idPrefix: z.string(),
    timeZone: z.string().nullable().optional(),
  }),
  viewId: z.uuid().nullable(),
  form: z.unknown(),
  fields: z.array(z.record(z.string(), z.unknown())),
  lastPosition: z.string().nullable(),
});

export interface PublicForm {
  token: string;
  viewId: string | null;
  sheet: { id: string; name: string; itemLabel: string; idPrefix: string };
  timeZone: string;
  title: string;
  description: string;
  nameLabel: string;
  fields: Field[];
  layout: z.infer<typeof formLayoutSchema>;
  lastPosition: string | null;
}

const TOKEN = /^[0-9a-f]{64}$/;

/** The form behind a public token, or null when the link is unknown or disabled. */
export async function loadPublicForm(token: string): Promise<PublicForm | null> {
  if (!TOKEN.test(token)) return null;
  const { data, error } = await anon().rpc('get_public_form', { p_token: token });
  if (error || !data) return null;
  const parsed = publicFormSchema.safeParse(data);
  if (!parsed.success) return null;
  const d = parsed.data;
  const layout = formLayoutSchema.safeParse(d.form ?? { fields: [] });
  const fields = d.fields.map((r) =>
    toField({
      ...(r as unknown as Parameters<typeof toField>[0]),
      sheet_id: d.sheet.id,
      width: null,
      locked: false,
      rules: [],
      visibility: null,
      archived_at: null,
    }),
  );
  const form = layout.success ? layout.data : { fields: [] };
  return {
    token,
    viewId: d.viewId,
    sheet: d.sheet,
    timeZone: d.sheet.timeZone ?? 'Europe/London',
    title: form.title?.trim() || d.sheet.name,
    description: form.description?.trim() ?? '',
    nameLabel: form.nameLabel?.trim() || d.sheet.itemLabel,
    fields,
    layout: form,
    lastPosition: d.lastPosition,
  };
}

/** The Ctx a public form checks answers with: the sheet and the form's fields only. */
export const publicCtx = (
  form: Pick<PublicForm, 'sheet' | 'fields' | 'timeZone'>,
  now: Date,
): Ctx =>
  formCtx({
    sheet: { ...form.sheet, orgId: '', isLibrary: false },
    fields: form.fields,
    timeZone: form.timeZone,
    now,
    newId,
  });

/** SHA-256 of the visitor's IP with a server-side salt: the database never sees the address itself. */
export function hashIp(ip: string): string {
  const salt = process.env.FORM_RATE_LIMIT_SALT ?? process.env.CRON_SECRET ?? '';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}

export type PublicSubmitResult = { displayId: string | null };

const REASONS: Record<string, string> = {
  rate_limited: 'Too many answers were sent from your network. Wait a minute and try again.',
  not_found: 'This form is no longer available.',
  invalid: 'Check your answers and try again.',
};

export async function submitPublicForm(
  input: unknown,
  ip: string,
): Promise<Result<PublicSubmitResult>> {
  const p = publicSubmitInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  const form = await loadPublicForm(v.token);
  if (!form) return fail('not_found', REASONS.not_found!);
  const ctx = publicCtx(form, new Date());
  const questions = formQuestions(form.layout, form.fields);
  const check = checkFormAnswers(questions, v.name, v.answers, ctx, form.nameLabel);
  if (Object.keys(check.errors).length > 0)
    return fail('invalid', 'Check the highlighted answers.', check.errors);

  const { data, error } = await anon().rpc('submit_public_form', {
    p_token: v.token,
    p_ip_hash: hashIp(ip),
    p_name: v.name.trim(),
    p_values: check.values as Json,
    p_position: keyBetween(form.lastPosition, null),
    p_honeypot: v.website ?? '',
  });
  if (error) {
    console.error(
      JSON.stringify({ level: 'error', source: 'public-form', message: error.message }),
    );
    return fail('failed', 'Your answers were not sent. Try again.');
  }
  const r = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    id?: string;
    display_id?: string;
    sheet_id?: string;
    org_id?: string;
  };
  log('submitPublicForm', { ok: !!r.ok, reason: r.reason ?? null });
  // a filled honeypot looks like success to the bot
  if (!r.ok && r.reason === 'rejected') return ok({ displayId: null });
  if (!r.ok) {
    const code =
      r.reason === 'not_found'
        ? 'not_found'
        : r.reason === 'rate_limited'
          ? 'forbidden'
          : 'invalid';
    return fail(code, REASONS[r.reason ?? 'invalid'] ?? REASONS.invalid!);
  }
  await runAutomations(
    [{ type: 'form_submitted', sheetId: r.sheet_id!, itemId: r.id!, formId: form.viewId }],
    { orgId: r.org_id!, userId: null },
  );
  return ok({ displayId: r.display_id ?? null });
}
