import 'server-only';
import { z } from 'zod';
import type { AuthError } from '@supabase/supabase-js';
import { ACCOUNT_PATH } from '@/lib/auth-links';
import { env } from '@/lib/env';
import {
  MAX_PASSWORD,
  newPasswordFields,
  passwordRefusal,
  sameTwice,
  sameTwiceIssue,
} from '@/lib/passwords';
import { confirmsEmail, onlyOwnerMessage, onlyOwnerOf } from '@/lib/delete-account';
import { createPasswordCheckClient } from '@/lib/supabase/server';
import { getSession, getSignIn } from '@/server/auth';
import { fail, fromDbError, invalid, ok, type CommandError, type Result } from '@/server/result';
import { log } from './context';

// Your account (docs/05 §1.1, docs/09 §12): the person's own email address and password, through Supabase Auth on
// their own session. No table of ours changes and no service role is used. Supabase Auth asks for a two-step (aal2)
// session to change either when the person has an authenticator app; getSession() only returns such a session.

const changeEmailInput = z.object({
  email: z.email('Enter a valid email address.').trim().toLowerCase(),
});
const changePasswordInput = z
  .object({
    current: z
      .string({ error: 'Enter your current password.' })
      .min(1, 'Enter your current password.')
      .max(MAX_PASSWORD),
    ...newPasswordFields,
  })
  .refine(sameTwice, sameTwiceIssue);
const setNewPasswordInput = z.object(newPasswordFields).refine(sameTwice, sameTwiceIssue);

const TOO_MANY = 'Too many attempts. Wait a minute and try again.';
const CODE_FIRST = 'Enter a code from your authenticator app first, then try again.';

function authFailure(error: AuthError, during: string, failed: string): Result<never> {
  if (error.status === 429) return fail('failed', TOO_MANY);
  if (error.code === 'insufficient_aal') return fail('forbidden', CODE_FIRST);
  const refusal = passwordRefusal(error as AuthError & { reasons?: string[] });
  if (refusal) return fail('invalid', refusal, { password: refusal });
  // the code and status only: Supabase Auth's messages can echo the address
  console.error(
    JSON.stringify({
      level: 'error',
      source: 'account',
      during,
      code: error.code,
      status: error.status,
    }),
  );
  return fail('failed', failed);
}

/** Two-step sign-in is owed before email or password change (also refused by Supabase Auth itself). */
const owesCode = (twoStep: { enrolled: boolean; level: string }) =>
  twoStep.enrolled && twoStep.level !== 'aal2';

/** End every other session of the person (their other devices and browsers). Says whether that worked. */
async function endOtherSessions(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  during: string,
) {
  const { error } = await session.supabase.auth.signOut({ scope: 'others' });
  if (error)
    console.error(
      JSON.stringify({
        level: 'error',
        source: 'account',
        during,
        code: error.code,
        status: error.status,
      }),
    );
  return !error;
}

/**
 * Change the email address. Supabase's secure email change sends a link to the current and to the new address; the
 * address changes once both are opened (hosted: "Secure email change" on and "Confirm email" on, docs/09 §12).
 */
export async function changeEmail(input: unknown): Promise<Result<{ newEmail: string }>> {
  const p = changeEmailInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const session = await getSession();
  if (!session) return fail('unauthenticated', 'Sign in again.');
  if (owesCode(session.twoStep)) return fail('forbidden', CODE_FIRST);
  if (p.data.email === session.user.email?.toLowerCase())
    return fail('invalid', 'That is already your email address.', {
      email: 'That is already your email address.',
    });
  const callback = new URL('/auth/callback', env.NEXT_PUBLIC_APP_URL);
  callback.searchParams.set('next', ACCOUNT_PATH);
  const { error } = await session.supabase.auth.updateUser(
    { email: p.data.email },
    { emailRedirectTo: callback.toString() },
  );
  log('changeEmail', { user: session.user.id, ok: !error });
  if (error?.code === 'email_exists')
    return fail('invalid', 'That address cannot be used. Choose another.', {
      email: 'That address cannot be used. Choose another.',
    });
  if (error)
    return authFailure(
      error,
      'change email',
      'The confirmation links could not be sent. Try again.',
    );
  return ok({ newEmail: p.data.email });
}

/**
 * Change the password: the current one first (checked by signing in with it on a client that keeps no session), then
 * the new one twice. Every other session ends afterwards.
 */
