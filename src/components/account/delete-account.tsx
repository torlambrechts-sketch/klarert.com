'use client';

import { useActionState, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { SubmitButton, TextField, type FormState } from '@/components/forms/form-bits';
import { deleteMyAccountAction } from '@/app/account/actions';
import { FORMER_MEMBER } from '@/lib/delete-account';

// Your account › Delete my account (docs/05 §1.1, docs/09 §12, migration 0071). The person confirms by typing the
// account's email address; the database refuses the only owner of a workspace and names it. Success signs out and
// lands on a plain page (the action redirects).

export function DeleteAccountPanel({ email, openOnLoad }: { email: string; openOnLoad: boolean }) {
  const [open, setOpen] = useState(openOnLoad);
  const [state, action] = useActionState<FormState<{ deleted: true }>, FormData>(
    deleteMyAccountAction,
    null,
  );
  // the form resets after each attempt: keep what was typed
  const [typed, setTyped] = useState('');
  const refusal = state && !state.ok && !state.error.fieldErrors ? state.error.message : null;

  return (
    <section
      aria-labelledby="delete-account-heading"
      className="border-line bg-surface flex flex-col gap-4 rounded-lg border p-5 sm:px-[22px]"
      data-testid="delete-account-panel"
    >
      <div className="flex flex-col gap-1">
        <h2 id="delete-account-heading" className="text-card-title">
          Delete my account
        </h2>
        <p className="text-muted-foreground text-13 m-0">
          You lose access to every workspace and can no longer sign in. Your name is removed. The
          records you made stay in each workspace and are shown as made by “{FORMER_MEMBER}”. This
          cannot be undone.
        </p>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" className="text-crit w-fit">
            <Trash2 aria-hidden />
            Delete my account
          </Button>
        </DialogTrigger>
        <DialogContent data-testid="delete-account-dialog">
          <DialogTitle className="text-card-title pr-8">Delete your account?</DialogTitle>
          <DialogDescription className="text-14 text-muted-foreground m-0">
            You lose access to every workspace and your name is removed. What you made stays, shown
            as made by “{FORMER_MEMBER}”. If you are the only owner of a workspace, make someone
            else owner of it or delete it first.
          </DialogDescription>
          <form action={action} className="flex flex-col gap-4" noValidate>
            <TextField
              label={`Type ${email} to confirm`}
              name="email"
              type="email"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              required
              autoFocus
              state={state}
            />
            {refusal ? (
              <p
                role="alert"
                data-testid="delete-account-refusal"
                className="bg-crit-soft text-crit text-13 m-0 rounded-md px-4 py-3"
              >
                {refusal}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <SubmitButton variant="destructive" pendingText="Deleting…">
                Delete my account
              </SubmitButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
