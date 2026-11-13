'use client';

import { useEffect, useState } from 'react';
import { Copy, Download, Link2, Link2Off, Printer, RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { changeFormLinkAction } from '@/app/[org]/s/view-actions';
import type { FormAccess } from '@/engine/views/config';
import { inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { env } from '@/lib/env';
import { cn } from '@/lib/utils';

// Share a form (docs/05 §3.3): its link, copy, regenerate (the old link stops working at once) and disable; a QR code
// to download as PNG or SVG and a print-friendly poster. Internal forms share the in-app link (people sign in).
// No embed in v1.

export type FormLinkRow = { id: string; token: string; enabled: boolean };

const appUrl = () => env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
export const publicUrl = (token: string) => `${appUrl()}/f/${token}`;
export const internalUrl = (org: string, sheetId: string, viewId: string) =>
  `${appUrl()}/${org}/s/${sheetId}?view=form&form=${viewId}`;

export async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast.error('The link could not be copied. Select it and copy it yourself.');
  }
}

function download(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.rel = 'noreferrer';
  a.click();
}

const fileName = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'form';

export function FormShareDialog({
  open,
  onClose,
  org,
  sheetId,
  viewId,
  title,
  access,
  link,
  canEdit,
  onLink,
}: {
  open: boolean;
  onClose(): void;
  org: string;
  sheetId: string;
  viewId: string;
  title: string;
  access: FormAccess;
  link: FormLinkRow | null;
  canEdit: boolean;
  onLink(link: FormLinkRow | null): void;
}) {
  const url =
    access === 'internal' ? internalUrl(org, sheetId, viewId) : link ? publicUrl(link.token) : null;
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'regenerate' | 'disable' | null>(null);
  useEffect(() => {
    if (!url) return setQr(null);
    let alive = true;
    QRCode.toDataURL(url, { margin: 1, width: 192 })
      .then((d) => alive && setQr(d))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [url]);

  const run = async (op: 'create' | 'regenerate' | 'disable') => {
    setBusy(true);
    const r = await changeFormLinkAction({ org, viewId, op });
    setBusy(false);
    setConfirm(null);
    if (!r.ok) return void toast.error(r.error.message);
    onLink(r.data.link);
    toast(
      op === 'create'
        ? 'Public link created.'
        : op === 'regenerate'
          ? 'New link made. The old link no longer works.'
          : 'Link disabled. It no longer opens the form.',
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] w-[min(560px,calc(100vw-32px))] overflow-y-auto">
        <DialogTitle className="text-heading-20">Share {title}</DialogTitle>
        <DialogDescription className="text-copy-13 text-muted-foreground">
          {access === 'internal'
            ? 'Internal form: people sign in to fill it in. Editors can send answers.'
            : 'Public form: anyone with the link can send it without signing in. At most 10 answers a minute from one visitor and 100 an hour through the link.'}
        </DialogDescription>
        <section aria-labelledby="share-link-h" className="flex flex-col gap-2">
          <h3 id="share-link-h" className="text-label-14 font-semibold">
            Link
          </h3>
          {url ? (
            <>
              <input
                aria-label={access === 'internal' ? 'Form link' : 'Public link'}
                readOnly
                className={cn(inputClass, 'text-label-12-mono h-9')}
                value={url}
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void copyText(url, 'Link copied.')}
                >
                  <Copy aria-hidden /> Copy link
                </Button>
                {access === 'public' && canEdit ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setConfirm('regenerate')}
                    >
                      <RefreshCw aria-hidden /> Regenerate link
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setConfirm('disable')}
                    >
                      <Link2Off aria-hidden /> Disable link
                    </Button>
                  </>
                ) : null}
              </div>
              {confirm ? (
                <div
                  role="alert"
                  className="border-warn/40 bg-warn-soft text-copy-13 flex flex-col gap-2 rounded-md border p-3"
                >
                  <p>
                    {confirm === 'regenerate'
                      ? 'The current link and QR code stop working at once, also on printed posters. Make a new link?'
                      : 'The link stops working at once. People who open it see that the form is not available.'}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={confirm === 'disable' ? 'destructive' : 'default'}
                      disabled={busy}
                      onClick={() => void run(confirm)}
                    >
                      {confirm === 'regenerate' ? 'Make a new link' : 'Disable link'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirm(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : canEdit ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-copy-13 text-muted-foreground">
                No link yet. Create one to share the form.
              </p>
              <Button type="button" disabled={busy} onClick={() => void run('create')}>
                <Link2 aria-hidden /> Create public link
              </Button>
            </div>
          ) : (
            <p className="text-copy-13 text-muted-foreground">
              No link. Ask an owner or admin to create one.
            </p>
          )}
        </section>
        {url ? (
          <section aria-labelledby="share-qr-h" className="flex flex-col gap-2">
            <h3 id="share-qr-h" className="text-label-14 font-semibold">
              QR code
            </h3>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qr}
                  width={192}
                  height={192}
                  alt={`QR code of the link to ${title}`}
                  className="border-line rounded border"
                />
              ) : (
                <div className="bg-soft size-48 rounded" aria-hidden />
              )}
              <div className="flex flex-wrap gap-2 sm:flex-col">
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () =>
                    download(
                      await QRCode.toDataURL(url, { margin: 2, width: 1024 }),
                      `${fileName(title)}-qr.png`,
                    )
                  }
                >
                  <Download aria-hidden /> Download PNG
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const svg = await QRCode.toString(url, { type: 'svg', margin: 2 });
                    const href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
                    download(href, `${fileName(title)}-qr.svg`);
                    setTimeout(() => URL.revokeObjectURL(href), 1000);
                  }}
                >
                  <Download aria-hidden /> Download SVG
                </Button>
                <Button asChild variant="outline">
                  <a href={`/poster/${viewId}`} target="_blank" rel="noreferrer">
                    <Printer aria-hidden /> Print poster
                  </a>
                </Button>
              </div>
            </div>
          </section>
        ) : null}
        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
