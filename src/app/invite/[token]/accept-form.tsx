'use client';

import { useActionState } from 'react';
import { SubmitButton, useResultToast, type FormState } from '@/components/forms/form-bits';
import { acceptInviteAction } from './actions';

export function AcceptForm({ token }: { token: string }) {
  const [state, action] = useActionState<FormState, FormData>(acceptInviteAction, null);
  useResultToast(state);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      {state && !state.ok ? (
        <p role="alert" className="text-crit text-13">
          {state.error.message}
        </p>
      ) : null}
      <SubmitButton pendingText="Joining…">Accept and join</SubmitButton>
    </form>
  );
}
