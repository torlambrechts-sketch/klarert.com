'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Copy, Lock, MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { ActionForm } from '@/components/forms/action-form';
import { SubmitButton, TextField } from '@/components/forms/form-bits';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { INVITE_EMAIL_NOT_SENT, ROLE_LABELS, ROLE_SUMMARIES, ROLES } from '@/lib/schemas/workspace';
import type { InviteCreated } from '@/server/commands/members';
import {
  changeRoleAction,
  createInviteAction,
  removeMemberAction,
  resendInviteAction,
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
  /** Auditors: when their access ends (ISO), and the same as a date for the form. */
  expiresAt?: string | null;
  expiresLabel?: string | null;
};
export type InviteRow = {
  id: string;
  email: string;
  role: Role;
  link: string;
  createdAt: string;
  /** The day the link stops working (29 Nov 2026), and whether it has stopped. */
  linkExpiresOn: string;
  linkExpired: boolean;
};

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast('Invite link copied'),
    () => toast.error('Could not copy. Select the link and copy it.'),
  );
}

export function InviteForm({
  org,
  canInviteOwner,
  today,
}: {
  org: string;
  canInviteOwner: boolean;
  /** Today in the workspace's time zone: an auditor's access ends on a later day. */
  today: string;
}) {
  const [sent, setSent] = useState<InviteCreated | null>(null);
  const [role, setRole] = useState<Role>('editor');
  // one toast per invite: whether the email went out (docs/09 §11)
  useEffect(() => {
    if (!sent) return;
    if (sent.emailSent) toast(`Invite sent to ${sent.email}`);
    else toast.error(INVITE_EMAIL_NOT_SENT);
  }, [sent]);
  return (
    <div className="flex flex-col gap-3">
      <ActionForm
        action={createInviteAction}
        hidden={{ org }}
        reset
        onSuccess={setSent}
        className="flex flex-col gap-2"
        aria-label="Invite a member"
      >
        {(state) => (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
                  value={role}
                  onChange={(e) => setRole(e.currentTarget.value as Role)}
                  aria-describedby="invite-role-hint"
                  className="border-input bg-surface h-[40px] rounded-md border px-3"
                >
                  {ROLES.filter((r) => r !== 'owner' || canInviteOwner).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              {role === 'auditor' ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="invite-expires">Access ends on</Label>
                  <input
                    id="invite-expires"
                    name="expiresOn"
                    type="date"
                    required
                    min={today}
                    aria-describedby="invite-expires-hint"
                    className="border-input bg-surface h-[40px] rounded-md border px-3"
                  />
                  <span id="invite-expires-hint" className="sr-only">
                    Auditors have read-only access until the end of this day.
                  </span>
                </div>
              ) : null}
              <SubmitButton pendingText="Sending…">Send invite</SubmitButton>
            </div>
            <p id="invite-role-hint" className="text-muted-foreground text-13 m-0">
              {ROLE_SUMMARIES[role]}
            </p>
          </>
        )}
      </ActionForm>
      {sent ? (
        <div
          role="status"
          data-testid="invite-result"
          className="bg-subtle border-line flex flex-col gap-2 rounded-lg border p-3"
        >
          <p className="text-13 m-0 flex items-start gap-2">
            {sent.emailSent ? (
              <MailCheck className="text-good mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="text-warn mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            <span>
              {sent.emailSent ? (
                <>
                  Invite sent to <span className="font-medium">{sent.email}</span>.
                </>
              ) : (
                INVITE_EMAIL_NOT_SENT
              )}{' '}
              The link works once, for that email address, until {sent.linkExpiresOn}.
            </span>
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="text-12 min-w-0 flex-1 truncate font-mono" data-testid="invite-link">
              {sent.link}
            </code>
            <Button
              type="button"
              variant={sent.emailSent ? 'ghost' : 'outline'}
              size="sm"
              className="self-start sm:self-auto"
              onClick={() => copy(sent.link)}
            >
              <Copy aria-hidden /> Copy link
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MemberRowControls({
  org,
  member,
  myRole,
  today,
}: {
  org: string;
  member: MemberRow;
  myRole: Role;
  today: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [role, setRole] = useState<Role>(member.role);
  // an auditor needs an end date: choosing Auditor shows it instead of saving at once (docs/02 §16)
  const needsDate = role === 'auditor';
  // only owners change who owns the workspace (docs/01 §4)
  const locked = member.role === 'owner' && myRole !== 'owner';
  if (locked) {
    return (
      <span className="text-muted-foreground text-13 flex items-center gap-1">
        <Lock className="size-3.5" aria-hidden /> Owner
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <ActionForm
        key={`${member.role}:${member.expiresAt ?? ''}`}
        action={changeRoleAction}
        hidden={{ org, userId: member.userId }}
        success={needsDate ? 'Auditor access saved' : 'Role changed'}
        resetOnFailure
        className="flex flex-wrap items-center gap-2"
      >
        <label className="sr-only" htmlFor={`role-${member.userId}`}>
          Role for {member.name}
        </label>
        <select
          id={`role-${member.userId}`}
          name="role"
          value={role}
          onChange={(e) => {
            const next = e.currentTarget.value as Role;
            setRole(next);
            if (next !== 'auditor') e.currentTarget.form?.requestSubmit();
          }}
          className="border-input bg-surface text-13 h-[32px] rounded-md border px-2"
        >
          {ROLES.filter((r) => r !== 'owner' || myRole === 'owner').map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        {needsDate ? (
          <>
            <label className="sr-only" htmlFor={`expires-${member.userId}`}>
              Access for {member.name} ends on
            </label>
            <input
              id={`expires-${member.userId}`}
              name="expiresOn"
              type="date"
              min={today}
              defaultValue={member.expiresAt ? member.expiresAt.slice(0, 10) : ''}
              className="border-input bg-surface text-13 h-[32px] rounded-md border px-2"
            />
            <SubmitButton size="sm" pendingText="Saving…">
              Save end date
            </SubmitButton>
          </>
        ) : null}
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
  const [resent, setResent] = useState<{ emailSent: boolean } | null>(null);
  // one toast per resend: whether the email went out
  useEffect(() => {
    if (!resent) return;
    if (resent.emailSent) toast(`Invite sent again to ${invite.email}`);
    else toast.error(INVITE_EMAIL_NOT_SENT);
  }, [resent, invite.email]);
  return (
    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
      {invite.linkExpired ? null : (
        <ActionForm
          action={resendInviteAction}
          hidden={{ org, inviteId: invite.id }}
          onSuccess={setResent}
        >
          <SubmitButton variant="outline" size="sm" pendingText="Sending…">
            Resend<span className="sr-only"> the invite to {invite.email}</span>
          </SubmitButton>
        </ActionForm>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={() => copy(invite.link)}>
        <Copy aria-hidden /> Copy link<span className="sr-only"> for {invite.email}</span>
      </Button>
      <ActionForm
        action={revokeInviteAction}
        hidden={{ org, inviteId: invite.id }}
        success="Invite revoked"
      >
        <SubmitButton variant="ghost" size="sm" pendingText="Revoking…">
          Revoke<span className="sr-only"> the invite to {invite.email}</span>
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
