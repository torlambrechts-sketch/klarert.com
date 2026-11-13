'use client';

import { ErrorState } from '@/components/states/error-state';

// Error boundary of an app's screens (docs/05 §7): Retry renders it again.
export default function SegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} reset={reset} title="This screen could not be loaded" />;
}
