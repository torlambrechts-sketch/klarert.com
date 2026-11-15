import { z } from 'zod';

// Passwords and the sign-in method of a session (docs/09 §8, §11). Pure: shared by the sign-up action, Forgot password,
// Set a new password and Your account › Password. Supabase Auth checks the same minimum (`minimum_password_length`
// in supabase/config.toml, `password_min_length` on the hosted project).

/** At least 12 characters (docs/09 §8.2). */
export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 200;

export const PASSWORD_HINT = `At least ${MIN_PASSWORD} characters.`;
export const PASSWORD_TOO_SHORT = `Use at least ${MIN_PASSWORD} characters.`;
export const PASSWORD_TOO_LONG = `Use at most ${MAX_PASSWORD} characters.`;
export const PASSWORDS_DIFFER = 'The two passwords are not the same.';

/** A new password: long enough, not too long. */
export const newPassword = z
  .string({ error: PASSWORD_TOO_SHORT })
  .min(MIN_PASSWORD, PASSWORD_TOO_SHORT)
  .max(MAX_PASSWORD, PASSWORD_TOO_LONG);

/** The fields of a new password typed twice: spread into a form's schema, then refine with `sameTwice`. */
export const newPasswordFields = {
  password: newPassword,
  confirm: z.string({ error: PASSWORDS_DIFFER }).max(MAX_PASSWORD, PASSWORDS_DIFFER),
};
export const sameTwice = (v: { password: string; confirm: string }) => v.password === v.confirm;
export const sameTwiceIssue = { message: PASSWORDS_DIFFER, path: ['confirm'] };

/** A new password typed twice (`password`, `confirm`); a mismatch is reported on `confirm`. */
export const newPasswordTwice = z.object(newPasswordFields).refine(sameTwice, sameTwiceIssue);

/** The sign-in methods recorded in a session's access token (`amr`), such as password, otp, recovery or totp. */
export function signInMethods(claims: Record<string, unknown> | null): string[] {
  const amr = Array.isArray(claims?.amr) ? (claims.amr as unknown[]) : [];
  return amr
    .map((m) => (m && typeof m === 'object' ? (m as { method?: unknown }).method : null))
    .filter((m): m is string => typeof m === 'string');
}

/**
 * The session was opened by a password reset link (Supabase Auth records `recovery` in `amr`; the two-step code adds
 * `totp` next to it). Only such a session may set a new password without the current one.
 */
export const openedByResetLink = (claims: Record<string, unknown> | null) =>
  signInMethods(claims).includes('recovery');

/** Supabase Auth's refusals of a new password, in plain words, or null when the error is about something else. */
export function passwordRefusal(error: {
  code?: string;
  message?: string;
  reasons?: readonly string[];
}): string | null {
  if (error.code === 'same_password')
    return 'Choose a password you have not used for this account.';
  if (error.code !== 'weak_password') return null;
  // leaked password protection on the hosted project (Authentication › Passwords) refuses known leaked passwords
  if (error.reasons?.includes('pwned') || /pwned|easy to guess/i.test(error.message ?? ''))
    return 'That password appears in known data leaks. Choose another.';
  return PASSWORD_TOO_SHORT;
}
