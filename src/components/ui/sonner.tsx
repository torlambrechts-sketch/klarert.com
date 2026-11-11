'use client';

import { Toaster as Sonner, type ToasterProps } from 'sonner';

// docs/05 §7: bottom centre, dark, 4 s
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-center"
      duration={4000}
      toastOptions={{ style: { background: 'var(--brand)', color: '#fff', border: 'none' } }}
      {...props}
    />
  );
}
