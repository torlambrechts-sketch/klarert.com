import type { z } from 'zod';

export type CommandError = {
  code:
    | 'invalid'
    | 'unauthenticated'
    | 'forbidden'
    | 'not_found'
    | 'conflict'
    | 'failed'
    /** A status rule or a validation rule blocks the change (docs/03 §6). */
    | 'blocked'
    /** A status rule needs a comment: resend with `note` (docs/03 §6). */
    | 'comment_required';
  message: string;
  fieldErrors?: Record<string, string>;
};
export type Result<T> = { ok: true; data: T } | { ok: false; error: CommandError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (
  code: CommandError['code'],
  message: string,
  fieldErrors?: Record<string, string>,
): Result<never> => ({
  ok: false,
  error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) },
});

export function invalid(error: z.ZodError): Result<never> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    fieldErrors[key] ??= issue.message;
  }
  return fail('invalid', 'Check the highlighted fields.', fieldErrors);
}

// Database exceptions raised by our functions and policies, translated for people.
const DB_MESSAGES: [RegExp, CommandError['code'], string][] = [
  [
    /a workspace needs at least one owner/,
    'conflict',
    'A workspace needs at least one owner. Make someone else owner first.',
  ],
  [
    /only an owner can (change who owns|invite an owner)/,
    'forbidden',
    'Only an owner can do that.',
  ],
  [
    /invite is for another email address/,
    'forbidden',
    'This invite was sent to a different email address. Sign in with that address to accept it.',
  ],
  [/invite already used/, 'conflict', 'This invite has already been used.'],
  [/invite not found/, 'not_found', 'This invite link is not valid. Ask for a new one.'],
  [
    /orgs_slug_key|duplicate key value violates unique constraint "orgs_slug/,
    'conflict',
    'That web address is taken. Try another.',
  ],
  [/invites_open_email_idx/, 'conflict', 'This person already has an open invite.'],
  [/memberships_pkey/, 'conflict', 'This person is already a member.'],
  [/item locked: (.*)/, 'forbidden', 'This item is locked. Only owners and admins can change it.'],
  [/item locked/, 'forbidden', 'This item is locked. Only owners and admins can change it.'],
  [
    /workflow step is set by automations only/,
    'forbidden',
    'The workflow step is set by automations only.',
  ],
  [/link target not allowed/, 'invalid', 'Choose items from the sheet this field links to.'],
  [/field .* not in sheet|field .* cannot hold a value/, 'conflict', 'A field changed. Reload the sheet.'],
  [/item not found/, 'not_found', 'This item no longer exists or was archived.'],
  [/group not in sheet/, 'not_found', 'This group no longer exists.'],
  [/prefix locked/, 'conflict', 'The ID prefix is fixed once the sheet has items.'],
  [/sheets_org_id_id_prefix_key/, 'conflict', 'Another sheet uses this ID prefix. Choose another.'],
  [/a sheet needs at least one group/, 'conflict', 'A sheet needs at least one group.'],
  [/group has items/, 'conflict', 'This group has items. Choose a group to move them to first.'],
  [/folder not in workspace/, 'invalid', 'Choose a folder of this workspace.'],
  [/duplicate key value/, 'conflict', 'That name is already used.'],
  [
    /row-level security|not allowed|permission denied/,
    'forbidden',
    'You do not have permission to do that.',
  ],
];

export function fromDbError(error: { message: string; code?: string }): Result<never> {
  for (const [pattern, code, message] of DB_MESSAGES) {
    if (pattern.test(error.message)) return fail(code, message);
  }
  console.error(
    JSON.stringify({ level: 'error', source: 'db', code: error.code, message: error.message }),
  );
  return fail('failed', 'Something went wrong. Try again.');
}
