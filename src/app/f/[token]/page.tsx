import type { Metadata } from 'next';
import { loadPublicForm } from '@/server/commands/forms';
import { PublicFormView } from './public-form';

// Public form (docs/05 §1: no login, no app chrome). The token is the only key; a disabled or unknown token shows a
// plain notice.

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const form = await loadPublicForm((await params).token);
  return {
    title: form ? `${form.title} · Compliance OS` : 'Form not available',
    robots: 'noindex',
  };
}

export default async function PublicFormPage({ params }: { params: Promise<{ token: string }> }) {
  const form = await loadPublicForm((await params).token);
  return (
    <main className="bg-subtle min-h-dvh px-4 py-8 sm:py-12">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-5">
        {form ? (
          <PublicFormView
            token={form.token}
            title={form.title}
            description={form.description}
            nameLabel={form.nameLabel}
            sheet={form.sheet}
            timeZone={form.timeZone}
            fields={form.fields}
            layout={form.layout}
          />
        ) : (
          <section className="border-line rounded-xl border bg-white p-6 shadow-xs">
            <h1 className="text-[22px]">This form is not available</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              The link was turned off or is not complete. Ask the person who sent it for a new one.
            </p>
          </section>
        )}
        <p className="text-muted-foreground text-center text-xs">Compliance OS</p>
      </div>
    </main>
  );
}
