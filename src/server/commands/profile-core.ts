// The heart of changeDisplayName (Your account › Your name, docs/05 §1.1): the same name rule as onboarding (required,
// trimmed, at most 80 characters, `profileInput`), initials derived as onboarding derives them (`initialsFor`), and
// the write through the profile path onboarding's saveProfile uses: an update of the person's own `profiles` row under
// `profiles_self`. That policy no longer matches a deleted profile ("Former member", 0071), so the update changes no
// row and the person is told so. Kept free of `server-only` and of Supabase so the rules are unit-tested; the command
// in ./account.ts supplies the real dependencies.
import { z } from 'zod';
import { initialsFor } from '@/lib/naming';
import { profileInput } from '@/lib/schemas/workspace';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';

export const NAME_NOT_CHANGED = 'Your name could not be changed. Sign in again and try again.';

export const changeNameInput = z.object({ displayName: profileInput.shape.displayName });

export type NameChange = { displayName: string; initials: string };

export interface ChangeNameDeps {
  /** Updates the person's own profile row (RLS `profiles_self`) and says how many rows changed. */
  update(row: { display_name: string; initials: string }): Promise<{
    rows: number;
    error: { message: string; code?: string } | null;
  }>;
  log(fields: Record<string, unknown>): void;
}

export async function changeNameWith(
  deps: ChangeNameDeps,
  input: unknown,
): Promise<Result<NameChange>> {
  const p = changeNameInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const displayName = p.data.displayName;
  const initials = initialsFor(displayName);
  const { rows, error } = await deps.update({ display_name: displayName, initials });
  deps.log({ ok: !error && rows === 1 });
  if (error) return fromDbError(error);
  // no row: a deleted profile (profiles_self no longer matches it) or no profile at all
  if (rows !== 1) return fail('forbidden', NAME_NOT_CHANGED);
  return ok({ displayName, initials });
}
