'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Building2,
  Check,
  Info,
  Layers,
  Lightbulb,
  Loader2,
  PackagePlus,
  RotateCcw,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { PartPicker } from '@/components/create/bundle-preview';
import { inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { isMajorStep, versionProblem } from '@/engine/packs/capture';
import { cn } from '@/lib/utils';
import type { PublishPreview, PublishResult } from '@/server/commands/pack-publish';
import type { Result } from '@/server/result';
import { previewPublishAction, publishPackAction, withdrawPackAction } from './actions';

// Workspace admin › Packs › Your packs (docs/11 Your own packs): "Save your setup" captures this workspace as a private
// pack (what is captured, what is left out, the version to publish) and Withdraw stops new installs. The words come
// from the server and the pure capture (src/engine/packs/capture.ts); nothing is worked out here.

type Step =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: PublishPreview }
  | { kind: 'publishing'; data: PublishPreview }
  | { kind: 'failed'; data: PublishPreview; message: string }
  | { kind: 'done'; data: PublishPreview; result: PublishResult };

function Box({
  icon,
  tone = 'soft',
  children,
  testId,
}: {
  icon: React.ReactNode;
  tone?: 'soft' | 'warn';
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'text-14 flex gap-2 rounded-md border p-3',
        tone === 'warn' ? 'border-warn/40 bg-warn-soft' : 'border-line bg-soft',
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
    </div>
  );
}

