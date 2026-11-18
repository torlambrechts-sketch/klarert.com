'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The error state of a page (docs/05 §7): what happened in plain words and a Retry that renders the segment again.
 * The error itself goes to the console (and the server logs); people see no stack traces.
 */
export function ErrorState({
  error,
  reset,
  title = 'This page could not be loaded',
  home,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  /** A way out when retrying does not help. */
  home?: { href: string; label: string };
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-start gap-3 px-4 py-12">
      <div role="alert" className="flex flex-col gap-2">
        <h1 className="text-panel-title">{title}</h1>
        <p className="text-muted-foreground m-0">
          Something went wrong on our side or the connection dropped. Your changes that were saved
          are safe. Try again.
        </p>
        {error.digest ? (
          <p className="text-muted-foreground text-12 m-0 font-mono">Reference {error.digest}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => reset()}>
          <RotateCcw aria-hidden /> Retry
        </Button>
        {home ? (
          <Button asChild variant="outline">
            <Link href={home.href}>{home.label}</Link>
          </Button>
        ) : null}
      </div>
    </main>
  );
}