export async function changePassword(
  input: unknown,
): Promise<Result<{ othersSignedOut: boolean }>> {
  const p = changePasswordInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const session = await getSession();
  if (!session) return fail('unauthenticated', 'Sign in again.');
  if (owesCode(session.twoStep)) return fail('forbidden', CODE_FIRST);
  const email = session.user.email;
  if (!email)
    return fail('failed', 'Your account has no email address to check the password with.');

  const check = createPasswordCheckClient();
  const { error: wrong } = await check.auth.signInWithPassword({ email, password: p.data.current });
  if (wrong) {
    log('changePassword', { user: session.user.id, ok: false, step: 'current' });
    if (wrong.status === 429) return fail('failed', TOO_MANY);
    return fail('invalid', 'That is not your current password.', {
      current: 'That is not your current password.',
    });
  }
  // the check opened a session of its own: end it at once
  await check.auth.signOut({ scope: 'local' });
  const { error } = await session.supabase.auth.updateUser({ password: p.data.password });
  log('changePassword', { user: session.user.id, ok: !error });
  if (error)
    return authFailure(error, 'change password', 'The password could not be changed. Try again.');
  return ok({
    othersSignedOut: await endOtherSessions(session, 'change password: other sessions'),
  });
}

/**
 * Set a new password after a reset link (Forgot password). Only a session the reset link opened may do this without
 * the current password; with an authenticator app, its code comes first (getSession() needs aal2).
 */
export async function setNewPassword(
  input: unknown,
): Promise<Result<{ othersSignedOut: boolean }>> {
  const p = setNewPasswordInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const session = await getSession();
  if (!session) return fail('unauthenticated', 'Your reset link has expired. Ask for a new one.');
  if (!session.resetLink)
    return fail(
      'forbidden',
      'Open the link in your reset email first, or change your password in Your account.',
    );
  if (owesCode(session.twoStep)) return fail('forbidden', CODE_FIRST);
  const { error } = await session.supabase.auth.updateUser({ password: p.data.password });
  log('setNewPassword', { user: session.user.id, ok: !error });
  if (error)
    return authFailure(error, 'set new password', 'The password could not be changed. Try again.');
  return ok({
    othersSignedOut: await endOtherSessions(session, 'set new password: other sessions'),
  });
}

const deleteAccountInput = z.object({
  email: z.string({ error: 'Type your email address.' }).max(320),
});
const TYPE_EMAIL = 'Type your email address exactly as it is shown.';

/**
 * Delete my account (docs/05 §1.1, docs/09 §12, migration 0071): `delete_my_account` on the person's own session (no
 * service role). It refuses the only owner of a workspace and, for a person with an authenticator app, a session
 * without its code; it removes every membership (logged), leaves a nameless profile ("Former member") so the records
 * the person made keep their author, and deletes the sign-in. The session is signed out afterwards.
 * `needsCode`: send the person to the two-step page first.
 */
export type DeleteAccountResult =
  Result<{ deleted: true }> | { ok: false; needsCode: true; error: CommandError };

const needsCode = (): DeleteAccountResult => ({
  ok: false,
  needsCode: true,
  error: { code: 'forbidden', message: CODE_FIRST },
});

export async function deleteMyAccount(input: unknown): Promise<DeleteAccountResult> {
  const p = deleteAccountInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const signIn = await getSignIn();
  if (signIn && owesCode(signIn.twoStep)) return needsCode();
  const session = await getSession();
  if (!session) return fail('unauthenticated', 'Sign in again.');
  if (!confirmsEmail(p.data.email, session.user.email))
    return fail('invalid', TYPE_EMAIL, { email: TYPE_EMAIL });

  const { error } = await session.supabase.rpc('delete_my_account');
  log('deleteMyAccount', { user: session.user.id, ok: !error });
  if (error) {
    const names = onlyOwnerOf(error);
    if (names)
      return fail('conflict', names.length ? onlyOwnerMessage(names) : error.message.slice(9));
    if (error.code === '42501' && /authenticator app/.test(error.message)) return needsCode();
    return fromDbError(error);
  }
  // the auth user is gone: Supabase Auth answers the sign-out with "user not found", and the client still clears the
  // session cookies
  const { error: signOutError } = await session.supabase.auth.signOut({ scope: 'local' });
  if (signOutError)
    console.error(
      JSON.stringify({
        level: 'error',
        source: 'account',
        during: 'delete account: sign out',
        code: signOutError.code,
        status: signOutError.status,
      }),
    );
  return ok({ deleted: true });
}
