'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { saveFormAction } from '@/app/[org]/s/view-actions';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { FillForm } from '@/components/views/form-builder';
import { sheetCtx, type SheetData } from '@/engine/sheet-data';
import type { FormLayout } from '@/engine/views/config';
import { formState } from '@/engine/views/form';

// An app's form screen (docs/13): the sheet's form, filled in as on the Forms tab (submitInternalForm: validated,
// logged as the person, automations run). A pack installs its forms as drafts; owners and admins open this one here.

export function AppForm({
  org,
  title,
  description,
  data,
  viewId,
  viewName,
  form,
  canSend,
  isAdmin,
  timeZone,
  userId,
  next,
}: {
  org: string;
  title: string;
  description?: string;
  data: SheetData;
  viewId: string;
  viewName: string;
  form: FormLayout;
  canSend: boolean;
  isAdmin: boolean;
  timeZone: string;
  userId: string;
  /** Where to look after sending (the app's first item screen). */
  next: { href: string; label: string } | null;
}) {
  const router = useRouter();
  const [opening, startOpening] = useTransition();
  const [sent, setSent] = useState<string | null>(null);
  const ctx = useMemo(
    () =>
      sheetCtx(data, {
        now: new Date(),
        timeZone,
        userId,
        isAdmin,
        newId: (p) => `${p}${Math.random().toString(36).slice(2, 8)}`,
      }),
    [data, timeZone, userId, isAdmin],
  );
  const state = formState(form, ctx.now, 0);
  const open = () =>
    startOpening(async () => {
      const r = await saveFormAction({ org, viewId, form: { ...form, status: 'open' } });
      if (!r.ok) return void toast.error(r.error.message);
      toast('Form opened. It takes answers now.');
      router.refresh();
    });

  return (
    <main className="flex w-full flex-col gap-4 px-4 pt-5 pb-8 sm:px-[28px]">
      <PageHeader title={title} description={description} />
      <div className="border-line bg-background-100 w-full max-w-[560px] rounded-lg border p-5">
        {sent ? (
          <div role="status" className="flex flex-col items-start gap-3">
            <p className="text-copy-14 m-0 flex items-center gap-2">
              <CheckCircle2 className="text-good size-4" aria-hidden />
              Sent. {sent} was added.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setSent(null)}>
                Report another
              </Button>
              {next ? (
                <Button asChild variant="outline">
                  <Link href={next.href}>Go to {next.label}</Link>
                </Button>
              ) : null}
            </div>
          </div>
        ) : canSend && state === 'open' ? (
          <FillForm
            org={org}
            viewId={viewId}
            ctx={ctx}
            form={form}
            fields={data.fields}
            title={form.title?.trim() || viewName}
            nameLabel={form.nameLabel?.trim() || data.sheet.itemLabel}
            canSend
            onSent={(displayId) => {
              setSent(displayId);
              router.refresh();
            }}
          />
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-copy-14 text-muted-foreground m-0">
              {!canSend
                ? 'You can read this app, but you cannot send this form. Ask an editor or admin.'
                : state === 'draft'
                  ? isAdmin
                    ? 'This form is a draft. Open it so people can report through the app.'
                    : 'This form is a draft. It takes answers once an owner or admin opens it.'
                  : 'This form does not take answers right now.'}
            </p>
            {canSend && state === 'draft' && isAdmin ? (
              <Button type="button" onClick={open} disabled={opening}>
                {opening ? 'Opening…' : 'Open the form'}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
