'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Plus, RotateCcw } from 'lucide-react';
import { createManagementReviewAction } from '@/app/[org]/audit/actions';
import { Button } from '@/components/ui/button';

// Adds a Management review item with the compiled inputs (docs/11 Audit outputs). Editors only; the page shows it
// only when the workspace has the pack's management review sheet.

type State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; href: string; displayId: string };

export function CreateReviewButton({
  org,
  from,
  to,
  sheetName,
}: {
  org: string;
  from: string;
  to: string;
  sheetName: string;
}) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const run = async () => {
    setState({ kind: 'busy' });
    try {
      const r = await createManagementReviewAction({ org, from, to });
      if (!r.ok) return setState({ kind: 'error', message: r.error.message });
      setState({
        kind: 'done',
        displayId: r.data.displayId,
        href: `/${org}/s/${r.data.sheetId}?item=${encodeURIComponent(r.data.displayId)}`,
      });
    } catch {
      setState({ kind: 'error', message: 'The review could not be added. Try again.' });
    }
  };
  if (state.kind === 'done')
    return (
      <p role="status" className="text-copy-14 m-0 flex flex-wrap items-center gap-1.5">
        <Check className="text-good size-4" aria-hidden /> Added {state.displayId} to {sheetName}{' '}
        with these inputs.
        <Link href={state.href} className="text-ink font-medium underline underline-offset-4">
          Open it
        </Link>
      </p>
    );
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        onClick={() => void run()}
        disabled={state.kind === 'busy'}
        data-testid="create-review"
      >
        {state.kind === 'busy' ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : state.kind === 'error' ? (
          <RotateCcw aria-hidden />
        ) : (
          <Plus aria-hidden />
        )}
        {state.kind === 'error' ? 'Try again' : `Add to ${sheetName}`}
      </Button>
      {state.kind === 'error' ? (
        <p role="alert" className="text-crit-ink text-label-13 m-0">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
