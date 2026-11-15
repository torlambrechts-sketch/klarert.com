'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, X } from 'lucide-react';
import { Card } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import type { NextStep } from '@/engine/home';

// Home's first run (docs/05 §4, docs/11 Setup, owner decision 15 Nov 2026): one "Next step" card per installed
// standard, the first step of its setup that is not done. The engine picks the step and writes the words
// (engine/home.ts nextSteps); this card only shows them. Dismissing is a per-viewer convenience kept in this browser;
// the whole checklist stays on Workspace admin › Packs.

const key = (installId: string) => `klarert.setup-dismissed.${installId}`;

function readDismissed(installId: string): boolean {
  try {
    return window.localStorage.getItem(key(installId)) === '1';
  } catch {
    return false;
  }
}

const textLink =
  'text-ink text-label-13 inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline';

export function NextStepCard({ org, next }: { org: string; next: NextStep }) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => setDismissed(readDismissed(next.installId)), [next.installId]);
  if (dismissed) return null;
  const headingId = `next-step-${next.installId}`;
  const { step } = next;
  return (
    <div className="relative" data-testid="next-step-card">
      <Card
        headingId={headingId}
        title={
          <>
            <span className="text-muted-foreground text-label-13 block font-medium">Next step</span>
            {next.standard}
          </>
        }
        footer={
          <>
            <span>Progress comes from your sheets.</span>
            <Link href={`/${org}/settings?tab=packs#setup-${next.installId}`} className={textLink}>
              See all {next.total} steps
            </Link>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-label-13 text-muted-foreground tabular-nums">
              {next.line}
              {next.level ? ` · ${next.level}` : ''}
            </span>
            <div
              role="progressbar"
              aria-label={`${next.standard}: ${next.percent}% done`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={next.percent}
              className="bg-soft h-1.5 w-full overflow-hidden rounded"
            >
              <div className="bg-ink h-full rounded" style={{ width: `${next.percent}%` }} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-label-14 font-medium">{step.title}</span>
            <p className="text-copy-13 text-muted-foreground m-0">{step.body}</p>
            {step.link ? (
              <Link
                href={`/${org}/s/${step.link.sheetId}${step.link.viewId ? `?view=${step.link.viewId}` : ''}`}
                className={textLink}
              >
                Open {step.link.sheetName}
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            ) : null}
          </div>
        </div>
      </Card>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-3 right-3"
        aria-label={`Dismiss the next step for ${next.standard}`}
        onClick={() => {
          try {
            window.localStorage.setItem(key(next.installId), '1');
          } catch {
            // not kept: it shows again next time
          }
          setDismissed(true);
        }}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}