/** "Save your setup": the capture with its parts, the Left out report, name, description and version. */
export function SaveSetup({
  org,
  workspace,
  packs,
}: {
  org: string;
  workspace: string;
  /** Packs this workspace published: a new version of one of them, or a new pack. */
  packs: { key: string; title: string; version: string }[];
}) {
  const router = useRouter();
  const ids = { as: useId(), name: useId(), desc: useId(), version: useId(), versionHelp: useId() };
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [key, setKey] = useState<string>('');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [, start] = useTransition();
  const seq = useRef(0);

  async function load(nextKey: string, nextExcluded: string[], reset: boolean) {
    const n = ++seq.current;
    if (reset) setStep({ kind: 'loading' });
    let r: Result<PublishPreview>;
    try {
      r = await previewPublishAction({
        org,
        ...(nextKey ? { key: nextKey } : {}),
        excluded: nextExcluded,
      });
    } catch {
      if (n === seq.current)
        setStep({ kind: 'error', message: 'Your setup could not be read. Try again.' });
      return;
    }
    if (n !== seq.current) return;
    if (!r.ok) {
      setStep({ kind: 'error', message: r.error.message });
      return;
    }
    setStep({ kind: 'ready', data: r.data });
    setExcluded(r.data.excluded);
    if (reset) {
      setTitle(r.data.previous?.title ?? `${workspace} setup`);
      setDescription(r.data.previous?.description ?? '');
      setVersion(r.data.suggested.version);
    } else if (r.data.suggested.kind !== 'same') setVersion(r.data.suggested.version);
  }

  function publish(data: PublishPreview) {
    start(async () => {
      setStep({ kind: 'publishing', data });
      let r: Result<PublishResult>;
      try {
        r = await publishPackAction({
          org,
          ...(key ? { key } : {}),
          title,
          description,
          version,
          excluded,
          contentHash: data.contentHash,
        });
      } catch {
        setStep({ kind: 'failed', data, message: 'Nothing was published. Try again.' });
        return;
      }
      if (!r.ok) {
        setStep({ kind: 'failed', data, message: r.error.message });
        return;
      }
      setStep({ kind: 'done', data, result: r.data });
      toast(`Published ${r.data.title} ${r.data.version}.`);
      router.refresh();
    });
  }

  const data = step.kind === 'loading' || step.kind === 'error' ? null : step.data;
  const prev = data?.previous?.version ?? null;
  const vProblem = data ? versionProblem(prev, version) : null;
  const major = isMajorStep(prev, version);
  const busy = step.kind === 'publishing';
  const blocked =
    !data ||
    busy ||
    step.kind === 'done' ||
    data.problems.length > 0 ||
    data.suggested.kind === 'same' ||
    !!vProblem ||
    !title.trim() ||
    data.parts.length - excluded.length + (data.adds.length ? 1 : 0) === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
      }}
    >
      <Button
        type="button"
        size="sm"
        onClick={() => {
          setKey('');
          setExcluded([]);
          setNote(null);
          setOpen(true);
          void load('', [], true);
        }}
      >
        <PackagePlus aria-hidden /> Save your setup
      </Button>
      <DialogContent className="flex max-h-[85vh] w-[min(760px,calc(100vw-32px))] flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col gap-1 pr-8">
          <DialogTitle className="text-panel-title">Save your setup</DialogTitle>
          <DialogDescription className="text-14 text-muted-foreground">
            Save the sheets, columns, views, forms and automations of this workspace as your own
            pack. Install it in your other workspaces; publish a new version and each workspace
            takes the update and keeps its own changes.
          </DialogDescription>
        </div>

        <Box icon={<Building2 className="size-4" aria-hidden />} testId="publisher">
          <span>
            Published from <span className="font-medium">{workspace}</span>, which owns the pack.
          </span>
          <span className="text-muted-foreground">
            Publish from your practice or head-office workspace, not a client&apos;s.
          </span>
        </Box>

        {packs.length ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.as} className="text-13 font-medium">
              Publish as
            </label>
            <select
              id={ids.as}
              className={cn(inputClass, 'h-9')}
              value={key}
              disabled={busy || step.kind === 'done'}
              onChange={(e) => {
                setKey(e.target.value);
                setExcluded([]);
                setNote(null);
                void load(e.target.value, [], true);
              }}
            >
              <option value="">A new pack</option>
              {packs.map((p) => (
                <option key={p.key} value={p.key}>
                  A new version of {p.title} (now {p.version})
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {step.kind === 'loading' ? (
          <div
            role="status"
            aria-busy="true"
            aria-label="Reading your setup"
            className="flex flex-col gap-2"
          >
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-soft h-5 animate-pulse rounded" />
            ))}
          </div>
        ) : null}
        {step.kind === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="m-0">{step.message}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load(key, excluded, true)}
            >
              <RotateCcw aria-hidden /> Retry
            </Button>
          </div>
        ) : null}

        {data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.name} className="text-13 font-medium">
                  Name
                </label>
                <input
                  id={ids.name}
                  className={cn(inputClass, 'h-9')}
                  value={title}
                  maxLength={80}
                  disabled={busy || step.kind === 'done'}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.version} className="text-13 font-medium">
                  Version
                </label>
                <input
                  id={ids.version}
                  className={cn(inputClass, 'text-13 h-9 font-mono')}
                  value={version}
                  inputMode="decimal"
                  aria-invalid={!!vProblem}
                  aria-describedby={ids.versionHelp}
                  disabled={busy || step.kind === 'done'}
                  onChange={(e) => setVersion(e.target.value.trim())}
                />
              </div>
            </div>
            <p
              id={ids.versionHelp}
              className="text-13 text-muted-foreground m-0"
              data-testid="version-hint"
            >
              {vProblem ? (
                <span className="text-crit-ink flex items-center gap-1.5">
                  <X className="size-3.5" aria-hidden /> {vProblem}
                </span>
              ) : (
                <>
                  Suggested {data.suggested.version}: {data.suggested.reason}
                  {data.suggested.kind === 'patch'
                    ? ' A patch version, for wording.'
                    : data.suggested.kind === 'minor'
                      ? ' A minor version, for additions and changes.'
                      : ''}
                </>
              )}
            </p>
            {major ? (
              <Box
                tone="warn"
                icon={<AlertTriangle className="text-warn size-4" aria-hidden />}
                testId="major-warning"
              >
                Existing copies can&apos;t update to a major version. Workspaces that installed{' '}
                {prev} keep it; they would have to archive it and install {version} fresh.
              </Box>
            ) : null}
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.desc} className="text-13 font-medium">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <textarea
                id={ids.desc}
                className={cn(inputClass, 'h-auto min-h-16 py-2')}
                value={description}
                maxLength={2000}
                disabled={busy || step.kind === 'done'}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <section className="flex flex-col gap-2" aria-label="What is saved">
              <h3 className="text-14 m-0 font-medium">What is saved</h3>
              <p className="text-14 m-0" data-testid="inside">
                Inside: {data.inside}.
              </p>
              {data.requires.length ? (
                <p className="text-14 text-muted-foreground m-0 flex gap-1.5">
                  <Layers className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    Builds on {data.requires.join(', ')}: installed first in a workspace that does
                    not have it.
                  </span>
                </p>
              ) : null}
              {data.adds.length ? (
                <div className="flex flex-col gap-1" data-testid="adds">
                  <p className="text-13 m-0 font-medium">Adds to our registers</p>
                  <ul className="text-14 text-muted-foreground m-0 flex list-disc flex-col gap-0.5 pl-5">
                    {data.adds.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {data.parts.length ? (
                <PartPicker
                  parts={data.parts}
                  excluded={excluded}
                  onChange={(next, n) => {
                    setExcluded(next);
                    setNote(n);
                    void load(key, next, false);
                  }}
                />
              ) : (
                <p className="text-14 text-muted-foreground m-0">
                  This workspace has no sheets, automations or dashboards of its own yet.
                </p>
              )}
              {note ? (
                <p role="status" className="text-13 text-muted-foreground m-0">
                  {note}
                </p>
              ) : null}
              <Box icon={<Info className="size-4" aria-hidden />} testId="example-items-note">
                Example items come later: no items are copied, only the structure.
              </Box>
            </section>

            <section className="flex flex-col gap-2" aria-label="Left out" data-testid="left-out">
              <h3 className="text-14 m-0 font-medium">Left out</h3>
              <p className="text-13 text-muted-foreground m-0">
                Never copied: people, personal data, files, updates, emails, form links, the
                activity log and webhook addresses.
              </p>
              {data.leftOut.map((g) => (
                <div key={g.kind} className="flex flex-col gap-0.5">
                  <p className="text-13 m-0 font-medium">{g.heading}</p>
                  <ul className="text-13 m-0 flex list-disc flex-col gap-0.5 pl-5">
                    {g.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>

            {data.problems.length ? (
              <div
                role="alert"
                className="border-crit-line bg-crit-soft flex flex-col gap-1 rounded-md border p-3"
              >
                <p className="text-14 text-crit-ink m-0 flex items-center gap-1.5 font-medium">
                  <X className="size-4" aria-hidden /> This setup cannot be published yet
                </p>
                <ul className="text-13 m-0 flex list-disc flex-col gap-0.5 pl-5">
                  {data.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <details className="border-line rounded-md border p-3" data-testid="advice">
              <summary className="text-14 cursor-pointer font-medium">
                <Lightbulb className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />
                Advice ({data.advice.length}): not required
              </summary>
              <ul className="text-13 text-muted-foreground mt-2 mb-0 flex list-disc flex-col gap-0.5 pl-5">
                {data.advice.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </details>

            <p className="text-13 text-muted-foreground m-0">
              Admins of a workspace you install it in can read every version: it is your work,
              shared with them. Every automation starts in test mode there.
            </p>
          </>
        ) : null}

        {step.kind === 'failed' ? (
          <p role="alert" className="text-crit-ink text-14 m-0 flex items-center gap-1.5">
            <X className="size-4" aria-hidden /> {step.message}
          </p>
        ) : null}
        {step.kind === 'done' ? (
          <p
            role="status"
            className="text-14 m-0 flex items-center gap-1.5"
            data-testid="published"
          >
            <Check className="text-good size-4" aria-hidden /> Published {step.result.title}{' '}
            {step.result.version}: {step.result.inside}. Install it from Packs in your other
            workspaces.
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            {step.kind === 'done' ? 'Done' : 'Cancel'}
          </Button>
          {step.kind !== 'done' ? (
            <Button type="button" disabled={blocked} onClick={() => data && publish(data)}>
              {busy ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden /> Publishing…
                </>
              ) : step.kind === 'failed' ? (
                'Try again'
              ) : (
                `Publish ${version}`
              )}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Withdraw a pack this workspace published, with an inline confirm: no new installs; installed copies stay. */
export function WithdrawPack({
  org,
  packKey,
  title,
}: {
  org: string;
  packKey: string;
  title: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  function run() {
    start(async () => {
      let r: Awaited<ReturnType<typeof withdrawPackAction>>;
      try {
        r = await withdrawPackAction({ org, key: packKey });
      } catch {
        toast.error('Something went wrong. Try again.');
        return;
      }
      if (!r.ok) {
        toast.error(r.error.message, { action: { label: 'Retry', onClick: run } });
        return;
      }
      toast(`Withdrew ${title}. Workspaces that have it keep it and can still take updates.`);
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
        aria-label={`Withdraw ${title}`}
        onClick={() => setConfirming(true)}
      >
        Withdraw
      </Button>
    );
  return (
    <span className="flex flex-col items-start gap-1 sm:items-end">
      <span className="text-13 text-muted-foreground">
        No workspace can install it any more. Workspaces that have it keep it and can still take
        your updates.
      </span>
      <span className="flex gap-1">
        <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={run}>
          {pending ? 'Withdrawing…' : `Withdraw ${title}`}
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
