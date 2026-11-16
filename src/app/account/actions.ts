'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ACCOUNT_DELETED_PATH, DELETE_ACCOUNT_RETURN } from '@/lib/delete-account';
import { changeEmail, changePassword, deleteMyAccount } from '@/server/commands/account';
import {
  finishTwoStepSetup,
  removeTwoStepApp,
  startTwoStepSetup,
  type TwoStepSetup,
} from '@/server/commands/two-step';
import type { Result } from '@/server/result';

export async function startTwoStepSetupAction(): Promise<Result<TwoStepSetup>> {
  return startTwoStepSetup({});
}

export async function finishTwoStepSetupAction(input: {
  factorId: string;
  code: string;
}): Promise<Result<{ factorId: string }>> {
  const r = await finishTwoStepSetup(input);
  if (r.ok) revalidatePath('/', 'layout');
  return r;
}

export async function removeTwoStepAppAction(input: {
  factorId: string;
}): Promise<Result<{ factorId: string }>> {
  const r = await removeTwoStepApp(input);
  if (r.ok) revalidatePath('/', 'layout');
  return r;
}

export async function changeEmailAction(
  _: unknown,
  form: FormData,
): Promise<Result<{ newEmail: string }>> {
  const r = await changeEmail({ email: form.get('email') });
  if (r.ok) revalidatePath('/account');
  return r;
}

export async function changePasswordAction(
  _: unknown,
  form: FormData,
): Promise<Result<{ othersSignedOut: boolean }>> {
  return changePassword({
    current: form.get('current'),
    password: form.get('password'),
    confirm: form.get('confirm'),
  });
}

/**
 * Delete my account (docs/09 §12): a person who owes their authenticator app's code goes to the two-step page first
 * and comes back to the open dialog; once deleted, the signed-out person lands on a plain page.
 */
export async function deleteMyAccountAction(
  _: unknown,
  form: FormData,
): Promise<Result<{ deleted: true }>> {
  const r = await deleteMyAccount({ email: form.get('email') ?? '' });
  if ('needsCode' in r)
    redirect(`/login/two-step?next=${encodeURIComponent(DELETE_ACCOUNT_RETURN)}`);
  if (r.ok) redirect(ACCOUNT_DELETED_PATH);
  return r;
}
