'use client';

import './globals.css';

// The last resort (docs/05 §7): the root layout itself failed, so this renders its own document. It loads globals.css
// itself, so the Geist tokens apply here too (board review UX-14: no hex colours); the Geist fonts are not loaded, so
// the system sans-serif stands in.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-surface text-ink p-8">
        <main role="alert" className="flex max-w-[520px] flex-col gap-3">
          <h1 className="text-kpi m-0">Compliance OS could not be loaded</h1>
          <p className="text-14 m-0">
            Something went wrong on our side or the connection dropped. Try again.
          </p>
          {error.digest ? (
            <p className="text-12 text-muted-foreground m-0 font-mono">Reference {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            className="bg-ink text-primary-foreground text-14 w-fit rounded-md px-4 py-2 font-medium"
          >
            Retry
          </button>
        </main>
      </body>
    </html>
  );
}
