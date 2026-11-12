'use client';

import { useSyncExternalStore } from 'react';

// navigator.onLine with its events (docs/05 §7). The server render and the first client render say "online", so the
// banner never flashes while the page hydrates.

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
