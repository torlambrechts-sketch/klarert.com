'use client';

import { Toaster as Sonner, type ToasterProps } from 'sonner';

// docs/05 §7, docs/18 §5: a navy pill at the bottom centre, white 500 words, max 720 px, 4 s
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-center"
      duration={4000}
      toastOptions={{
        style: {
          background: 'var(--navy)',
          color: 'var(--surface)',
          border: 'none',
          borderRadius: 'var(--radius-pill)',
          fontWeight: 500,
          maxWidth: 'min(720px, 92vw)',
        },
      }}
      {...props}
    />
  );
}
