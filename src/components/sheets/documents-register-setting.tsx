'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { setDocumentsRegisterAction } from '@/app/[org]/s/panel-actions';
import { Switch } from '@/components/ui/switch';

// Sheet settings: "Documents register" (docs/02 §14). Owners and admins turn it on for a sheet of controlled
// documents: the status's done option becomes Approved, approval needs a second person and a version note, and items
// of other sheets show these documents' last approved version.

export function DocumentsRegisterSetting({
  org,
  sheetId,
  on,
  canChange,
}: {
  org: string;
  sheetId: string;
  on: boolean;
  canChange: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(on);
  const [busy, setBusy] = useState(false);
  const change = async (next: boolean) => {
    setBusy(true);
    setValue(next);
    const r = await setDocumentsRegisterAction({ org, sheetId, documents: next });
    setBusy(false);
    if (!r.ok) {
      setValue(!next);
      return toast.error(r.error.message);
    }
    toast(
      next ? 'This sheet is now a documents sheet.' : 'This sheet is no longer a documents sheet.',
    );
    router.refresh();
  };
  return (
    <div className="flex items-start gap-3">
      <Switch
        id="documents-register"
        checked={value}
        disabled={!canChange || busy}
        onCheckedChange={(v) => void change(v)}
        aria-describedby="documents-register-help"
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor="documents-register" className="text-14 font-medium">
          Documents sheet
        </label>
        <p id="documents-register-help" className="text-muted-foreground text-13 m-0">
          Items are controlled documents. Approved is the status&apos;s done option: approving needs
          a version note and a person other than the author, and leaving Approved needs a comment.
          Other sheets link to these documents and always get the last approved version.
          {canChange ? '' : ' Only owners and admins can change this.'}
        </p>
      </div>
    </div>
  );
}
