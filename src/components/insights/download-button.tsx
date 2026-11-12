'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { downloadFileAction } from '@/app/[org]/s/panel-actions';
import { Button } from '@/components/ui/button';

/** Download one file through the item panel's signed-URL command (a link valid for 60 seconds). */
export function DownloadButton({
  org,
  fileId,
  filename,
}: {
  org: string;
  fileId: string;
  filename: string;
}) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const r = await downloadFileAction({ org, fileId });
      if (!r.ok) return void toast.error(r.error.message);
      const a = document.createElement('a');
      a.href = r.data.url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast.error('The download link could not be made. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={`Download ${filename}`}
      title="Download"
      disabled={busy}
      onClick={download}
    >
      <Download aria-hidden />
    </Button>
  );
}
