'use client';

// The last resort (docs/05 §7): the root layout itself failed, so this renders its own document. Plain HTML only:
// globals.css is not loaded here, so the Geist values (gray-1000 ink, white, 6 px control radius) are written inline.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          padding: 32,
          color: '#171717',
          background: '#fff',
        }}
      >
        <main role="alert" style={{ maxWidth: 520 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.96px' }}>
            Compliance OS could not be loaded
          </h1>
          <p>Something went wrong on our side or the connection dropped. Try again.</p>
          {error.digest ? (
            <p style={{ fontFamily: 'monospace', fontSize: 12 }}>Reference {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: '#171717',
              color: '#fff',
              border: 0,
              borderRadius: 6,
              padding: '8px 16px',
            }}
          >
            Retry
          </button>
        </main>
      </body>
    </html>
  );
}
