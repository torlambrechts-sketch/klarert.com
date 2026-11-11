'use server';

import { z } from 'zod';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { fail, invalid, ok, type Result } from '@/server/result';

const input = z.object({
  email: z.email('Enter a valid email address.').trim().toLowerCase(),
  next: z
    .string()
    .regex(/^\/(?!\/)/)
    .optional()
    .catch(undefined),
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
