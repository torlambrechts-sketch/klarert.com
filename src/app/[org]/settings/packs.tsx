'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Loader2, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { InstallResult, PackPreviewResult } from '@/server/commands/packs';
import type { Result } from '@/server/result';
import { archivePackAction, installPackAction, previewPackAction } from './actions';

// Workspace admin › Packs (docs/05 §2.1, docs/11): the preview dialog with install and its progress, and Archive
// with an inline confirm. The words come from the planner (src/engine/packs/plan.ts); nothing is worked out here.

type Step =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: PackPreviewResult }
  | { kind: 'installing'; data: PackPreviewResult }
  | { kind: 'failed'; data: PackPreviewResult; message: string }
  | { kind: 'done'; data: PackPreviewResult; result: InstallResult };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-label-13 text-muted-foreground font-medium">{title}</h3>
      {children}
    </section>
  );
}

function List({ label, items }: { label: string; items: React.ReactNode[] }) {
  return (
    <ul aria-label={label} className="text-copy-14 m-0 flex list-none flex-col gap-1 p-0">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

function PreviewBody({ data }: { data: PackPreviewResult }) {
  const p = data.preview;
  return (
    <div className="flex flex-col gap-4">
      {p.state === 'blocked' ? (
        <div
          role="alert"
          className="border-crit-line bg-crit-soft flex flex-col gap-1 rounded-md border p-3"
        >
          <p className="text-label-14 text-crit-ink m-0 flex items-center gap-1.5 font-medium">
            <X className="size-4" aria-hidden /> This pack cannot be installed
          </p>
          <List label="Conflicts" items={p.conflicts} />
        </div>
      ) : null}
      {p.state === 'installed' ? (
        <p className="text-copy-14 m-0 flex items-center gap-1.5">
          <Check className="text-good size-4" aria-hidden /> Already installed. Nothing to do.
        </p>
      ) : null}
      {p.state === 'ready' ? <p className="text-copy-14 m-0">{data.lines[0]}</p> : null}
      {p.folders.length ? (
        <Section title="Folders">
          <List
            label="Folders"
            items={p.folders.map((f) =>
              f.action === 'create' ? `New folder ${f.name}` : `Uses the folder ${f.name}`,
            )}
          />
        </Section>
      ) : null}
      <Section title="Sheets">
        <List
          label="Sheets"
          items={p.sheets.map((s) => (
            <span key={s.ref}>
              <span className="font-medium">{s.name}</span>{' '}
              <span className="text-label-12-mono text-muted-foreground">{s.prefix}</span>
              <span className="text-muted-foreground">
                {' · '}
                {plural(s.fields, 'field')}
                {s.items
                  ? ` · ${plural(s.items, s.kind === 'documents' ? 'document' : s.kind === 'library' ? 'library item' : 'example item')}`
                  : ''}
                {s.kind === 'library'
                  ? ' · library'
                  : s.kind === 'documents'
                    ? ' · documents register'
                    : ''}
                {s.subitems ? ` · sub-items "${s.subitems}"` : ''}
              </span>
            </span>
          ))}
        />
      </Section>
      {p.links.length ? (
        <Section title="Links between sheets">
          <List
            label="Links between sheets"
            items={p.links.map(
              (l) => `${l.from} → ${l.to} through ${l.field}${l.twoWay ? ', both ways' : ''}`,
            )}
          />
        </Section>
      ) : null}
      {p.renamedPrefixes.length ? (
        <Section title="Renamed ID prefixes">
          <List
            label="Renamed ID prefixes"
            items={p.renamedPrefixes.map(
              (r) => `${r.sheet}: ${r.to} (${r.from} is taken in this workspace)`,
            )}
          />
        </Section>
      ) : null}
      {p.automations.length ? (
        <Section title="Automations">
          <List
            label="Automations"
            items={p.automations.map((a, i) => (
              <span key={i}>
                <span className="text-muted-foreground">{a.sheet}: </span>
                {a.sentence}
                {a.enabled ? '' : ' (installed off)'}
              </span>
            ))}
          />
        </Section>
      ) : null}
      {p.forms.length ? (
        <Section title="Forms">
          <List
            label="Forms"
            items={p.forms.map(
              (f) => `${f.name} on ${f.sheet}: ${f.access}, a draft until its notice is reviewed`,
            )}
          />
        </Section>
      ) : null}
      {p.dashboards.length ? (
        <Section title="Dashboards">
          <List
            label="Dashboards"
            items={p.dashboards.map((d) => `${d.name} with ${plural(d.widgets, 'widget')}`)}
          />
        </Section>
      ) : null}
      {p.warnings.length ? (
        <Section title="Good to know">
          <List
            label="Good to know"
            items={p.warnings.map((w, i) => (
              <span key={i} className="flex gap-1.5">
                <AlertTriangle className="text-warn mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{w}</span>
              </span>
            ))}
          />
        </Section>
      ) : null}
    </div>
  );
}

/** "Preview" on a pack: what installing it would do here, then Install with its progress and Open. */
export function PackPreview({
  org,
  pack,
}: {
  org: string;
  pack: { key: string; title: string; version: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'loading' });

  async function load() {
    setStep({ kind: 'loading' });
    let r: Result<PackPreviewResult>;
    try {
      r = await previewPackAction({ org, key: pack.key });
    } catch {
      setStep({ kind: 'error', message: 'The preview could not be loaded. Try again.' });
      return;
    }
    setStep(r.ok ? { kind: 'ready', data: r.data } : { kind: 'error', message: r.error.message });
  }

  async function install(data: PackPreviewResult) {
    setStep({ kind: 'installing', data });
    let r: Result<InstallResult>;
    try {
      r = await installPackAction({ org, key: pack.key, hash: data.hash });
    } catch {
      setStep({
        kind: 'failed',
        data,
        message: 'The install did not finish. Nothing was changed. Try again.',
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (step.kind === 'installing') return;
        setOpen(next);
      }}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Preview ${pack.title}`}
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        Preview
      </Button>
      <DialogContent className="flex max-h-[85vh] w-[min(640px,calc(100vw-32px))] flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col gap-1 pr-8">
          <DialogTitle className="text-heading-20">
            {pack.title}{' '}
            <span className="text-label-13-mono text-muted-foreground align-middle">
              {pack.version}
            </span>
          </DialogTitle>
          <DialogDescription className="text-copy-14 text-muted-foreground">
            What installing this pack creates in this workspace.
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
        {step.kind === 'ready' || step.kind === 'failed' || step.kind === 'installing' ? (
          <PreviewBody data={step.data} />
        ) : null}

        {step.kind === 'installing' ? (
          <div role="status" className="flex flex-col gap-2">
            <p className="text-copy-14 m-0 flex items-center gap-1.5">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Installing {pack.title}:
              writing every sheet, field, item and automation in one step.
            </p>
            <div className="bg-soft h-1 overflow-hidden rounded" aria-hidden>
              <div className="bg-ink h-full w-1/3 animate-pulse rounded" />
            </div>
          </div>
        ) : null}
        {step.kind === 'failed' ? (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="m-0 flex items-center gap-1.5">
              <X className="text-crit size-4" aria-hidden /> {step.message}
            </p>
          </div>
        ) : null}
        {step.kind === 'done' ? (
          <div role="status" className="flex flex-col gap-2">
            <p className="text-copy-16 m-0 flex items-center gap-1.5 font-medium">
              <Check className="text-good size-4" aria-hidden /> Installed {step.result.title}.
            </p>
            {step.result.renamedPrefixes.length ? (
              <p className="text-copy-14 text-muted-foreground m-0">
                {step.result.renamedPrefixes.map((r) => `${r.sheet} uses ${r.to}`).join('; ')}.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {step.kind === 'done' ? (
            <>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Done
              </Button>
              {step.result.sheetId ? (
                <Button asChild>
                  <Link href={`/${org}/s/${step.result.sheetId}`}>Open</Link>
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={step.kind === 'installing'}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              {step.kind === 'ready' || step.kind === 'failed' || step.kind === 'installing' ? (
                <Button
                  type="button"
                  disabled={step.kind === 'installing' || step.data.preview.state !== 'ready'}
                  onClick={() => (step.kind === 'installing' ? undefined : void install(step.data))}
                >
                  {step.kind === 'installing'
                    ? 'Installing…'
                    : step.kind === 'failed'
                      ? 'Try again'
                      : 'Install'}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Archive an installed pack, with an inline confirm. */
export function ArchivePack({
  org,
  installId,
  title,
}: {
  org: string;
  installId: string;
  title: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  function run() {
    start(async () => {
      let r: Awaited<ReturnType<typeof archivePackAction>>;
      try {
        r = await archivePackAction({ org, installId });
      } catch {
        toast.error('Something went wrong. Try again.');
        return;
      }
      if (!r.ok) {
        toast.error(r.error.message, { action: { label: 'Retry', onClick: run } });
        return;
      }
      const c = r.data.counts;
      toast(
        `Archived ${title}: ${plural(c.sheets ?? 0, 'sheet')} archived, ${plural(c.automations ?? 0, 'automation')} turned off.`,
      );
      setConfirming(false);
      router.refresh();
    });
  }
  if (!confirming)
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Archive ${title}`}
        onClick={() => setConfirming(true)}
      >
        Archive
      </Button>
    );
  return (
    <span className="flex flex-col items-start gap-1 sm:items-end">
      <span className="text-label-13 text-muted-foreground">
        Archives its sheets, folders and dashboards and turns its automations off. Items and the
        activity log are kept.
      </span>
      <span className="flex gap-1">
        <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={run}>
          {pending ? 'Archiving…' : `Archive ${title}`}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </span>
    </span>
  );
}
