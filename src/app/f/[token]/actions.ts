'use server';

import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/database.types';
import { env } from '@/lib/env';
import { submitPublicForm, type PublicSubmitResult } from '@/server/commands/forms';
import type { Result } from '@/server/result';

// The public form's submit (no session). The visitor's IP is only hashed (with a server salt) for the rate limit.
export async function submitPublicFormAction(input: unknown): Promise<Result<PublicSubmitResult>> {
  const h = await headers();
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || 'unknown';
  // The public form route is one of the four places allowed to use the service role key (CLAUDE.md rule 6);
  // it is used only to call submit_public_form with the IP hash computed here.
  const serviceKey = z.string().min(20).parse(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const submitter = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return submitPublicForm(input, ip, submitter);
}
