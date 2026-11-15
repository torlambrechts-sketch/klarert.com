import 'server-only';
import { z } from 'zod';
import type { AuthError } from '@supabase/supabase-js';
import type { Json } from '@/lib/database.types';
import { cleanCode, REQUIRE_TWO_STEP, unfinishedApps, verifiedApps } from '@/lib/two-step';
import { getSession, getSignIn } from '@/server/auth';
import { fail, invalid, ok, type Result } from '@/server/result';
import { log, withOrg } from './context';

// Two-step sign-in (SA-6, docs/09 §8, docs/05 §1 Your account): an authenticator app (TOTP) through Supabase Auth MFA.
// Setting up and removing an app run on the person's own session; Supabase Auth stores the factors (auth.mfa_factors),
// never our tables. Entering the code at sign-in raises the session to aal2. The workspace setting lives in
// orgs.settings.requireTwoStep (owners only).

/** The name the authenticator app shows above the code. */
const ISSUER = 'Compliance OS';
const MAX_APPS = 10; // supabase/config.toml [auth.mfa] max_enrolled_factors

const code = z
  .unknown()
  .transform((v) => cleanCode(v))
  .refine((v): v is string => v !== null, 'Enter the 6-digit code from your authenticator app.');
const factorId = z.uuid();

const startInput = z.object({}).strict();
const finishInput = z.object({ factorId, code });
const removeInput = z.object({ factorId });
const verifyInput = z.object({ factorId: factorId.optional(), code });
const workspaceInput = z.object({ org: z.string().min(1).max(40), required: z.boolean() });

/** Supabase Auth's refusals, in plain words. */
function authFailure(error: AuthError, during: string): Result<never> {
  if (error.status === 429)
    return fail('failed', 'Too many attempts. Wait a minute and try again.');
  if (error.code === 'mfa_verification_failed' || error.code === 'mfa_challenge_expired')
    return fail('invalid', 'That code is not right. Enter the code the app shows now.', {
      code: 'That code is not right. Enter the code the app shows now.',
    });
  if (error.code === 'insufficient_aal')
    return fail('forbidden', 'Enter a code from your authenticator app first, then try again.');
  console.error(
    JSON.stringify({
      level: 'error',
      source: 'two-step',
      during,
      code: error.code,
      message: error.message,
    }),
  );
  return fail('failed', 'Two-step sign-in could not be changed. Try again.');
}

export type TwoStepSetup = { factorId: string; qrCode: string; secret: string };

/** Start setting up an authenticator app: a new TOTP secret, its QR code and the key to type in by hand. */
export async function startTwoStepSetup(input: unknown): Promise<Result<TwoStepSetup>> {
  const p = startInput.safeParse(input ?? {});
  if (!p.success) return invalid(p.error);
  const session = await getSession();
  if (!session) return fail('unauthenticated', 'Sign in again.');
  const factors = session.user.factors ?? [];
  if (verifiedApps(factors).length >= MAX_APPS)
    return fail(
      'invalid',
      `You have ${MAX_APPS} authenticator apps. Remove one before you add another.`,
    );
  // a set-up that was started and never finished holds no secret anyone uses: start afresh
  for (const f of unfinishedApps(factors))
    await session.supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await session.supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: ISSUER,
    // unique per person; the page names an app by the day it was added, not by this
    friendlyName: `Authenticator app ${new Date().toISOString()}`,
  });
  log('startTwoStepSetup', { user: session.user.id, ok: !error });
  if (error || !data) return authFailure(error!, 'enroll');
  return ok({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
}

/** Finish setting up an app with the first code it shows. The session counts as two-step from then on. */
export async function finishTwoStepSetup(input: unknown): Promise<Result<{ factorId: string }>> {
  const p = finishInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const session = await getSession();
  if (!session) return fail('unauthenticated', 'Sign in again.');
  const { error } = await session.supabase.auth.mfa.challengeAndVerify({
    factorId: p.data.factorId,
    code: p.data.code,
  });
  log('finishTwoStepSetup', { user: session.user.id, ok: !error });
  if (error) return authFailure(error, 'verify enrol');
  return ok({ factorId: p.data.factorId });
}

/** Remove one of the person's authenticator apps. Supabase Auth asks for a two-step session to remove a finished one. */
export async function removeTwoStepApp(input: unknown): Promise<Result<{ factorId: string }>> {
  const p = removeInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const session = await getSession();
  if (!session) return fail('unauthenticated', 'Sign in again.');
  if (!(session.user.factors ?? []).some((f) => f.id === p.data.factorId))
    return fail('not_found', 'That authenticator app was already removed.');
  const { error } = await session.supabase.auth.mfa.unenroll({ factorId: p.data.factorId });
  log('removeTwoStepApp', { user: session.user.id, ok: !error });
  if (error) return authFailure(error, 'unenroll');
  return ok({ factorId: p.data.factorId });
}

/** The second step of signing in: the code from one of the person's apps (the first one unless they chose). */
export async function verifySignInCode(input: unknown): Promise<Result<null>> {
  const p = verifyInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const signIn = await getSignIn();
  if (!signIn) return fail('unauthenticated', 'Your sign-in has expired. Sign in again.');
  if (!signIn.twoStep.needsCode) return ok(null);
  const apps = verifiedApps(signIn.user.factors);
  const app = p.data.factorId ? apps.find((f) => f.id === p.data.factorId) : apps[0];
  if (!app) return fail('invalid', 'Choose one of your authenticator apps.');
  const { error } = await signIn.supabase.auth.mfa.challengeAndVerify({
    factorId: app.id,
    code: p.data.code,
  });
  log('verifySignInCode', { user: signIn.user.id, ok: !error });
  if (error) return authFailure(error, 'verify sign-in');
  return ok(null);
}

/**
 * Workspace admin › Security: "Require two-step sign-in for this workspace" (owners). Turning it on needs the owner's
 * own session to be two-step, so they cannot lock themselves out. Stored in orgs.settings.requireTwoStep.
 */
export async function setWorkspaceTwoStep(input: unknown): Promise<Result<{ required: boolean }>> {
  const p = workspaceInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId, role, twoStep }) => {
      if (role !== 'owner') return fail('forbidden', 'Only owners can change this.');
      if (v.required && twoStep.level !== 'aal2')
        return fail(
          'forbidden',
          'Set up two-step sign-in for yourself first, in Your account. Then turn this on.',
        );
      const { data: org, error: readError } = await supabase
        .from('orgs')
        .select('settings')
        .eq('id', orgId)
        .single();
      if (readError || !org) return fail('failed', 'The setting could not be saved. Try again.');
      const settings = {
        ...((org.settings ?? {}) as Record<string, Json>),
        [REQUIRE_TWO_STEP]: v.required,
      };
      const { error } = await supabase
        .from('orgs')
        .update({ settings: settings as NonNullable<Json> })
        .eq('id', orgId);
      if (error) return fail('failed', 'The setting could not be saved. Try again.');
      return ok({ required: v.required });
    },
    'setWorkspaceTwoStep',
  );
}
