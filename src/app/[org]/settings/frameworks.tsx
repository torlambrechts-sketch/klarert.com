'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Loader2, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { ControlsSheet } from '@/engine/frameworks/adopt';
import type { AdoptionPreview, AdoptionResult } from '@/server/commands/frameworks';
import type { Result } from '@/server/result';
import { adoptFrameworkAction, previewAdoptionAction } from './actions';

// Workspace admin › Frameworks (docs/12): "Adopt" opens a preview of the library the framework's pack creates here,
// with the sheet whose items are the workspace's controls; adopting writes it in one step. The words come from the
// pack planner; nothing is worked out here.

type Step =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: AdoptionPreview }
  | { kind: 'adopting'; data: AdoptionPreview }
  | { kind: 'failed'; data: AdoptionPreview; message: string }
  | { kind: 'done'; data: AdoptionPreview; result: AdoptionResult };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Body({ data }: { data: AdoptionPreview }) {
  const p = data.preview;
  const sheet = p.sheets[0];
  return (
    <div className="flex flex-col gap-3">
      {p.state === 'blocked' ? (
        <div
          role="alert"
          className="border-crit-line bg-crit-soft flex flex-col gap-1 rounded-md border p-3"
        >
          <p className="text-label-14 text-crit-ink m-0 flex items-center gap-1.5 font-medium">
            <X className="size-4" aria-hidden /> This framework cannot be adopted
          </p>
          <ul className="text-copy-14 m-0 flex list-none flex-col gap-1 p-0">
            {p.conflicts.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {p.state === 'installed' ? (
        <p className="text-copy-14 m-0 flex items-center gap-1.5">
          <Check className="text-good size-4" aria-hidden /> Already adopted. Nothing to do.
        </p>
      ) : null}
      <ul
        aria-label="What adopting creates"
        className="text-copy-14 m-0 flex list-none flex-col gap-1 p-0"
      >
        {p.folders.map((f) => (
          <li key={f.name}>
            {f.action === 'create' ? `New folder ${f.name}` : `Goes in the folder ${f.name}`}
          </li>
        ))}
        {sheet ? (
          <li>
            <span className="font-medium">{sheet.name}</span>{' '}
            <span className="text-label-12-mono text-muted-foreground">{sheet.prefix}</span>
            <span className="text-muted-foreground">
              {' · '}a library of {plural(sheet.items, 'requirement')} with{' '}
              {plural(sheet.fields, 'field')}, grouped by theme
            </span>
          </li>
        ) : null}
        {p.counts.views > 0 ? <li>{plural(p.counts.views, 'saved view')}</li> : null}
        {p.links.map((l) => (
          <li key={l.field}>
            {l.from} → {l.to} through {l.field}
            {l.twoWay ? ', both ways' : ''}
          </li>
        ))}
        {p.renamedPrefixes.map((r) => (
          <li key={r.sheet}>
            {r.sheet} uses {r.to} ({r.from} is taken in this workspace)
          </li>
        ))}
      </ul>
      <p className="text-label-13 text-muted-foreground m-0">{data.licence}</p>
    </div>
  );
}

/** "Adopt" on a framework of the catalogue: choose the controls sheet, preview, adopt, open. */
export function AdoptFramework({
  org,
  framework,
  controls,
}: {
  org: string;
  framework: { key: string; version: string; title: string };
  controls: ControlsSheet[];
}) {
  const router = useRouter();
  const selectId = useId();
  const [open, setOpen] = useState(false);
  const [controlsSheetId, setControlsSheetId] = useState<string>(controls[0]?.sheetId ?? '');
  const [step, setStep] = useState<Step>({ kind: 'loading' });

  async function load(sheet = controlsSheetId) {
    setStep({ kind: 'loading' });
    let r: Result<AdoptionPreview>;
    try {
      r = await previewAdoptionAction({
        org,
        framework: framework.key,
        version: framework.version,
        controlsSheetId: sheet || null,
      });
    } catch {
      setStep({ kind: 'error', message: 'The preview could not be loaded. Try again.' });
      return;
    }
    setStep(r.ok ? { kind: 'ready', data: r.data } : { kind: 'error', message: r.error.message });
  }

  async function adopt(data: AdoptionPreview) {
    setStep({ kind: 'adopting', data });
    let r: Result<AdoptionResult>;
    try {
      r = await adoptFrameworkAction({
        org,
        framework: framework.key,
        version: framework.version,
        hash: data.hash,
        controlsSheetId: controlsSheetId || null,
      });
    } catch {
      setStep({
        kind: 'failed',
        data,
        message: 'Adopting did not finish. Nothing was changed. Try again.',
      });
      return;
    }
    if (!r.ok) {
      setStep({ kind: 'failed', data, message: r.error.message });
      return;
    }
    setStep({ kind: 'done', data, result: r.data });
    router.refresh();
  }

  const busy = step.kind === 'adopting';
  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : setOpen(next))}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`Adopt ${framework.title}`}
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        Adopt
      </Button>
      <DialogContent className="flex max-h-[85vh] w-[min(600px,calc(100vw-32px))] flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col gap-1 pr-8">
          <DialogTitle className="text-heading-20">Adopt {framework.title}</DialogTitle>
          <DialogDescription className="text-copy-14 text-muted-foreground">
            What adopting this framework creates in this workspace.
          </DialogDescription>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={selectId} className="text-label-13 font-medium">
            Controls sheet
          </label>
          <select
            id={selectId}
            className="border-line bg-background-100 text-copy-14 h-9 rounded-md border px-2"
            value={controlsSheetId}
            disabled={busy || step.kind === 'done'}
            onChange={(e) => {
              setControlsSheetId(e.target.value);
              void load(e.target.value);
            }}
          >
            <option value="">No controls sheet</option>
            {controls.map((c) => (
              <option key={c.sheetId} value={c.sheetId}>
                {c.sheetName} ({c.fieldName})
              </option>
            ))}
          </select>
          <span className="text-label-12 text-muted-foreground">
            {controls.length
              ? 'The library gets a Controls column linked both ways with this sheet.'
              : 'Add a Requirement field that links to any library sheet to a sheet of controls to link them both ways.'}
          </span>
        </div>

        {step.kind === 'loading' ? (
          <div aria-busy="true" aria-label="Loading the preview" className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
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
        {step.kind === 'ready' || step.kind === 'failed' || step.kind === 'adopting' ? (
          <Body data={step.data} />
        ) : null}
        {step.kind === 'adopting' ? (
          <p role="status" className="text-copy-14 m-0 flex items-center gap-1.5">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Adopting {framework.title}:
            writing the library in one step.
          </p>
        ) : null}
        {step.kind === 'failed' ? (
          <p role="alert" className="m-0 flex items-center gap-1.5">
            <X className="text-crit size-4" aria-hidden /> {step.message}
          </p>
        ) : null}
        {step.kind === 'done' ? (
          <p role="status" className="text-copy-16 m-0 flex items-center gap-1.5 font-medium">
            <Check className="text-good size-4" aria-hidden /> Adopted {step.result.title}:{' '}
            {plural(step.result.requirements, 'requirement')} in the library.
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {step.kind === 'done' ? (
            <>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Done
              </Button>
              <Button asChild>
                <Link href={`/${org}/s/${step.result.sheetId}`}>Open the library</Link>
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
                disabled={
                  busy ||
                  !(step.kind === 'ready' || step.kind === 'failed') ||
                  step.data.preview.state !== 'ready'
                }
                onClick={() =>
                  step.kind === 'ready' || step.kind === 'failed'
                    ? void adopt(step.data)
                    : undefined
                }
              >
                {busy ? 'Adopting…' : step.kind === 'failed' ? 'Try again' : 'Adopt'}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
