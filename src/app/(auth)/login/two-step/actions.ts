'use server';

import { redirect } from 'next/navigation';
import { safeNext } from '@/lib/safe-next';
import { verifySignInCode } from '@/server/commands/two-step';
import type { Result } from '@/server/result';

export async function verifySignInCodeAction(_: unknown, form: FormData): Promise<Result<null>> {
  const r = await verifySignInCode({
    code: form.get('code'),
    factorId: form.get('factorId') || undefined,
  });
  if (!r.ok) return r;
  redirect(safeNext(form.get('next')) ?? '/');
}
