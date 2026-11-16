'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NEW_PASSWORD_PATH } from '@/lib/auth-links';
import { env } from '@/lib/env';
import { MAX_PASSWORD, newPassword } from '@/lib/passwords';
import { safeNext } from '@/lib/safe-next';
import { verifiedApps } from '@/lib/two-step';
import { createClient } from '@/lib/supabase/server';
import { fail, invalid, ok, type Result } from '@/server/result';

const input = z.object({
  email: z.email('Enter a valid email address.').trim().toLowerCase(),
  next: z.unknown().transform((v) => safeNext(v) ?? undefined),
});

export async function sendMagicLink(
  _: unknown,
  form: FormData,
): Promise<Result<{ email: string }>> {
  const parsed = input.safeParse({ email: form.get('email'), next: form.get('next') || undefined });
  if (!parsed.success) return invalid(parsed.error);
  const callback = new URL('/auth/callback', env.NEXT_PUBLIC_APP_URL);
  if (parsed.data.next) callback.searchParams.set('next', parsed.data.next);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: callback.toString(), shouldCreateUser: true },
  });
  if (error) {
    console.error(JSON.stringify({ level: 'error', source: 'auth', message: error.message }));
    return fail(
      'failed',
      error.status === 429
        ? 'Too many attempts. Wait a minute and try again.'
        : 'Could not send the link. Try again.',
    );
  }
  return ok({ email: parsed.data.email });
}

const passwordInput = z.object({
  email: z.email('Enter a valid email address.').trim().toLowerCase(),
  password: z.string().min(1, 'Enter your password.').max(MAX_PASSWORD),
});

export async function signInWithPassword(_: unknown, form: FormData): Promise<Result<null>> {
  const parsed = passwordInput.safeParse({
    email: form.get('email'),
    password: form.get('password'),
  });
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.status === 429)
      return fail('failed', 'Too many attempts. Wait a minute and try again.');
    // same message for unknown email and wrong password, so accounts cannot be probed
    return fail('unauthenticated', 'Email or password is wrong.');
  }
  const next = safeNext(form.get('next')) ?? '/';
  // an account with an authenticator app enters its code next (two-step sign-in, docs/09 §8)
  if (verifiedApps(data.user?.factors).length > 0)
    redirect(`/login/two-step?next=${encodeURIComponent(next)}`);
  redirect(next);
}

const signUpInput = z.object({
  email: z.email('Enter a valid email address.').trim().toLowerCase(),
  password: newPassword,
});

export async function signUpWithPassword(_: unknown, form: FormData): Promise<Result<null>> {
  const parsed = signUpInput.safeParse({
    email: form.get('email'),
    password: form.get('password'),
  });
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: new URL('/auth/callback', env.NEXT_PUBLIC_APP_URL).toString() },
  });
  if (error) {
    if (error.status === 429)
      return fail('failed', 'Too many attempts. Wait a minute and try again.');
    if (/password/i.test(error.message))
      return fail('invalid', error.message, { password: error.message });
    console.error(JSON.stringify({ level: 'error', source: 'auth', message: error.message }));
    return fail('failed', 'Could not create the account. Try again.');
  }
  // projects that require email confirmation return no session: tell the person instead of redirecting
  if (!data.session)
    return fail('failed', 'Check your email to confirm the account, then sign in.');
  redirect(safeNext(form.get('next')) ?? '/');
}

/**
 * Forgot password (docs/05 §1, docs/09 §12): Supabase Auth emails a reset link that opens a session through the
 * callback and lands on Set a new password. The answer is the same whether or not an account uses the address, and
 * also when Supabase Auth refuses (a second request within its limit is refused for existing accounts only), so the
 * form cannot tell anyone which addresses have accounts.
 */
export async function requestPasswordReset(
  _: unknown,
  form: FormData,
): Promise<Result<{ email: string }>> {
  const parsed = input.safeParse({ email: form.get('email'), next: form.get('next') || undefined });
  if (!parsed.success) return invalid(parsed.error);
  const landing = new URL(NEW_PASSWORD_PATH, env.NEXT_PUBLIC_APP_URL);
  if (parsed.data.next) landing.searchParams.set('next', parsed.data.next);
  const callback = new URL('/auth/callback', env.NEXT_PUBLIC_APP_URL);
  callback.searchParams.set('next', `${landing.pathname}${landing.search}`);
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: callback.toString(),
  });
  // the code and status only, never the address
  if (error)
    console.error(
      JSON.stringify({
        level: 'error',
        source: 'auth',
        during: 'reset password',
        code: error.code,
        status: error.status,
      }),
    );
  return ok({ email: parsed.data.email });
}
