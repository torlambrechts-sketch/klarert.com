'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { safeNext } from '@/lib/safe-next';
import { createWorkspace, saveProfile } from '@/server/commands/onboarding';
import type { Result } from '@/server/result';

export async function saveProfileAction(
  _: unknown,
  form: FormData,
): Promise<Result<{ id: string }>> {
  const result = await saveProfile({
    displayName: form.get('displayName'),
    initials: form.get('initials'),
    color: form.get('color'),
  });
  if (!result.ok) return result;
  revalidatePath('/', 'layout');
  redirect(safeNext(form.get('next')) ?? '/onboarding');
}

export async function createWorkspaceAction(
  _: unknown,
  form: FormData,
): Promise<Result<{ slug: string }>> {
  const result = await createWorkspace({
    name: form.get('name'),
    slug: form.get('slug'),
    timeZone: form.get('timeZone'),
  });
  if (!result.ok) return result;
  revalidatePath('/', 'layout');
  redirect(`/${result.data.slug}`);
}
