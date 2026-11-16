'use client';

import { useActionState } from 'react';
import { SubmitButton, TextField, type FormState } from '@/components/forms/form-bits';
import { EMAIL_LINK_EXPIRY } from '@/lib/auth-links';
import { requestPasswordReset } from '../actions';

export function ForgotPasswordForm({ next }: { next?: string }) {
  const [state, action] = useActionState<FormState<{ email: string }>, FormData>(
    requestPasswordReset,
    null,
  );

  if (state?.ok) {
    return (
      <div role="status" className="flex flex-col gap-2" data-testid="reset-sent">
        <h3 className="text-heading-16">Check your email</h3>
        <p className="text-muted-foreground m-0">
          If an account uses that address, we have sent a link to reset your password.
        </p>
        <p className="text-muted-foreground m-0">
          The link works for {EMAIL_LINK_EXPIRY}. Open it in this browser.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        autoFocus
        state={state}
      />
      {state && !state.ok && !state.error.fieldErrors ? (
        <p role="alert" className="text-crit text-copy-13">
          {state.error.message}
        </p>
      ) : null}
      <SubmitButton pendingText="Sending link…">Send reset link</SubmitButton>
    </form>
  );
}
