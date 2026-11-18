'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { seedDashboardAction } from '@/app/[org]/dashboards/actions';
import { Button } from '@/components/ui/button';

// The first open of Dashboards in a workspace without one (docs/05 §4): an editor's visit makes "Compliance overview"
// from the workspace's sheets through the seedDashboard command, then opens it. Viewers see an empty state.
export function FirstDashboard({ org, canEdit }: { org: string; canEdit: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const seed = useCallback(async () => {
    setError(null);
    try {
      const r = await seedDashboardAction({ org });
      if (!r.ok) return setError(r.error.message);
      router.replace(`/${org}/dashboards/${r.data.dashboard.id}`);
    } catch {
      setError('The dashboard could not be set up. Check your connection and try again.');
    }
  }, [org, router]);
  useEffect(() => {
    if (!canEdit || started.current) return;
    started.current = true;
    void seed();
  }, [canEdit, seed]);

  if (!canEdit)
    return (
      <div className="border-line bg-surface flex flex-col items-start gap-2 rounded-lg border border-dashed p-6">
        <p className="text-muted-foreground m-0">
          No dashboards yet. An editor can set one up by opening this page.
        </p>
      </div>
    );
  if (error)
    return (
      <div
        role="alert"
        className="border-line bg-surface flex flex-col items-start gap-2 rounded-lg border p-5"
      >
        <p className="m-0">{error}</p>
        <Button type="button" variant="outline" onClick={() => void seed()}>
          Retry
        </Button>
      </div>
    );
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <p className="text-muted-foreground text-14 m-0" role="status">
        Setting up your first dashboard from your sheets…
      </p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-soft h-[200px] animate-pulse rounded-lg" />
        ))}
      </div>
    </div>
  );
}
