'use client';

// The last resort (docs/05 §7): the root layout itself failed, so this renders its own document. Plain HTML only.
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
          color: '#111',
          background: '#fff',
        }}
      >
        <main role="alert" style={{ maxWidth: 520 }}>
          <h1 style={{ fontSize: 22 }}>Compliance OS could not be loaded</h1>
          <p>Something went wrong on our side or the connection dropped. Try again.</p>
          {error.digest ? (
            <p style={{ fontFamily: 'monospace', fontSize: 12 }}>Reference {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: '#16181D',
              color: '#fff',
              border: 0,
              borderRadius: 8,
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
