'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Copy, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BRAND } from '@/lib/brand';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  finishTwoStepSetupAction,
  removeTwoStepAppAction,
  startTwoStepSetupAction,
} from '@/app/account/actions';
import type { TwoStepSetup } from '@/server/commands/two-step';

type App = { id: string; added: string };

/** The key in groups of four, as authenticator apps show it. */
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

// Your account › Two-step sign-in (docs/05 §1, docs/09 §8): the person's authenticator apps, setting one up (QR code,
// the key to type by hand, the first code) and removing one. Recovery: a second app or the saved key; there are no
// recovery codes.
export function TwoStepPanel({
  apps,
  email,
  continueTo,
  requiredBy,
}: {
  apps: App[];
  email: string;
  /** Where to go once set up, when a workspace sent the person here. */
  continueTo: string | null;
  /** Names of the person's workspaces that require two-step sign-in. */
  requiredBy: string[];
}) {
  const router = useRouter();
  const [setup, setSetup] = useState<TwoStepSetup | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [starting, startStarting] = useTransition();
  const on = apps.length > 0;

  const start = () =>
    startStarting(async () => {
      setStartError(null);
      setDone(false);
      const r = await startTwoStepSetupAction();
      if (r.ok) setSetup(r.data);
      else setStartError(r.error.message);
    });

  return (
    <section
      aria-labelledby="two-step-heading"
      className="border-line bg-background-100 flex flex-col gap-4 rounded-lg border p-5 sm:px-[22px]"
    >
      <div className="flex flex-col gap-1">
        <h2 id="two-step-heading" className="text-heading-16 flex items-center gap-2">
          Two-step sign-in
          <span
            data-testid="two-step-status"
            className={`text-label-12 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
              on ? 'bg-good-soft text-good' : 'bg-subtle text-muted-foreground'
            }`}
          >
            {on ? <Check className="size-3" aria-hidden /> : null}
            {on ? 'On' : 'Off'}
          </span>
        </h2>
        <p className="text-muted-foreground text-copy-13 m-0">
          {on
            ? 'After your password or email link, you enter a 6-digit code from your authenticator app.'
            : 'Protect your account with a second step: after your password or email link, you enter a 6-digit code from an authenticator app on your phone.'}
        </p>
      </div>

      {on ? (
        <ul
          className="border-line flex flex-col divide-y rounded-md border"
          aria-label="Your authenticator apps"
        >
          {apps.map((app, i) => (
            <AppRow
              key={app.id}
              app={app}
              label={apps.length > 1 ? `Authenticator app ${i + 1}` : 'Authenticator app'}
              last={apps.length === 1}
              requiredBy={requiredBy}
              onRemoved={() => router.refresh()}
            />
          ))}
        </ul>
      ) : null}

      {setup ? (
        <SetupSteps
          setup={setup}
          email={email}
          onCancel={() => setSetup(null)}
          onDone={() => {
            setSetup(null);
            setDone(true);
            toast('Two-step sign-in is on.');
            router.refresh();
          }}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {startError ? (
            <p role="alert" className="text-crit text-copy-13 m-0">
              {startError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {done && continueTo ? (
              <Button type="button" onClick={() => router.push(continueTo)}>
                Continue to the workspace
              </Button>
            ) : null}
            <Button
              type="button"
              variant={on ? 'outline' : 'default'}
              onClick={start}
              disabled={starting}
              aria-disabled={starting}
            >
              <Smartphone aria-hidden />
              {starting
                ? 'Starting…'
                : startError
                  ? 'Try again'
                  : on
                    ? 'Add another authenticator app'
                    : 'Set up two-step sign-in'}
            </Button>
          </div>
        </div>
      )}

      {on || done ? <Recovery /> : null}
    </section>
  );
}

function Recovery() {
  return (
    <div
      className="bg-subtle flex flex-col gap-1 rounded-md px-4 py-3"
      data-testid="two-step-recovery"
    >
      <h3 className="text-label-14 m-0 flex items-center gap-2 font-semibold">
        <KeyRound className="size-4" aria-hidden />
        If you lose your phone
      </h3>
      <ul className="text-copy-13 m-0 flex list-disc flex-col gap-1 pl-5">
        <li>Add a second authenticator app on another device now, so you have a spare.</li>
        <li>Or keep the key you typed in somewhere safe, such as a password manager.</li>
        <li>
          Without either, you cannot sign in. Ask your workspace owner to contact {BRAND.product}{' '}
          support to reset two-step sign-in for you.
        </li>
      </ul>
    </div>
  );
}

function SetupSteps({
  setup,
  email,
  onCancel,
  onDone,
}: {
  setup: TwoStepSetup;
  email: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const codeId = useId();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startPending] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const submit = (form: FormData) =>
    startPending(async () => {
      setError(null);
      const r = await finishTwoStepSetupAction({
        factorId: setup.factorId,
        code: String(form.get('code') ?? ''),
      });
      if (r.ok) onDone();
      else {
        setError(r.error.fieldErrors?.code ?? r.error.message);
        input.current?.focus();
      }
    });

  return (
    <form action={submit} className="flex flex-col gap-4" data-testid="two-step-setup">
      <ol className="flex list-none flex-col gap-4 p-0">
        <li className="flex flex-col gap-2">
          <p className="text-label-14 m-0 font-medium">
            1. Scan this QR code with an authenticator app
          </p>
          <p className="text-muted-foreground text-copy-13 m-0">
            For example Google Authenticator, Microsoft Authenticator or 1Password. It adds “
            {BRAND.product} ({email})”.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- an SVG data URL from Supabase Auth, made per person */}
          <img
            src={setup.qrCode}
            alt="QR code to scan with your authenticator app"
            width={180}
            height={180}
            className="border-line size-[180px] rounded-md border bg-white p-2"
          />
        </li>
        <li className="flex flex-col gap-2">
          <p className="text-label-14 m-0 font-medium">2. Or type this key into the app</p>
          <div className="flex flex-wrap items-center gap-2">
            <code
              data-testid="two-step-secret"
              data-secret={setup.secret}
              className="bg-subtle text-label-13-mono rounded-md px-2 py-1.5 break-all"
            >
              {grouped(setup.secret)}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(setup.secret);
                  setCopied(true);
                } catch {
                  toast.error('The key could not be copied. Select it and copy it instead.');
                }
              }}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? 'Copied' : 'Copy key'}
            </Button>
          </div>
        </li>
        <li className="flex flex-col gap-1.5">
          <Label htmlFor={codeId}>3. Enter the 6-digit code the app shows</Label>
          <Input
            ref={input}
            id={codeId}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={9}
            required
            autoFocus
            className="max-w-[200px] tracking-widest"
            aria-invalid={!!error}
            aria-describedby={error ? `${codeId}-error` : undefined}
          />
          {error ? (
            <p id={`${codeId}-error`} role="alert" className="text-crit text-copy-13 m-0">
              {error}
            </p>
          ) : null}
        </li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} aria-disabled={pending}>
          <ShieldCheck aria-hidden />
          {pending ? 'Checking…' : 'Turn on two-step sign-in'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AppRow({
  app,
  label,
  last,
  requiredBy,
  onRemoved,
}: {
  app: App;
  label: string;
  last: boolean;
  requiredBy: string[];
  onRemoved: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startPending] = useTransition();
  const remove = () =>
    startPending(async () => {
      const r = await removeTwoStepAppAction({ factorId: app.id });
      if (r.ok) {
        toast(last ? 'Two-step sign-in is off.' : 'Authenticator app removed.');
        onRemoved();
      } else toast.error(r.error.message);
    });
  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Smartphone className="text-muted-foreground size-4" aria-hidden />
          <div className="flex flex-col">
            <span className="text-label-14 font-medium">{label}</span>
            <span className="text-muted-foreground text-label-12">Added {app.added}</span>
          </div>
        </div>
        {!confirming ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setConfirming(true)}
            aria-label={`Remove ${label}, added ${app.added}`}
          >
            Remove
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <div
          role="group"
          aria-label={`Remove ${label}`}
          className="bg-subtle flex flex-col gap-2 rounded-md p-3"
        >
          <p className="text-copy-13 m-0">
            {last
              ? 'Remove this app? Two-step sign-in turns off: you sign in with your password or an email link only.'
              : 'Remove this app? Its codes stop working. Your other apps keep working.'}
            {last && requiredBy.length
              ? ` ${requiredBy.join(', ')} ${requiredBy.length === 1 ? 'requires' : 'require'} two-step sign-in, so you will be asked to set it up again.`
              : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={remove}
              disabled={pending}
            >
              {pending ? 'Removing…' : 'Remove app'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
              disabled={pending}
              autoFocus
            >
              Keep it
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
