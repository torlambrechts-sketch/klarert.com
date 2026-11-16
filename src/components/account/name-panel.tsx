'use client';

import { useActionState, useEffect, useState } from 'react';
import { PenLine } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SubmitButton, TextField, type FormState } from '@/components/forms/form-bits';
import { changeDisplayNameAction } from '@/app/account/actions';
import type { NameChange } from '@/server/commands/profile-core';
import { card, GeneralError, useInPlaceForm } from './sign-in-details';

// Your account › Your name (docs/05 §1.1): the name people see in the workspaces, with the initials on the avatar
// derived from it as onboarding does. Opens its form in place like the email and password cards.

const MAX_NAME = 80; // profileInput (src/lib/schemas/workspace.ts), the limit onboarding enforces

export function NamePanel({ name }: { name: string }) {
  const { open, setOpen, trigger } = useInPlaceForm();
  const [state, action] = useActionState<FormState<NameChange>, FormData>(
    changeDisplayNameAction,
    null,
  );
  // the form resets after each attempt: keep what was typed
  const [typed, setTyped] = useState(name);
  useEffect(() => {
    if (state?.ok) {
      toast('Your name is saved.');
      setOpen(false);
    }
  }, [state, setOpen]);

  return (
    <section aria-labelledby="name-heading" className={card} data-testid="name-panel">
      <div className="flex flex-col gap-1">
        <h2 id="name-heading" className="text-heading-16">
          Your name
        </h2>
        <p className="text-copy-14 m-0 break-words" data-testid="current-name">
          {name}
        </p>
        <p className="text-muted-foreground text-copy-13 m-0">
          People in your workspaces see this name. Your initials follow it.
        </p>
      </div>

      {open ? (
        <form action={action} className="flex flex-col gap-4" noValidate data-testid="name-form">
          <TextField
            label="Your name"
            name="displayName"
            autoComplete="name"
            defaultValue={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={MAX_NAME}
            required
            autoFocus
            state={state}
          />
          <GeneralError state={state} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingText="Saving…">Save name</SubmitButton>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          ref={trigger}
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() => {
            setTyped(name);
            setOpen(true);
          }}
        >
          <PenLine aria-hidden />
          Change name
        </Button>
      )}
    </section>
  );
}
