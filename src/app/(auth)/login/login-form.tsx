'use client';

import { useActionState } from 'react';
import {
  SubmitButton,
  TextField,
  useResultToast,
  type FormState,
} from '@/components/forms/form-bits';
import { sendMagicLink } from './actions';

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState<FormState<{ email: string }>, FormData>(
    sendMagicLink,
    null,
  );
  useResultToast(state);

  if (state?.ok) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">Check your email</h2>
        <p className="text-muted-foreground">
          We sent a sign-in link to <strong className="text-foreground">{state.data.email}</strong>.
          Open it on this device to continue.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <TextField
        label="Work email"
        name="email"
        type="email"
        autoComplete="email"
        required
        autoFocus
        state={state}
      />
      <SubmitButton pendingText="Sending link…">Send sign-in link</SubmitButton>
    </form>
  );
}
