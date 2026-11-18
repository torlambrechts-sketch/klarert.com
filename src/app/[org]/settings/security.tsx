'use client';

import { useId, useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { setWorkspaceTwoStepAction } from './actions';

// Workspace admin › Security (docs/05 §1, docs/09 §8): "Require two-step sign-in for this workspace". Owners change
// it; admins read it. Turning it on needs the owner's own two-step sign-in first.
export function RequireTwoStep({
  org,
  required,
  isOwner,
  ownerHasTwoStep,
}: {
  org: string;
  required: boolean;
  isOwner: boolean;
  ownerHasTwoStep: boolean;
}) {
  const id = useId();
  const [on, setOn] = useState(required);
  const [error, setError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();
  const blockedReason = !isOwner
    ? 'Only owners can change this.'
    : !on && !ownerHasTwoStep
      ? 'Set up two-step sign-in for yourself first.'
      : null;

  const change = (next: boolean) =>
    startPending(async () => {
      setError(null);
      const r = await setWorkspaceTwoStepAction({ org, required: next });
      if (r.ok) {
        setOn(next);
        toast(next ? 'Two-step sign-in is now required.' : 'Two-step sign-in is now optional.');
      } else setError(r.error.message);
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Switch
          id={id}
          checked={on}
          onCheckedChange={change}
          disabled={pending || !!blockedReason}
          aria-describedby={`${id}-help${blockedReason ? ` ${id}-blocked` : ''}`}
          className="mt-0.5"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="text-14 font-medium">
            Require two-step sign-in for this workspace
            <span
              className="text-muted-foreground font-normal"
              data-testid="require-two-step-state"
            >
              {' '}
              · {on ? 'On' : 'Off'}
            </span>
          </label>
          <p id={`${id}-help`} className="text-muted-foreground text-13 m-0">
            Everyone enters a 6-digit code from an authenticator app after their password or email
            link. Members who have not set one up are asked to do so before they can open the
            workspace.
          </p>
        </div>
      </div>
      {blockedReason ? (
        <p id={`${id}-blocked`} className="text-13 m-0">
          {blockedReason}{' '}
          {isOwner ? (
            <Link
              className="text-info underline-offset-4 hover:underline"
              href={`/account?next=${encodeURIComponent(`/${org}/settings?tab=security`)}`}
            >
              Open Your account
            </Link>
          ) : null}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-crit text-13 m-0">
          {error}
        </p>
      ) : null}
    </div>
  );
}
