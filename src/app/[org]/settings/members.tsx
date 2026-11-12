'use client';

import { useState } from 'react';
import { Copy, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { ActionForm } from '@/components/forms/action-form';
import { SubmitButton, TextField } from '@/components/forms/form-bits';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ROLE_LABELS, ROLES } from '@/lib/schemas/workspace';
import {
  changeRoleAction,
  createInviteAction,
  removeMemberAction,
  revokeInviteAction,
} from './actions';

type Role = (typeof ROLES)[number];
export type MemberRow = {
  userId: string;
  name: string;
  initials: string;
  color: string;
  role: Role;
  isMe: boolean;
};
export type InviteRow = { id: string; email: string; role: Role; link: string; createdAt: string };

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast('Invite link copied'),
    () => toast.error('Could not copy. Select the link and copy it.'),
  );
}

export function InviteForm({ org, canInviteOwner }: { org: string; canInviteOwner: boolean }) {
  const [link, setLink] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <ActionForm
        action={createInviteAction}
        hidden={{ org }}
        reset
        onSuccess={(d) => setLink(d.link)}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        aria-label="Invite a member"
      >
        {(state) => (
          <>
            <div className="flex-1">
              <TextField
                label="Email"
                name="email"
                type="email"
                placeholder="name@company.com"
                state={state}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <select
                id="invite-role"
                name="role"
                defaultValue="editor"
                className="border-input h-9 rounded-md border bg-white px-3"
              >
                {ROLES.filter((r) => r !== 'owner' || canInviteOwner).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <SubmitButton pendingText="Creating…">Create invite link</SubmitButton>
          </>
        )}
      </ActionForm>
      {link ? (
        <div
          role="status"
          className="bg-subtle border-line flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"
        >
          <p className="text-sm">
            Send this link to the person you invited. It works once, for that email address.
          </p>
          <code className="min-w-0 flex-1 truncate font-mono text-xs" data-testid="invite-link">
            {link}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={() => copy(link)}>
            <Copy aria-hidden /> Copy link
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function MemberRowControls({
  org,
  member,
  myRole,
}: {
  org: string;
  member: MemberRow;
  myRole: Role;
}) {
  const [confirming, setConfirming] = useState(false);
  // only owners change who owns the workspace (docs/01 §4)
  const locked = member.role === 'owner' && myRole !== 'owner';
  if (locked) {
    return (
      <span className="text-muted-foreground flex items-center gap-1 text-sm">
        <Lock className="size-3.5" aria-hidden /> Owner
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <ActionForm
        key={member.role}
        action={changeRoleAction}
        hidden={{ org, userId: member.userId }}
        success="Role changed"
        resetOnFailure
      >
        <label className="sr-only" htmlFor={`role-${member.userId}`}>
          Role for {member.name}
        </label>
        <select
          id={`role-${member.userId}`}
          name="role"
          defaultValue={member.role}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="border-input h-8 rounded-md border bg-white px-2 text-sm"
        >
          {ROLES.filter((r) => r !== 'owner' || myRole === 'owner').map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </ActionForm>
      {confirming ? (
        <ActionForm
          action={removeMemberAction}
          hidden={{ org, userId: member.userId }}
          success="Member removed"
          className="flex items-center gap-2"
        >
          <SubmitButton variant="destructive" size="sm" pendingText="Removing…">
            {member.isMe ? 'Leave workspace' : `Remove ${member.name.split(' ')[0]}`}
          </SubmitButton>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </ActionForm>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
          {member.isMe ? 'Leave' : 'Remove'}
        </Button>
      )}
    </div>
  );
}

export function InviteRowControls({ org, invite }: { org: string; invite: InviteRow }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => copy(invite.link)}>
        <Copy aria-hidden /> Copy link
      </Button>
      <ActionForm
        action={revokeInviteAction}
        hidden={{ org, inviteId: invite.id }}
        success="Invite revoked"
      >
        <SubmitButton variant="ghost" size="sm" pendingText="Revoking…">
          Revoke
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
