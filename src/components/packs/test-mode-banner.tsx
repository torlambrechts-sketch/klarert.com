'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FlaskConical } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { setPackAutomationsModeAction } from '@/app/[org]/settings/actions';

// Test mode (docs/04 §14, docs/11 Pack quality bar): a pack's automations that notify people or send anything out
// install in test mode. Owners and admins see one banner per pack on Home and on Workspace admin › Packs until they
// review the run log and turn them on, one by one on the Automations page or all at once here.

export function TestModeBanner({
  org,
  installId,
  title,
  count,
}: {
  org: string;
  installId: string;
  title: string;
  count: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (done || count === 0) return null;
  const what = count === 1 ? '1 automation' : `${count} automations`;
  const turnOn = async () => {
    setBusy(true);
    const r = await setPackAutomationsModeAction({ org, installId, mode: 'live' });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    setDone(true);
    toast.success(
      `Turned on ${r.data.changed === 1 ? '1 automation' : `${r.data.changed} automations`} from ${title}.`,
    );
    router.refresh();
  };
  return (
    <section
      aria-labelledby={`test-mode-${installId}`}
      data-testid="test-mode-banner"
      className="border-warn/40 bg-warn-soft flex flex-col gap-3 rounded-lg border px-5 py-4 sm:flex-row sm:items-center"
    >
      <FlaskConical className="text-warn size-5 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 id={`test-mode-${installId}`} className="text-label-14 m-0 font-medium">
          {what} from {title} {count === 1 ? 'is' : 'are'} in test mode. Review and turn them on.
        </h2>
        <p className="text-copy-13 text-muted-foreground m-0">
          In test mode an automation runs and writes the run log, but notifies nobody and changes
          nothing.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/${org}/automations?tab=runs`}>Review the run log</Link>
        </Button>
        {/* a long pack title wraps instead of widening the page at 390 px */}
        <Button
          type="button"
          size="sm"
          className="h-auto min-h-8 max-w-full py-1.5 text-left whitespace-normal"
          disabled={busy}
          onClick={() => void turnOn()}
        >
          Turn on all automations from {title}
        </Button>
      </div>
    </section>
  );
}
