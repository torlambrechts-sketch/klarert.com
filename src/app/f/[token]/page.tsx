import type { Metadata } from 'next';
import { formatDateTime } from '@/engine/fields/helpers';
import { loadPublicForm, startStamp, type UnavailableForm } from '@/server/commands/forms';
import { PublicFormView } from './public-form';

// Public form (docs/05 §1: no login, no app chrome). The token is the only key; a disabled or unknown token shows a
// plain notice, a form that does not take answers says why. Never indexed, no referrer (next.config.ts headers too).

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const form = await loadPublicForm((await params).token);
  return {
    title: form ? `${form.title} · Compliance OS` : 'Form not available',
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

const UNAVAILABLE: Record<UnavailableForm['state'], string> = {
  draft: 'This form is not open. Ask the person who sent it when it opens.',
  closed: 'This form is closed and no longer takes answers.',
  scheduled: 'This form is not open yet.',
  full: 'This form has all the answers it takes.',
  internal_only: 'This form is for members of the workspace. Sign in to fill it in.',
};

export default async function PublicFormPage({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const form = await loadPublicForm(token);
  return (
    <main className="bg-subtle min-h-dvh px-4 py-8 sm:py-12">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-5">
        {form?.state === 'open' ? (
          <PublicFormView
            token={form.token}
            started={startStamp(form.token)}
            title={form.title}
            description={form.description}
            nameLabel={form.nameLabel}
            confirmation={form.confirmation}
            controller={form.controller}
            notice={form.notice}
            consent={form.consent}
            sheet={form.sheet}
            timeZone={form.timeZone}
            fields={form.fields}
            layout={form.layout}
          />
        ) : form ? (
          <section className="border-line bg-background-100 rounded-xl border p-6">
            <h1 className="text-heading-24">{form.title}</h1>
            <p className="text-muted-foreground text-copy-13 mt-2">
              {UNAVAILABLE[form.state]}
              {form.state === 'scheduled' && form.opensAt
                ? ` It opens ${formatDateTime(form.opensAt, form.timeZone)}.`
                : ''}
            </p>
          </section>
        ) : (
          <section className="border-line bg-background-100 rounded-xl border p-6">
            <h1 className="text-heading-24">This form is not available</h1>
            <p className="text-muted-foreground text-copy-13 mt-2">
              The link was turned off or is not complete. Ask the person who sent it for a new one.
            </p>
          </section>
        )}
        <p className="text-muted-foreground text-label-12 text-center">Compliance OS</p>
      </div>
    </main>
  );
}
