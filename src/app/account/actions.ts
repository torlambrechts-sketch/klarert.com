'use server';

import { revalidatePath } from 'next/cache';
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
