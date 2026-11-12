'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import '@/engine/fields/registry';
import type { Field } from '@/engine/types';
import type { FormLayout } from '@/engine/views/config';
import { checkFormAnswers, formCtx, formQuestions } from '@/engine/views/form';
import { FormFill } from '@/components/views/form-fill';
import { Button } from '@/components/ui/button';
import { submitPublicFormAction } from './actions';

const newId = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}`;

export function PublicFormView(props: {
  token: string;
  title: string;
  description: string;
  nameLabel: string;
  sheet: { id: string; name: string; itemLabel: string; idPrefix: string };
  timeZone: string;
  fields: Field[];
  layout: FormLayout;
}) {
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ displayId: string | null } | null>(null);

  if (sent)
    return (
      <section
        role="status"
        className="border-line bg-background-100 flex flex-col items-start gap-3 rounded-xl border p-6"
      >
        <CheckCircle2 className="text-good size-6" aria-hidden />
        <h1 className="text-heading-24">Thank you. Your answers were sent.</h1>
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
          }}
        >
          Send another answer
        </Button>
      </section>
    );

  return (
    <form
      noValidate
      className="border-line bg-background-100 flex flex-col gap-5 rounded-xl border p-6 sm:p-7"
      onSubmit={async (e) => {
        e.preventDefault();
        setMessage(null);
        const check = checkFormAnswers(questions, name, answers, ctx, props.nameLabel);
        setErrors(check.errors);
        if (Object.keys(check.errors).length > 0) {
          setMessage('Check the highlighted answers.');
          return;
        }
        setSending(true);
        try {
          const r = await submitPublicFormAction({ token: props.token, name, answers, website });
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
