'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRightCircle, Check, Flag, Loader2, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { EditionMovePreview, EditionMoveResult } from '@/server/commands/frameworks';
import type { Result } from '@/server/result';
import { moveToEditionAction, previewEditionMoveAction } from './actions';

// Workspace admin › Frameworks: "Move to the new edition" on an adopted library whose edition is replaced, once the
// new edition is adopted alongside (docs/12 Moving to a new edition). The preview lists what is copied through the
// edition mapping and what needs review; moving copies the answers, repeats the control links and makes the old
// library read-only. The plan comes from the server; nothing is worked out here.

type Step =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: EditionMovePreview }
  | { kind: 'moving'; data: EditionMovePreview }
  | { kind: 'failed'; data: EditionMovePreview; message: string }
  | { kind: 'done'; data: EditionMovePreview; result: EditionMoveResult };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Body({ data }: { data: EditionMovePreview }) {
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="What moving does" className="text-14 m-0 flex list-none flex-col gap-1 p-0">
        <li className="flex items-start gap-1.5">
          <Check className="text-good mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {plural(data.copies.length, 'requirement')} get the answers of the same requirement in{' '}
            {data.from.title}: applicability, justification, implementation status, owner and last
            reviewed. Answers already given in {data.to.title} are kept.
          </span>
        </li>
        <li className="flex items-start gap-1.5">
          <Check className="text-good mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{plural(data.links, 'control link')} repeated on the new requirements.</span>
        </li>
        <li className="flex items-start gap-1.5">
          <Check className="text-good mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {data.from.title} becomes read-only: {plural(data.locked, 'item')} locked, with a link
            to {data.to.title}. Its history stays.
          </span>
        </li>
        {data.evidenceStays.length ? (
          <li className="flex items-start gap-1.5">
            <Flag className="text-warn mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Evidence files stay on {plural(data.evidenceStays.length, 'requirement')} of{' '}
              {data.from.title} ({data.evidenceStays.slice(0, 8).join(', ')}
              {data.evidenceStays.length > 8 ? ' …' : ''}). Attach them again where they still
              apply.
            </span>
          </li>
        ) : null}
      </ul>
      {data.review.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-14 m-0 flex items-center gap-1.5 font-medium">
            <Flag className="text-warn size-4" aria-hidden /> To review in {data.to.title} ·{' '}
            {data.review.length}
          </p>
          <ul
            aria-label="Requirements to review"
            className="border-line divide-line text-13 m-0 flex max-h-64 list-none flex-col divide-y overflow-y-auto rounded-md border p-0"
          >
            {data.review.map((r) => (
              <li key={r.toRef} className="flex flex-col gap-0.5 px-3 py-2">
                <span>
                  <span className="text-12 font-mono">{r.toRef}</span>{' '}
                  <span className="font-medium">{r.name}</span>
                </span>
                <span className="text-muted-foreground">
                  {r.text}
                  {r.from.length ? ` Was ${r.from.join(', ')}.` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * "Move to the new edition" on an adopted, replaced library. Stays mounted when the library cannot move (any more):
 * the page refreshes with the library moved while the dialog still shows the result.
 */
export function MoveToEdition({
  org,
  fromSheetId,
  title,
  toTitle,
  canMove = true,
}: {
  org: string;
  fromSheetId: string;
  title: string;
  toTitle: string;
  canMove?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'loading' });

  async function load() {
    setStep({ kind: 'loading' });
    let r: Result<EditionMovePreview>;
    try {
      r = await previewEditionMoveAction({ org, fromSheetId });
    } catch {
      setStep({ kind: 'error', message: 'The preview could not be loaded. Try again.' });
      return;
    }
    setStep(r.ok ? { kind: 'ready', data: r.data } : { kind: 'error', message: r.error.message });
  }

  async function move(data: EditionMovePreview) {
    setStep({ kind: 'moving', data });
    let r: Result<EditionMoveResult>;
    try {
      r = await moveToEditionAction({ org, fromSheetId });
    } catch {
      setStep({ kind: 'failed', data, message: 'Moving did not finish. Nothing was changed.' });
      return;
    }
    if (!r.ok) {
      setStep({ kind: 'failed', data, message: r.error.message });
      return;
    }
    setStep({ kind: 'done', data, result: r.data });
    router.refresh();
  }

  const busy = step.kind === 'moving';
  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : setOpen(next))}>
      {canMove ? (
        <Button
          type="button"
          size="sm"
          aria-label={`Move ${title} to ${toTitle}`}
          onClick={() => {
            setOpen(true);
            void load();
          }}
        >
          <ArrowRightCircle aria-hidden /> Move to {toTitle}
        </Button>
      ) : null}
      <DialogContent className="flex max-h-[85vh] w-[min(640px,calc(100vw-32px))] flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col gap-1 pr-8">
          <DialogTitle className="text-panel-title">Move to {toTitle}</DialogTitle>
          <DialogDescription className="text-14 text-muted-foreground">
            Carries your work on {title} over to {toTitle} where the requirement is the same, and
            lists the rest for review.
          </DialogDescription>
        </div>

        {step.kind === 'loading' ? (
          <div aria-busy="true" aria-label="Loading the preview" className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-soft h-5 animate-pulse rounded" />
            ))}
          </div>
        ) : null}
        {step.kind === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="m-0">{step.message}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              <RotateCcw aria-hidden /> Retry
            </Button>
          </div>
        ) : null}
        {step.kind === 'ready' || step.kind === 'failed' || step.kind === 'moving' ? (
          <Body data={step.data} />
        ) : null}
        {step.kind === 'moving' ? (
          <p role="status" className="text-14 m-0 flex items-center gap-1.5">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Moving to {toTitle} in one step.
          </p>
        ) : null}
        {step.kind === 'failed' ? (
          <p role="alert" className="m-0 flex items-center gap-1.5">
            <X className="text-crit size-4" aria-hidden /> {step.message}
          </p>
        ) : null}
        {step.kind === 'done' ? (
          <p role="status" className="text-16 m-0 flex items-center gap-1.5 font-medium">
            <Check className="text-good size-4" aria-hidden /> Moved:{' '}
            {plural(step.result.copied, 'requirement')} copied, {plural(step.result.links, 'link')}{' '}
            added, {plural(step.result.review, 'requirement')} to review.
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {step.kind === 'done' ? (
            <>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Done
              </Button>
              <Button asChild>
                <Link href={`/${org}/s/${step.result.toSheetId}`}>Open {step.result.toTitle}</Link>
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={busy || !(step.kind === 'ready' || step.kind === 'failed')}
                onClick={() =>
                  step.kind === 'ready' || step.kind === 'failed' ? void move(step.data) : undefined
                }
              >
                {busy ? 'Moving…' : step.kind === 'failed' ? 'Try again' : `Move to ${toTitle}`}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
