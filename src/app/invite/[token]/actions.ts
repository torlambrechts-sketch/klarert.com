'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { acceptInvite } from '@/server/commands/onboarding';
import type { Result } from '@/server/result';

export async function acceptInviteAction(
  _: unknown,
  form: FormData,
): Promise<Result<{ slug: string }>> {
  const result = await acceptInvite({ token: form.get('token') });
  if (!result.ok) return result;
  revalidatePath('/', 'layout');
  // straight to Home, not via the workspace index page's redirect (see onboarding/actions.ts)
  redirect(`/${result.data.slug}/home`);
}
