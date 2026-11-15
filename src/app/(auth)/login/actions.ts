'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { env } from '@/lib/env';
import { safeNext } from '@/lib/safe-next';
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

const MIN_PASSWORD = 10;

const passwordInput = z.object({
  email: z.email('Enter a valid email address.').trim().toLowerCase(),
  password: z.string().min(1, 'Enter your password.').max(200),
});

export async function signInWithPassword(_: unknown, form: FormData): Promise<Result<null>> {
  const parsed = passwordInput.safeParse({
    email: form.get('email'),
    password: form.get('password'),
  });
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.status === 429)
      return fail('failed', 'Too many attempts. Wait a minute and try again.');
    // same message for unknown email and wrong password, so accounts cannot be probed
    return fail('unauthenticated', 'Email or password is wrong.');
  }
  redirect(safeNext(form.get('next')) ?? '/');
}

const signUpInput = z.object({
  email: z.email('Enter a valid email address.').trim().toLowerCase(),
  password: z
    .string()
    .min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters.`)
    .max(200, 'Use at most 200 characters.'),
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
