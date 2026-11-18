'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { testModeLine } from '@/engine/home';
import { setPackAutomationsModeAction } from '@/app/[org]/settings/actions';

// Test mode (docs/04 §14, docs/11 Pack quality bar): a pack's automations that notify people or send anything out
// install in test mode. Owners and admins see one banner on Home and on Workspace admin › Packs until they review the
// run log and turn them on, one by one on the Automations page or a pack at a time here. With several packs waiting,
// the banner names them all and keeps each pack's Turn on behind "Turn on by pack" (owner decision, Nov 2026: one
// banner, not one per pack). Home shows the short form (TestModeNotice, owner decision 15 Nov 2026): the total and one
// link to this banner on Workspace admin › Packs.

export interface TestModeBannerPack {
  installId: string;
  title: string;
  count: number;
}

const automations = (n: number) => (n === 1 ? '1 automation' : `${n} automations`);

export function TestModeBanner({ org, packs }: { org: string; packs: TestModeBannerPack[] }) {
  const router = useRouter();
  const ids = { heading: useId(), list: useId() };
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const waiting = packs.filter((p) => p.count > 0 && !done.includes(p.installId));
  if (waiting.length === 0) return null;
  const total = waiting.reduce((n, p) => n + p.count, 0);
  const one = waiting.length === 1 ? waiting[0]! : null;

  const turnOn = async (p: TestModeBannerPack) => {
    setBusy(p.installId);
    const r = await setPackAutomationsModeAction({ org, installId: p.installId, mode: 'live' });
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    setDone((d) => [...d, p.installId]);
    toast.success(`Turned on ${automations(r.data.changed)} from ${p.title}.`);
    router.refresh();
  };

  const turnOnButton = (p: TestModeBannerPack, className?: string) => (
    // a long pack title wraps instead of widening the page at 390 px
    <Button
      type="button"
      size="sm"
      className={cn('h-auto min-h-8 max-w-full py-1.5 text-left whitespace-normal', className)}
      disabled={busy !== null}
      onClick={() => void turnOn(p)}
    >
      Turn on all automations from {p.title}
    </Button>
  );

  return (
    <section
      id="test-mode"
      aria-labelledby={ids.heading}
      data-testid="test-mode-banner"
      className="border-warn/40 bg-warn-soft flex scroll-mt-16 flex-col gap-3 rounded-lg border px-5 py-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <FlaskConical className="text-warn size-5 shrink-0" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id={ids.heading} className="text-14 m-0 font-medium">
            {one
              ? `${automations(one.count)} from ${one.title} ${one.count === 1 ? 'is' : 'are'} in test mode.`
              : `${automations(total)} from ${waiting.length} packs are in test mode.`}{' '}
            Review and turn them on.
          </h2>
          <p className="text-13 text-muted-foreground m-0">
            In test mode an automation runs and writes the run log, but notifies nobody and changes
            nothing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/${org}/automations?tab=runs`}>Review the run log</Link>
          </Button>
          {one ? (
            turnOnButton(one)
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={open}
              aria-controls={ids.list}
              onClick={() => setOpen((o) => !o)}
            >
              Turn on by pack
              <ChevronDown
                aria-hidden
                className={cn('size-4 transition-transform', open && 'rotate-180')}
              />
            </Button>
          )}
        </div>
      </div>
      {one ? null : (
        <>
          <p className="text-13 m-0">
            <span className="font-medium">Still in test mode: </span>
            {waiting.map((p, i) => (
              <span key={p.installId}>
                {p.title}
                {i < waiting.length - 2 ? ', ' : i === waiting.length - 2 ? ' and ' : '.'}
              </span>
            ))}
          </p>
          <ul
            id={ids.list}
            hidden={!open}
            aria-label="Packs with automations in test mode"
            className={cn(
              'divide-warn/30 m-0 list-none flex-col divide-y p-0',
              open ? 'flex' : 'hidden',
            )}
          >
            {waiting.map((p) => (
              <li
                key={p.installId}
                className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="text-13 min-w-0">
                  {p.title} · {automations(p.count)}
                </span>
                {turnOnButton(p, 'self-start sm:self-auto')}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Home: one line for every automation waiting in test mode, and one link to turn them on (Workspace admin › Packs). */
export function TestModeNotice({ org, packs }: { org: string; packs: TestModeBannerPack[] }) {
  const headingId = useId();
  const line = testModeLine(packs);
  if (!line) return null;
  return (
    <section
      aria-labelledby={headingId}
      data-testid="test-mode-banner"
      className="border-warn/40 bg-warn-soft flex flex-col gap-3 rounded-lg border px-5 py-4 sm:flex-row sm:items-center"
    >
      <FlaskConical className="text-warn size-5 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 id={headingId} className="text-14 m-0 font-medium">
          {line}
        </h2>
        <p className="text-13 text-muted-foreground m-0">
          They run and write the run log, but notify nobody and change nothing until you turn them
          on.
        </p>
      </div>
      <Button asChild variant="outline" size="sm" className="self-start sm:self-auto">
        <Link href={`/${org}/settings?tab=packs#test-mode`}>Review and turn on</Link>
      </Button>
    </section>
  );
}
