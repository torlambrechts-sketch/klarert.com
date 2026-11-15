import 'server-only';
import { createClient as createSupabase, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { keyBetween } from '@/engine/ordering';
import type { Ctx, Field, Json } from '@/engine/types';
import { formLayoutSchema, privacyNoticeSchema, type PrivacyNotice } from '@/engine/views/config';
import { checkFormAnswers, formCtx, formQuestions, needsConsent } from '@/engine/views/form';
import type { Database } from '@/lib/database.types';
import { env } from '@/lib/env';
import { toField } from '@/lib/sheet-rows';
import { publicSubmitInput } from '@/lib/schemas/views';
import { runAutomations } from '@/server/automations';
import {
  elapsedSince,
  formSecret,
  logMissingSecret,
  startStamp as signedStamp,
  visitorKey,
} from '@/server/form-stamp';
import { fail, invalid, ok, type Result } from '@/server/result';
import { newId } from '@/server/sheet-context';
import { log } from './context';

// Public forms (docs/01 FR-25, docs/05 §3.3, /f/[token]): no session. Reading uses the anon key and get_public_form
// (the state, and when open the questions, their fields and the privacy notice; never hidden values or the people
// notified). Submitting uses submit_public_form through a service-role client the public form route passes in
// (CLAUDE.md rule 6): per-visitor limit (key = HMAC of IP + form id with a server secret, never the IP itself),
// per-link limit and daily cap, honeypot, the form's state and fields, consent, then the item with its source.
// Answers are checked with the field registry here first, as the builder's preview does, and a submission sent too
// soon after the page was served is refused (minimum fill time).

/** A client with the anon key and no session: what a signed-out visitor may do, nothing more. */
const anon = () =>
  createSupabase<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

const openSchema = z.object({
  state: z.literal('open'),
  title: z.string(),
  sheet: z.object({
    id: z.uuid(),
    name: z.string(),
    itemLabel: z.string(),
    idPrefix: z.string(),
    timeZone: z.string().nullable().optional(),
  }),
  controller: z.string().nullable().optional(),
  viewId: z.uuid(),
  formVersion: z.number().int(),
  form: z.unknown(),
  notice: z.unknown().optional(),
  fields: z.array(z.record(z.string(), z.unknown())),
  lastPosition: z.string().nullable(),
});
const closedSchema = z.object({
  state: z.enum(['draft', 'closed', 'scheduled', 'full', 'internal_only']),
  title: z.string(),
  viewId: z.uuid(),
  opensAt: z.string().nullable().optional(),
  timeZone: z.string().nullable().optional(),
});

export type PublicFormState = 'open' | z.infer<typeof closedSchema>['state'];

export interface PublicForm {
  state: 'open';
  token: string;
  viewId: string;
  formVersion: number;
  sheet: { id: string; name: string; itemLabel: string; idPrefix: string };
  timeZone: string;
  title: string;
  description: string;
  nameLabel: string;
  confirmation: string;
  controller: string;
  notice: PrivacyNotice;
  consent: boolean;
  fields: Field[];
  layout: z.infer<typeof formLayoutSchema>;
  lastPosition: string | null;
}

export interface UnavailableForm {
  state: Exclude<PublicFormState, 'open'>;
  title: string;
  viewId: string;
  opensAt: string | null;
  timeZone: string;
}

const TOKEN = /^[0-9a-f]{64}$/;

/** The form behind a public token; null when the link is unknown or disabled. */
export async function loadPublicForm(token: string): Promise<PublicForm | UnavailableForm | null> {
  if (!TOKEN.test(token)) return null;
  const { data, error } = await anon().rpc('get_public_form', { p_token: token });
  if (error || !data) return null;
  const closed = closedSchema.safeParse(data);
  if (closed.success)
    return {
      state: closed.data.state,
      title: closed.data.title,
      viewId: closed.data.viewId,
      opensAt: closed.data.opensAt ?? null,
      timeZone: closed.data.timeZone ?? 'Europe/London',
    };
  const parsed = openSchema.safeParse(data);
  if (!parsed.success) return null;
  const d = parsed.data;
  const layout = formLayoutSchema.safeParse(d.form ?? { fields: [] });
  const notice = privacyNoticeSchema.safeParse(d.notice ?? {});
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
    state: 'open',
    token,
    viewId: d.viewId,
    formVersion: d.formVersion,
    sheet: d.sheet,
    timeZone: d.sheet.timeZone ?? 'Europe/London',
    title: d.title,
    description: form.description?.trim() ?? '',
    nameLabel: form.nameLabel?.trim() || d.sheet.itemLabel,
    confirmation: form.confirmation?.trim() ?? '',
    controller: d.controller ?? '',
    notice: notice.success ? notice.data : {},
    consent: needsConsent({ ...form, notice: notice.success ? notice.data : undefined }),
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

/** Minimum time between serving the form and sending it: people take longer, scripts do not. */
export const MIN_FILL_MS = 2000;
const MAX_FILL_MS = 24 * 60 * 60 * 1000;

/**
 * The signed "page served at" stamp for the form behind this token (src/server/form-stamp.ts), or null without
 * FORM_RATE_LIMIT_SALT: the page then says the form cannot take answers (fail closed, SA-10).
 */
export function startStamp(token: string): string | null {
  const secret = formSecret();
  if (!secret) {
    logMissingSecret();
    return null;
  }
  return signedStamp(secret, token);
}

export type PublicSubmitResult = { displayId: string | null };

const REASONS: Record<string, string> = {
  rate_limited: 'Too many answers were sent to this form. Wait a while and try again.',
  not_found: 'This form is no longer available.',
  draft: 'This form is not open.',
  closed: 'This form is closed.',
  scheduled: 'This form is not open yet.',
  full: 'This form has all the answers it takes.',
  internal_only: 'This form is for signed-in members only.',
  consent_required: 'Tick the consent box to send your answers.',
  too_fast: 'Take a moment to check your answers, then send them again.',
  invalid: 'Check your answers and try again.',
  unavailable: 'This form cannot take answers right now. Try again later.',
};

export async function submitPublicForm(
  input: unknown,
  ip: string,
  submitter: SupabaseClient<Database>,
): Promise<Result<PublicSubmitResult>> {
  const p = publicSubmitInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  // fail closed: without the server secret neither the fill-time stamp nor the visitor key can be trusted (SA-10)
  const secret = formSecret();
  if (!secret) {
    logMissingSecret();
    return fail('failed', REASONS.unavailable!);
  }
  const form = await loadPublicForm(v.token);
  if (!form) return fail('not_found', REASONS.not_found!);
  if (form.state !== 'open') return fail('invalid', REASONS[form.state] ?? REASONS.invalid!);
  const elapsed = elapsedSince(secret, v.token, v.started);
  if (elapsed === null || elapsed > MAX_FILL_MS) return fail('invalid', REASONS.not_found!);
  if (elapsed < MIN_FILL_MS) return fail('invalid', REASONS.too_fast!);
  if (form.consent && !v.consent)
    return fail('invalid', REASONS.consent_required!, { __consent: REASONS.consent_required! });
  const ctx = publicCtx(form, new Date());
  const questions = formQuestions(form.layout, form.fields);
  const check = checkFormAnswers(questions, v.name, v.answers, ctx, form.nameLabel);
  if (Object.keys(check.errors).length > 0)
    return fail('invalid', 'Check the highlighted answers.', check.errors);

  const { data, error } = await submitter.rpc('submit_public_form', {
    p_token: v.token,
    p_ip_hash: visitorKey(secret, ip, form.viewId),
    p_name: v.name.trim(),
    p_values: check.values as Json,
    p_position: keyBetween(form.lastPosition, null),
    p_honeypot: v.website ?? '',
    p_consent: !!v.consent,
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
  // form automations run with the runner's own server-only client, scoped to the form's workspace (docs/02 §7)
  await runAutomations(
    [
      {
        type: 'form.submitted',
        sheetId: r.sheet_id!,
        itemId: r.id!,
        formId: form.viewId,
        actor: { kind: 'form', id: form.viewId },
      },
    ],
    { orgId: r.org_id!, userId: null },
  );
  return ok({ displayId: r.display_id ?? null });
}
