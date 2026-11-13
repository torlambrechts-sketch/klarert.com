'use client';

import { ErrorState } from '@/components/states/error-state';

// Error boundary of this route segment (docs/05 §7): Retry renders it again.
export default function SegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} reset={reset} title="Audit outputs could not be loaded" />;
}
