// Delete my account (docs/05 §1.1, docs/09 §12, migration 0071): the words and checks the card, the command and the
// e2e tests share. Pure: no Supabase, no React.

/** Where the person lands once the account is gone (signed out). */
export const ACCOUNT_DELETED_PATH = '/account-deleted';
/** Your account with the delete dialog open: where the two-step page sends the person back to. */
export const DELETE_ACCOUNT_RETURN = '/account?delete=open';

/** The name the records a deleted person made are shown with (the profile's tombstone, 0071). */
export const FORMER_MEMBER = 'Former member';

/** The person typed the account's email address (case and surrounding spaces do not matter). */
export function confirmsEmail(typed: unknown, email: string | null | undefined): boolean {
  if (typeof typed !== 'string' || !email) return false;
  return typed.trim().toLowerCase() === email.trim().toLowerCase();
}

const list = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** "Make someone else owner of X or delete it first", for each workspace the person is the only owner of. */
export function onlyOwnerMessage(names: string[]): string {
  if (names.length === 1)
    return `You are the only owner of ${names[0]}. Make someone else owner of ${names[0]} or delete it first.`;
  return `You are the only owner of ${list(names)}. Make someone else owner of each of them, or delete them, first.`;
}

/**
 * The workspaces in the database's refusal (`delete_my_account`: the detail is a JSON array of names). Null when the
 * error is not that refusal.
 */
export function onlyOwnerOf(error: { message?: string; details?: string | null }): string[] | null {
  if (!error.message?.startsWith('account: You are the only owner of')) return null;
  try {
    const names: unknown = JSON.parse(error.details ?? '');
    if (Array.isArray(names) && names.length && names.every((n) => typeof n === 'string'))
      return names as string[];
  } catch {
    // fall through: the names are in the message too, but not safely separable
  }
  return [];
}
