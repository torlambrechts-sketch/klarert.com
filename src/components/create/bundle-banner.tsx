'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Archive, ArrowRight, Check, Package, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDate, isoDateInZone } from '@/engine/fields/helpers';
import { markBundleReviewedAction } from '@/app/[org]/create-actions';
import { archivePackAction } from '@/app/[org]/settings/actions';
import type { SheetBundle } from '@/server/bundles/read';

// On every sheet of a set made with Create (docs/11 Bundles): "Created by <set>", the auditor's "Generated from
// template, not yet reviewed" until the named owner marks it reviewed (logged), and for owners and admins one action
// that archives the whole set (archive_pack: items and the activity log stay). Right after Create it also shows the
// one next action ("Add your first complaint").

export function BundleBanner({
  org,
  bundle,
  userId,
  isAdmin,
  timeZone,
  itemLabel,
  canAdd,
  onAdd,
}: {
  org: string;
  bundle: SheetBundle;
  userId: string;
  isAdmin: boolean;
  timeZone: string;
  itemLabel: string;
  canAdd: boolean;
  onAdd: () => void;
}) {
  const router = useRouter();
  const [fresh, setFresh] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('created') === '1') {
      setFresh(true);
      try {
        const message = sessionStorage.getItem('create.toast');
        sessionStorage.removeItem('create.toast');
        if (message) toast(message, { duration: 6000 });
      } catch {
        // storage blocked: the banner still says what is next
      }
      url.searchParams.delete('created');
      window.history.replaceState(window.history.state, '', url);
    }
  }, []);

  const markReviewed = async () => {
    setBusy(true);
    const r = await markBundleReviewedAction({ org, installId: bundle.installId });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error.message);
    toast(`${bundle.name} marked reviewed.`);
    router.refresh();
  };
  const archive = async () => {
    setBusy(true);
    const r = await archivePackAction({ org, installId: bundle.installId });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error.message);
    toast(
      `Archived ${bundle.name}. Items and the activity log are kept; restore sheets in Workspace admin.`,
    );
    router.push(`/${org}/home`);
  };

  const label = itemLabel.toLowerCase();
  return (
    <div className="mt-3 flex flex-col gap-2" data-testid="bundle-banner">
      {fresh && canAdd ? (
        <div className="border-focus bg-info-soft ring-focus flex flex-wrap items-center gap-3 rounded-lg border p-3 ring-1">
          <p className="text-copy-14 min-w-0 flex-1">
            <span className="font-medium">{bundle.name} is ready.</span> Next: add your first{' '}
            {label}.
          </p>
          <Button type="button" onClick={onAdd} data-testid="next-action" autoFocus>
            Add your first {label} <ArrowRight aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss"
            onClick={() => setFresh(false)}
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : null}
      <div className="text-label-13 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="bg-soft text-ink flex items-center gap-1.5 rounded-full px-2.5 py-1">
          <Package className="size-3.5" aria-hidden /> Created by {bundle.name}
        </span>
        {bundle.reviewedAt ? (
          <span className="bg-good-soft text-good flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium">
            <Check className="size-3.5" aria-hidden /> Reviewed by {bundle.reviewedBy} on{' '}
            {formatDate(isoDateInZone(bundle.reviewedAt, timeZone))}
          </span>
        ) : (
          <span
            className="bg-warn-soft text-warn flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium"
            data-testid="not-reviewed"
          >
            <TriangleAlert className="size-3.5" aria-hidden /> Generated from template, not yet
            reviewed
          </span>
        )}
        <span className="text-muted-foreground">
          Owner {bundle.ownerName}
          {bundle.reviewBy && !bundle.reviewedAt
            ? ` · review by ${formatDate(bundle.reviewBy)}`
            : ''}
          {` · from ${bundle.source}`}
        </span>
        <span className="flex-1" />
        {!bundle.reviewedAt && bundle.ownerId === userId ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void markReviewed()}
            disabled={busy}
          >
            <Check aria-hidden /> Mark reviewed
          </Button>
        ) : null}
        {isAdmin && !confirm ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(true)}>
            <Archive aria-hidden /> Archive the whole set
          </Button>
        ) : null}
      </div>
      {confirm ? (
        <div
          role="alertdialog"
          aria-label="Archive the whole set"
          className="border-line flex flex-wrap items-center gap-2 rounded-lg border p-3"
        >
          <p className="text-copy-13 min-w-0 flex-1">
            Archive {bundle.name}: {bundle.sheets} {bundle.sheets === 1 ? 'sheet' : 'sheets'}, its
            forms and dashboards; its automations are turned off. Items and the activity log are
            kept.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => void archive()}
            disabled={busy}
          >
            Archive set
          </Button>
        </div>
      ) : null}
    </div>
  );
}
