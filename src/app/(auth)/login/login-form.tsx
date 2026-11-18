'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import {
  SubmitButton,
  TextField,
  useResultToast,
  type FormState,
} from '@/components/forms/form-bits';
import { sendMagicLink, signInWithPassword, signUpWithPassword } from './actions';

/** Under the forms that can create an account: the password sign-up and the email link. */
function TermsLine() {
  return (
    <p className="text-muted-foreground text-13 m-0">
      By creating an account you agree to the{' '}
      <Link className="text-info underline underline-offset-4" href="/terms">
        terms
      </Link>{' '}
      and the{' '}
      <Link className="text-info underline underline-offset-4" href="/privacy">
        privacy notice
      </Link>
      .
    </p>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState<FormState<{ email: string }>, FormData>(
    sendMagicLink,
    null,
  );
  useResultToast(state);

  if (state?.ok) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <h2 className="text-card-title">Check your email</h2>
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
      {/* a link to an address without an account creates one */}
      <TermsLine />
    </form>
  );
}

export function PasswordForm({
  next,
  mode,
  initialEmail,
  initialPassword,
}: {
  next?: string;
  mode: 'signin' | 'signup';
  /** Filled in for the demo workspace (src/lib/demo-login.ts). */
  initialEmail?: string;
  initialPassword?: string;
}) {
  const [state, action] = useActionState<FormState<null>, FormData>(
    mode === 'signin' ? signInWithPassword : signUpWithPassword,
    null,
  );
  // Forms reset after an action; an uncontrolled field whose default follows the typed email keeps it across
  // attempts without wiping what was typed before hydration. Errors show inline, next to the form.
  const [email, setEmail] = useState(initialEmail ?? '');
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        defaultValue={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoFocus
        state={state}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        defaultValue={initialPassword}
        hint={mode === 'signup' ? 'At least 12 characters.' : undefined}
        required
        state={state}
      />
      {state && !state.ok && !state.error.fieldErrors ? (
        <p role="alert" className="text-crit text-13">
          {state.error.message}
        </p>
      ) : null}
      <SubmitButton pendingText={mode === 'signin' ? 'Signing in…' : 'Creating account…'}>
        {mode === 'signin' ? 'Sign in' : 'Create account'}
      </SubmitButton>
      {mode === 'signup' ? <TermsLine /> : null}
    </form>
  );
}
