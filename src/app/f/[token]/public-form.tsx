'use client';

import { useId, useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import '@/engine/fields/registry';
import type { Field } from '@/engine/types';
import { LEGAL_BASIS_LABEL, type FormLayout, type PrivacyNotice } from '@/engine/views/config';
import { checkFormAnswers, formCtx, formQuestions } from '@/engine/views/form';
import { FormFill } from '@/components/views/form-fill';
import { Button } from '@/components/ui/button';
import { submitPublicFormAction } from './actions';

const newId = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}`;

/** The privacy notice as the visitor reads it (the controller is the workspace). */
export function NoticeText({ notice, controller }: { notice: PrivacyNotice; controller: string }) {
  const rows: [string, string | undefined][] = [
    ['Who is responsible', controller],
    ['Why we ask', notice.purpose],
    ['Legal basis', notice.legalBasis ? LEGAL_BASIS_LABEL[notice.legalBasis] : undefined],
    ['Who receives your answers', notice.recipients],
    ['How long we keep them', notice.retention],
    ['Your rights and who to contact', notice.rights],
  ];
  return (
    <dl className="text-copy-13 flex flex-col gap-2">
      {rows
        .filter(([, v]) => v && v.trim())
        .map(([k, v]) => (
          <div key={k}>
            <dt className="text-label-13 font-semibold">{k}</dt>
            <dd className="text-muted-foreground whitespace-pre-line">{v}</dd>
          </div>
        ))}
      {notice.url ? (
        <div>
          <dt className="sr-only">Full privacy notice</dt>
          <dd>
            <a
              href={notice.url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-blue-900 underline underline-offset-2"
            >
              Read the full privacy notice
            </a>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

export function PublicFormView(props: {
  token: string;
  started: string;
  title: string;
  description: string;
  nameLabel: string;
  confirmation: string;
  controller: string;
  notice: PrivacyNotice;
  consent: boolean;
  sheet: { id: string; name: string; itemLabel: string; idPrefix: string };
  timeZone: string;
  fields: Field[];
  layout: FormLayout;
}) {
  const consentId = useId();
  const ctx = useMemo(
    () =>
      formCtx({
        sheet: { ...props.sheet, orgId: '', isLibrary: false },
        fields: props.fields,
        timeZone: props.timeZone,
        now: new Date(),
        newId,
      }),
    [props.sheet, props.fields, props.timeZone],
  );
  const questions = useMemo(
    () => formQuestions(props.layout, props.fields),
    [props.layout, props.fields],
  );
  const [name, setName] = useState('');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [website, setWebsite] = useState('');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ displayId: string | null } | null>(null);

  // the thank-you page never repeats the answers
  if (sent)
    return (
      <section
        role="status"
        className="border-line bg-background-100 flex flex-col items-start gap-3 rounded-xl border p-6"
      >
        <CheckCircle2 className="text-good size-6" aria-hidden />
        <h1 className="text-heading-24">Thank you. Your answers were sent.</h1>
        {props.confirmation ? (
          <p className="text-copy-14 whitespace-pre-line">{props.confirmation}</p>
        ) : null}
        {sent.displayId ? (
          <p className="text-copy-13">
            Reference <span className="font-mono">{sent.displayId}</span>
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSent(null);
            setName('');
            setAnswers({});
            setConsent(false);
          }}
        >
          Send another answer
        </Button>
      </section>
    );

  const hasNotice = !!(props.notice.purpose || props.notice.rights);
  return (
    <form
      noValidate
      className="border-line bg-background-100 flex flex-col gap-5 rounded-xl border p-6 sm:p-7"
      onSubmit={async (e) => {
        e.preventDefault();
        setMessage(null);
        const check = checkFormAnswers(questions, name, answers, ctx, props.nameLabel);
        const errs = { ...check.errors };
        if (props.consent && !consent) errs.__consent = 'Tick the box to send your answers.';
        setErrors(errs);
        if (Object.keys(errs).length > 0) {
          setMessage('Check the highlighted answers.');
          return;
        }
        setSending(true);
        try {
          const r = await submitPublicFormAction({
            token: props.token,
            started: props.started,
            name,
            answers,
            website,
            consent,
          });
          if (r.ok) setSent(r.data);
          else {
            setErrors(r.error.fieldErrors ?? {});
            setMessage(r.error.message);
          }
        } catch {
          setMessage('Your answers were not sent. Check your connection and try again.');
        } finally {
          setSending(false);
        }
      }}
    >
      <header className="border-line -mx-6 -mt-6 flex flex-col gap-1.5 border-b px-6 pt-6 pb-5 sm:-mx-7 sm:-mt-7 sm:px-7 sm:pt-7">
        <h1 className="text-heading-24">{props.title}</h1>
        {props.description ? (
          <p className="text-muted-foreground text-copy-13 whitespace-pre-line">
            {props.description}
          </p>
        ) : null}
      </header>
      <FormFill
        questions={questions}
        ctx={ctx}
        nameLabel={props.nameLabel}
        name={name}
        onName={setName}
        answers={answers}
        onAnswer={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))}
        errors={errors}
        disabled={sending}
      />
      {hasNotice ? (
        <details className="border-line rounded-md border p-3">
          <summary className="text-label-14 focus-visible:outline-focus cursor-pointer font-medium focus-visible:outline-2">
            How we use your answers
          </summary>
          <div className="mt-3">
            <NoticeText notice={props.notice} controller={props.controller} />
          </div>
        </details>
      ) : null}
      {props.consent ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={consentId} className="text-copy-14 flex items-start gap-2">
            <input
              id={consentId}
              type="checkbox"
              className="mt-1"
              checked={consent}
              aria-invalid={!!errors.__consent}
              aria-describedby={errors.__consent ? `${consentId}-e` : undefined}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I agree that my answers are used as described in how we use your answers.
          </label>
          {errors.__consent ? (
            <p id={`${consentId}-e`} className="text-crit text-label-13">
              {errors.__consent}
            </p>
          ) : null}
        </div>
      ) : null}
      {/* honeypot: hidden from people and screen readers; bots fill every field */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>
      {message ? (
        <p role="alert" className="text-crit text-copy-13">
          {message}
        </p>
      ) : null}
      <div className="flex">
        <Button type="submit" disabled={sending} className="h-10 flex-1 sm:flex-none sm:px-6">
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </form>
  );
}
