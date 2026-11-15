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
  [/pack already installed/, 'conflict', 'This pack is already installed in this workspace.'],
  [/pack already archived/, 'conflict', 'This pack is already archived.'],
  [/pack changed/, 'conflict', 'This pack changed since you previewed it. Preview it again.'],
  [/pack not found|pack install not found/, 'not_found', 'This pack is no longer available.'],
  [
    /only owners and admins (install|archive) packs/,
    'forbidden',
    'Only owners and admins can install and archive packs.',
  ],
  [/pack plan: (.*)/, 'invalid', 'This pack does not fit the workspace. Preview it again.'],
  [
    /no access: you cannot change a restricted field/,
    'forbidden',
    'This field is restricted. Only the people it lists can change it.',
  ],
  [
    /no access: you cannot edit this sheet/,
    'forbidden',
    'You cannot edit this sheet. Ask an owner or an admin with access.',
  ],
  [
    /no access: you cannot comment on this sheet/,
    'forbidden',
    'You can view this sheet but not comment on it.',
  ],
  [
    /no access: you cannot add sheets to this folder/,
    'forbidden',
    'You cannot add sheets to this folder.',
  ],
  [/no access/, 'forbidden', 'You do not have access to this sheet.'],
  [
    /only owners and admins with access (manage access|restrict fields)/,
    'forbidden',
    'Only owners, and admins who have access, can change who has access.',
  ],
  [/invite expired/, 'forbidden', 'This invite has ended. Ask for a new one.'],
  [
    /memberships_auditor_expires|invites_auditor_expires/,
    'invalid',
    "Choose the day an auditor's access ends.",
  ],
  [
    /only owners and admins change approval workflows/,
    'forbidden',
    'Only owners and admins can change approval workflows.',
  ],
  [/item locked: (.*)/, 'forbidden', 'This item is locked. Only owners and admins can change it.'],
  [/item locked/, 'forbidden', 'This item is locked. Only owners and admins can change it.'],
  [
    /workflow step is set by automations only/,
    'forbidden',
    'The workflow step is set by automations only.',
  ],
  [/link target not allowed/, 'invalid', 'Choose items from the sheet this field links to.'],
  [
    /field .* not in sheet|field .* cannot hold a value/,
    'conflict',
    'A field changed. Reload the sheet.',
  ],
  [/item not found/, 'not_found', 'This item no longer exists or was archived.'],
  // retention (0036, docs/02 §18)
  [
    /retention: on legal hold/,
    'blocked',
    'This item is on legal hold. Release the hold before erasing anything.',
  ],
  [/retention: already done/, 'conflict', 'This retention review was already approved.'],
  [
    /retention: the rule no longer exists/,
    'conflict',
    'The sheet no longer has this retention rule. Check the sheet settings.',
  ],
  [/retention: postpone to a later date/, 'invalid', 'Choose a date after today.'],
  [/retention: say why/, 'invalid', 'Say why.'],
  [/retention: (.*)/, 'invalid', 'The retention check did not fit the sheet. Check again.'],
  [/update too old to change/, 'forbidden', 'Updates can be changed for 15 minutes after posting.'],
  [/update not found/, 'not_found', 'This update was deleted.'],
  [/file already replaced|file not found/, 'conflict', 'That file was replaced in the meantime.'],
  [/file not uploaded/, 'not_found', 'The upload did not arrive. Try again.'],
  [
    /file blocked/,
    'forbidden',
    'This file was blocked by the malware check and cannot be downloaded.',
  ],
  [/file archived/, 'forbidden', 'This file was archived. Ask an owner or admin to restore it.'],
  [
    /only owners and admins change the documents register/,
    'forbidden',
    'Only owners and admins can change whether a sheet is a documents register.',
  ],
  [/bad file field|bad file path/, 'invalid', 'This file cannot be added to this field.'],
  [/group not in sheet/, 'not_found', 'This group no longer exists.'],
  [/sub-items are off for this sheet/, 'conflict', 'Sub-items are off for this sheet.'],
  [/sub-items cannot have sub-items/, 'invalid', 'Sub-items cannot have sub-items of their own.'],
  [/wrong parent/, 'invalid', 'Choose an item of the same sheet as the parent.'],
  [/sheet holds sub-items/, 'invalid', 'Add sub-items under an item.'],
  [/at most 50 sub-items at once/, 'invalid', 'Add at most 50 sub-items at once.'],
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

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function fromDbError(error: { message: string; code?: string }): Result<never> {
  // the sub-item gate (0020) writes its own message for people: which sub-items are still open
  const gate = error.message.match(/subitems open: (.*)/);
  if (gate) return fail('blocked', gate[1]!.trim());
  // forms (0022) write their refusals for people, prefixed "form: "
  // the documents register's workflow (0023) words its refusals for people, prefixed "document: ", mostly in lower
  // case after the prefix: the toast starts with a capital (sentence case), as the approvals' do
  const doc = error.message.match(/document: (.*)/);
  if (doc) return fail('blocked', sentence(doc[1]!.trim()));
  // access control (0026–0028) words its refusals for people, prefixed "access: "
  const access = error.message.match(/^access: (.*)/);
  if (access) return fail('forbidden', access[1]!.trim());
  // approval workflows (0040) word their refusals for people, prefixed "approval: "
  const approval = error.message.match(/approval: (.*)/);
  if (approval) return fail('blocked', sentence(approval[1]!.trim()));
  const form = error.message.match(/^form: (.*)/);
  if (form) return fail('invalid', form[1]!.trim());
  const parent = error.message.match(/restore the parent first: (\S+)/);
  if (parent)
    return fail('conflict', `Restore ${parent[1]} first: this sub-item was archived with it.`);
  for (const [pattern, code, message] of DB_MESSAGES) {
    if (pattern.test(error.message)) return fail(code, message);
  }
  console.error(
    JSON.stringify({ level: 'error', source: 'db', code: error.code, message: error.message }),
  );
  return fail('failed', 'Something went wrong. Try again.');
}
