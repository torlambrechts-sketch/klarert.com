'use server';

import { setNewPassword } from '@/server/commands/account';
import type { Result } from '@/server/result';

export async function setNewPasswordAction(
  _: unknown,
  form: FormData,
): Promise<Result<{ othersSignedOut: boolean }>> {
  return setNewPassword({ password: form.get('password'), confirm: form.get('confirm') });
}
