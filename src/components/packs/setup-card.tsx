'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, X } from 'lucide-react';
import { Card } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import type { SetupProgress } from '@/engine/packs/setup';
import { SetupSummary } from './setup-checklist';

// Home (docs/05 §4, docs/11 Setup): a pack's setup checklist as a card with the next step, until every step is done
// or the person dismisses it. Dismissing is a per-viewer convenience kept in this browser; the checklist stays on
// Workspace admin › Packs.

const key = (installId: string) => `klarert.setup-dismissed.${installId}`;

function readDismissed(installId: string): boolean {
  try {
    return window.localStorage.getItem(key(installId)) === '1';
  } catch {
    return false;
  }
}

export function SetupCard({
  org,
  installId,
  progress,
  levelName,
}: {
  org: string;
  installId: string;
  progress: SetupProgress;
  levelName: string | null;
}) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => setDismissed(readDismissed(installId)), [installId]);
  if (dismissed || progress.done === progress.total) return null;
  const next = progress.steps.find((s) => !s.done);
  const headingId = `setup-${installId}`;
  return (
    <div className="relative" data-testid="setup-card">
      <Card
        headingId={headingId}
        title={progress.title}
        description={`${levelName ? `${levelName}. ` : ''}${progress.description}`}
        footer={
          <>
            <span>Progress comes from your sheets.</span>
            <Link
              href={`/${org}/settings?tab=packs#setup-${installId}`}
              className="text-ink text-label-13 font-medium underline-offset-4 hover:underline"
            >
              See all {progress.total} steps
            </Link>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <SetupSummary progress={progress} />
          {next ? (
            <div className="flex flex-col gap-1">
              <span className="text-label-13 text-muted-foreground">
                Next: step {next.number} of {progress.total}
              </span>
              <span className="text-label-14 font-medium">{next.title}</span>
              <p className="text-copy-13 text-muted-foreground m-0">{next.body}</p>
              {next.link ? (
                <Link
                  href={`/${org}/s/${next.link.sheetId}${next.link.viewId ? `?view=${next.link.viewId}` : ''}`}
                  className="text-ink text-label-13 inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
                >
                  Open {next.link.sheetName}
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-3 right-3"
        aria-label={`Dismiss ${progress.title}`}
        onClick={() => {
          try {
            window.localStorage.setItem(key(installId), '1');
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
