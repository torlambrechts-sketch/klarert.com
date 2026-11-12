'use server';

import { headers } from 'next/headers';
import { submitPublicForm, type PublicSubmitResult } from '@/server/commands/forms';
import type { Result } from '@/server/result';

// The public form's submit (no session). The visitor's IP is only hashed (with a server salt) for the rate limit.
export async function submitPublicFormAction(input: unknown): Promise<Result<PublicSubmitResult>> {
  const h = await headers();
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || 'unknown';
  return submitPublicForm(input, ip);
}
