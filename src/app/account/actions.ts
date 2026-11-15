'use server';

import { revalidatePath } from 'next/cache';
import { changeEmail, changePassword } from '@/server/commands/account';
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
