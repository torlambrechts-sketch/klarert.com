'use client';

import { WifiOff } from 'lucide-react';
import { useOnline } from './use-online';

/**
 * The offline banner (docs/05 §7) on every page: fixed at the top so it does not move the page, announced politely,
 * and gone as soon as the browser is back online.
 */
export function OfflineBanner() {
  const online = useOnline();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex justify-center px-4"
    >
      {online ? null : (
        <p
          role="status"
          data-testid="offline-banner"
          className="border-warn/40 text-warn bg-warn-soft text-13 shadow-tooltip pointer-events-auto m-0 flex items-center gap-2 rounded-lg border px-3 py-2 font-semibold"
        >
          <WifiOff className="size-4" aria-hidden />
          You are offline. Changes will fail until you reconnect.
        </p>
      )}
    </div>
  );
}
