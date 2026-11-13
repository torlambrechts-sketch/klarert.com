'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  archiveSheetNowAction,
  deleteFolderAction,
  restoreFolderAction,
} from '@/app/[org]/s/actions';
import { Button } from '@/components/ui/button';
import type { Result } from '@/server/result';

// Restore controls of Workspace admin, Archived (docs/05 §2.1). A folder comes back with the sheets archived with it.

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run<T>(action: () => Promise<Result<T>>, success: (d: T) => string) {
    start(async () => {
      let r: Result<T>;
      try {
        r = await action();
      } catch {
        toast.error('Something went wrong. Try again.');
        return;
      }
      if (!r.ok) {
        toast.error(r.error.message, {
          action: { label: 'Retry', onClick: () => run(action, success) },
        });
        return;
      }
      toast(success(r.data));
      router.refresh();
    });
  }
  return { pending, run };
}

export function RestoreFolder({
  org,
  folderId,
  name,
}: {
  org: string;
  folderId: string;
  name: string;
}) {
  const { pending, run } = useRun();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      aria-label={`Restore folder ${name}`}
      onClick={() =>
        run(
          () => restoreFolderAction({ org, folderId }),
          (d) =>
            d.sheets === 0
              ? `Restored ${name}.`
              : `Restored ${name} and ${d.sheets === 1 ? '1 sheet' : `${d.sheets} sheets`}.`,
        )
      }
    >
      {pending ? 'Restoring…' : 'Restore'}
    </Button>
  );
}

/** Only for an archived folder with no sheets left in it. */
export function DeleteFolder({
  org,
  folderId,
  name,
}: {
  org: string;
  folderId: string;
  name: string;
}) {
  const { pending, run } = useRun();
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Delete folder ${name}`}
        onClick={() => setConfirming(true)}
      >
        Delete
      </Button>
    );
  return (
    <span className="flex gap-1">
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() =>
          run(
            () => deleteFolderAction({ org, folderId }),
            () => `Deleted ${name}.`,
          )
        }
      >
        {pending ? 'Deleting…' : `Delete ${name}`}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  );
}

export function RestoreSheet({
  org,
  sheetId,
  name,
}: {
  org: string;
  sheetId: string;
  name: string;
}) {
  const { pending, run } = useRun();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      aria-label={`Restore sheet ${name}`}
      onClick={() =>
        run(
          () => archiveSheetNowAction({ org, sheetId, archived: 'false' }),
          () => `Restored ${name}.`,
        )
      }
    >
      {pending ? 'Restoring…' : 'Restore'}
    </Button>
  );
}
