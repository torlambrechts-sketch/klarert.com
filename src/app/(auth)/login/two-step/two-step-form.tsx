'use client';

import { useActionState, useId } from 'react';
import { SubmitButton, TextField, type FormState } from '@/components/forms/form-bits';
import { verifySignInCodeAction } from './actions';

export function TwoStepForm({
  apps,
  next,
}: {
  apps: { id: string; label: string }[];
  next?: string;
}) {
  const [state, action] = useActionState<FormState<null>, FormData>(verifySignInCodeAction, null);
  const legend = useId();
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {apps.length > 1 ? (
        <fieldset className="flex flex-col gap-2" aria-labelledby={legend}>
          <legend id={legend} className="text-14 mb-1 font-medium">
            Which app?
          </legend>
          {apps.map((app, i) => (
            <label key={app.id} className="text-14 flex items-center gap-2">
              <input type="radio" name="factorId" value={app.id} defaultChecked={i === 0} />
              {app.label}
            </label>
          ))}
        </fieldset>
      ) : null}
      <TextField
        label="6-digit code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={9}
        required
        autoFocus
        className="tracking-widest"
        state={state}
      />
      {state && !state.ok && !state.error.fieldErrors ? (
        <p role="alert" className="text-crit text-13">
          {state.error.message}
        </p>
      ) : null}
      <SubmitButton pendingText="Checking…">Continue</SubmitButton>
    </form>
  );
}
