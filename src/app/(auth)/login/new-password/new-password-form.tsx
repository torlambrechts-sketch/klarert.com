'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { SubmitButton, TextField, type FormState } from '@/components/forms/form-bits';
import { buttonVariants } from '@/components/ui/button';
import { PASSWORD_HINT } from '@/lib/passwords';
import { setNewPasswordAction } from './actions';

export function NewPasswordForm({ next }: { next?: string }) {
  const [state, action] = useActionState<FormState<{ othersSignedOut: boolean }>, FormData>(
    setNewPasswordAction,
    null,
  );

  if (state?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <div role="status" className="flex flex-col gap-2" data-testid="password-changed">
          <h3 className="text-card-title">Your password has been changed.</h3>
          <p className="text-muted-foreground m-0">
            {state.data.othersSignedOut
              ? 'You are signed out on your other devices. Use the new password there.'
              : 'We could not sign you out on your other devices. Sign out there yourself.'}
          </p>
        </div>
        <Link href={next ?? '/'} autoFocus className={buttonVariants({ className: 'w-fit' })}>
          Continue
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <TextField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint={PASSWORD_HINT}
        required
        autoFocus
        state={state}
      />
      <TextField
        label="Repeat the new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        state={state}
      />
      {state && !state.ok && !state.error.fieldErrors ? (
        <p role="alert" className="text-crit text-13">
          {state.error.message}
        </p>
      ) : null}
      <SubmitButton pendingText="Saving…">Set new password</SubmitButton>
    </form>
  );
}
