'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import { AtSign, Check, KeyRound, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SubmitButton, TextField, type FormState } from '@/components/forms/form-bits';
import { changeEmailAction, changePasswordAction } from '@/app/account/actions';
import { EMAIL_LINK_EXPIRY, FORGOT_PASSWORD_PATH } from '@/lib/auth-links';
import { PASSWORD_HINT } from '@/lib/passwords';

// Your account › Email address and Password (docs/05 §1.1, docs/09 §12). Each card opens its form in place; Cancel
// and success close it and give focus back to the button that opened it.

const card = 'border-line bg-background-100 flex flex-col gap-4 rounded-lg border p-5 sm:px-[22px]';

function GeneralError({ state }: { state: FormState }) {
  if (!state || state.ok || state.error.fieldErrors) return null;
  return (
    <p role="alert" className="text-crit text-copy-13 m-0">
      {state.error.message}
    </p>
  );
}

/** Opens a form in place; closing it returns focus to the button that opened it. */
function useInPlaceForm() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);
  return { open, setOpen, trigger };
}

export type EmailNotice = 'confirm-other' | 'link-failed' | null;

export function EmailPanel({
  email,
  pendingEmail,
  notice,
}: {
  email: string;
  /** The address waiting for confirmation (Supabase Auth's `new_email`). */
  pendingEmail: string | null;
  notice: EmailNotice;
}) {
  const { open, setOpen, trigger } = useInPlaceForm();
  const [state, action] = useActionState<FormState<{ newEmail: string }>, FormData>(
    changeEmailAction,
    null,
  );
  // the form resets after each attempt: keep what was typed
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      setTyped('');
    }
  }, [state, setOpen]);

  return (
    <section aria-labelledby="email-heading" className={card} data-testid="email-panel">
      <div className="flex flex-col gap-1">
        <h2 id="email-heading" className="text-heading-16">
          Email address
        </h2>
        <p className="text-copy-14 m-0" data-testid="current-email">
          {email}
        </p>
        <p className="text-muted-foreground text-copy-13 m-0">
          You sign in with this address, and links to sign in or reset your password go to it.
        </p>
      </div>

      {notice === 'confirm-other' && pendingEmail ? (
        <p
          role="status"
          className="bg-good-soft text-copy-13 m-0 flex items-start gap-2 rounded-md px-4 py-3"
        >
          <Check className="text-good mt-0.5 size-4 shrink-0" aria-hidden />
          <span>One link is confirmed. Open the link we sent to the other address to finish.</span>
        </p>
      ) : null}
      {notice === 'link-failed' ? (
        <p role="alert" className="bg-crit-soft text-crit text-copy-13 m-0 rounded-md px-4 py-3">
          That link did not open here: it has expired, was already used or belongs to another
          browser. If the address above has not changed, change it again to get new links.
        </p>
      ) : null}

      {pendingEmail ? (
        <div
          role="status"
          data-testid="email-pending"
          className="bg-subtle text-copy-13 flex items-start gap-2 rounded-md px-4 py-3"
        >
          <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="m-0">
            Waiting for confirmation: <strong>{pendingEmail}</strong>. We sent a link to {email} and
            one to {pendingEmail}. Your email changes once both links are opened. They work for{' '}
            {EMAIL_LINK_EXPIRY}.
          </p>
        </div>
      ) : null}

      {open ? (
        <form action={action} className="flex flex-col gap-4" noValidate data-testid="email-form">
          <TextField
            label="New email address"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={typed}
            onChange={(e) => setTyped(e.target.value)}
            required
            autoFocus
            state={state}
          />
          <GeneralError state={state} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingText="Sending links…">Send confirmation links</SubmitButton>
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
          onClick={() => setOpen(true)}
        >
          <AtSign aria-hidden />
          {pendingEmail ? 'Use another address' : 'Change email'}
        </Button>
      )}
    </section>
  );
}

export function PasswordPanel() {
  const { open, setOpen, trigger } = useInPlaceForm();
  const [state, action] = useActionState<FormState<{ othersSignedOut: boolean }>, FormData>(
    changePasswordAction,
    null,
  );
  const [done, setDone] = useState<{ othersSignedOut: boolean } | null>(null);
  useEffect(() => {
    if (state?.ok) {
      setDone(state.data);
      setOpen(false);
    }
  }, [state, setOpen]);

  return (
    <section aria-labelledby="password-heading" className={card} data-testid="password-panel">
      <div className="flex flex-col gap-1">
        <h2 id="password-heading" className="text-heading-16">
          Password
        </h2>
        <p className="text-muted-foreground text-copy-13 m-0">
          Change the password you sign in with. You are signed out on your other devices afterwards.
        </p>
      </div>

      {done && !open ? (
        <div
          role="status"
          className="bg-good-soft text-copy-13 flex items-start gap-2 rounded-md px-4 py-3"
        >
          <Check className="text-good mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="m-0">
            Your password has been changed.{' '}
            {done.othersSignedOut
              ? 'You are signed out on your other devices.'
              : 'We could not sign you out on your other devices. Sign out there yourself.'}
          </p>
        </div>
      ) : null}

      {open ? (
        <form
          action={action}
          className="flex flex-col gap-4"
          noValidate
          data-testid="password-form"
        >
          <TextField
            label="Current password"
            name="current"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            state={state}
          />
          <TextField
            label="New password"
            name="password"
            type="password"
            autoComplete="new-password"
            hint={PASSWORD_HINT}
            required
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
          <GeneralError state={state} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingText="Changing…">Change password</SubmitButton>
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
            setDone(null);
            setOpen(true);
          }}
        >
          <KeyRound aria-hidden />
          Change password
        </Button>
      )}

      <p className="text-muted-foreground text-copy-13 m-0">
        Forgot it, or never set one?{' '}
        <Link className="text-info underline-offset-4 hover:underline" href={FORGOT_PASSWORD_PATH}>
          Get a reset link by email
        </Link>
      </p>
    </section>
  );
}
