import type { Metadata } from 'next';
import QRCode from 'qrcode';
import { parseViewConfig } from '@/engine/views/config';
import { formAccess } from '@/engine/views/form';
import { env } from '@/lib/env';
import { requireProfile } from '@/server/auth';
import { PrintButton } from './print-button';

// A print-friendly poster of a form's QR code (docs/05 §3.3 Share). Signed in; RLS decides which forms are readable.

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Form poster', robots: { index: false } };

export default async function PosterPage({ params }: { params: Promise<{ viewId: string }> }) {
  const { viewId } = await params;
  const { supabase } = await requireProfile(`/poster/${viewId}`);
  const ok = /^[0-9a-f-]{36}$/.test(viewId);
  const { data: view } = ok
    ? await supabase
        .from('views')
        .select('id, name, config, sheet_id, org_id, orgs!inner(slug)')
        .eq('id', viewId)
        .eq('type', 'form')
        .maybeSingle()
    : { data: null };
  const form = view ? parseViewConfig(view.config).form : undefined;
  let url: string | null = null;
  if (view && form) {
    const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
    if (formAccess(form) === 'internal') {
      url = `${base}/${view.orgs.slug}/s/${view.sheet_id}?view=form&form=${view.id}`;
    } else {
      const { data: link } = await supabase
        .from('form_links')
        .select('token')
        .eq('view_id', view.id)
        .eq('enabled', true)
        .limit(1);
      url = link?.[0] ? `${base}/f/${link[0].token}` : null;
    }
  }
  const title = form?.title?.trim() || view?.name || 'Form';
  const svg = url ? await QRCode.toString(url, { type: 'svg', margin: 1 }) : null;
  return (
    <main className="bg-background-100 mx-auto flex min-h-dvh max-w-[720px] flex-col items-center gap-6 px-4 py-10 text-center print:py-0">
      {view && url && svg ? (
        <>
          <h1 className="text-heading-40">{title}</h1>
          {form?.description ? (
            <p className="text-copy-18 text-muted-foreground whitespace-pre-line">
              {form.description}
            </p>
          ) : null}
          <div
            role="img"
            aria-label={`QR code of the link to ${title}`}
            className="w-full max-w-[420px] [&_svg]:h-auto [&_svg]:w-full"
            // the SVG is made here by the qrcode library from our own URL
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <p className="text-copy-20 font-semibold">Scan the code to fill in the form</p>
          <p className="text-label-14-mono text-muted-foreground break-all">{url}</p>
          <PrintButton />
        </>
      ) : (
        <section className="border-line rounded-xl border p-6">
          <h1 className="text-heading-24">No poster for this form</h1>
          <p className="text-copy-13 text-muted-foreground mt-2">
            The form has no live link, or it no longer exists. Create a link in Share first.
          </p>
        </section>
      )}
    </main>
  );
}
