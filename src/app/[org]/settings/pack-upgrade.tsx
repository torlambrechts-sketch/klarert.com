'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowUpCircle, Check, Loader2, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { UpgradeChange, UpgradeConflict } from '@/engine/packs/upgrade';
import type { UpgradePreviewResult, UpgradeResult } from '@/server/commands/packs';
import type { Result } from '@/server/result';
import { previewPackUpgradeAction, upgradePackAction } from './actions';

// Workspace admin › Packs and Frameworks (docs/11 Upgrades): "Update available x → y" opens the dry run of the update
// (what is added, changed, archived and kept, and the conflicts with a choice each) and applies it in one step. The
// words come from the upgrade planner (src/engine/packs/upgrade.ts); nothing is worked out here.

type Step =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: UpgradePreviewResult }
  | { kind: 'applying'; data: UpgradePreviewResult }
  | { kind: 'failed'; data: UpgradePreviewResult; message: string }
  | { kind: 'done'; data: UpgradePreviewResult; result: UpgradeResult };

const KIND: Record<UpgradeChange['kind'], string> = {
  folder: 'Folder',
  sheet: 'Sheet',
  field: 'Field',
  group: 'Group',
  view: 'View',
  form: 'Form',
  item: 'Item',
  requirement: 'Requirement',
  automation: 'Automation',
  dashboard: 'Dashboard',
  option: 'Option',
};

const SHOWN = 8;

function Changes({ title, list, id }: { title: string; list: UpgradeChange[]; id: string }) {
  const [all, setAll] = useState(false);
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, SHOWN);
  return (
    <section className="flex flex-col gap-1.5" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-label-13 text-muted-foreground m-0 font-medium">
        {title} · {list.length}
      </h3>
      <ul aria-label={title} className="text-copy-14 m-0 flex list-none flex-col gap-1 p-0">
        {shown.map((c) => (
          <li key={`${c.kind}:${c.ref}`} className="flex flex-col">
            <span>
              <span className="text-label-12 text-muted-foreground mr-1.5">{KIND[c.kind]}</span>
              {c.name}
            </span>
            {c.note ? <span className="text-copy-13 text-muted-foreground">{c.note}</span> : null}
          </li>
        ))}
      </ul>
      {list.length > SHOWN ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          aria-expanded={all}
          onClick={() => setAll((x) => !x)}
        >
          {all ? 'Show fewer' : `Show all ${list.length}`}
        </Button>
      ) : null}
    </section>
  );
}

function ConflictChoice({
  c,
  value,
  disabled,
  onChange,
}: {
  c: UpgradeConflict;
  value: 'mine' | 'theirs';
  disabled: boolean;
  onChange: (v: 'mine' | 'theirs') => void;
}) {
  const name = `conflict-${c.id}`;
  return (
    <fieldset className="border-line m-0 flex flex-col gap-2 rounded-md border p-3">
      <legend className="text-label-14 px-1 font-medium">
        <span className="text-label-12 text-muted-foreground mr-1.5">{KIND[c.kind]}</span>
        {c.name}
      </legend>
      <p className="text-copy-13 text-muted-foreground m-0">
        You and the pack both changed {c.attributes.join(', ')}.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(
          [
            ['mine', 'Keep mine'],
            ['theirs', 'Take the pack’s'],
          ] as const
        ).map(([v, label]) => (
          <label
            key={v}
            className="text-label-14 flex min-h-8 cursor-pointer items-center gap-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2"
          >
            <input
              type="radio"
              name={name}
              value={v}
              checked={value === v}
              disabled={disabled}
              onChange={() => onChange(v)}
              className="accent-ink size-4"
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Body({
  data,
  choices,
  disabled,
  onChoice,
}: {
  data: UpgradePreviewResult;
  choices: Record<string, 'mine' | 'theirs'>;
  disabled: boolean;
  onChoice: (id: string, v: 'mine' | 'theirs') => void;
}) {
  const p = data.preview;
  if (p.state === 'current')
    return (
      <p className="text-copy-14 m-0 flex items-center gap-1.5" role="status">
        <Check className="text-good size-4" aria-hidden /> {p.title} {p.from} is up to date.
      </p>
    );
  if (p.state === 'blocked')
    return (
      <div
        role="alert"
        className="border-crit-line bg-crit-soft flex flex-col gap-1 rounded-md border p-3"
      >
        <p className="text-label-14 text-crit-ink m-0 flex items-center gap-1.5 font-medium">
          <X className="size-4" aria-hidden /> This pack cannot be updated
        </p>
        <ul className="text-copy-14 m-0 flex list-none flex-col gap-1 p-0">
          {p.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </div>
    );
  const c = p.counts;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-copy-14 m-0" data-testid="upgrade-summary">
        {c.added} added · {c.changed} changed · {c.archived} archived or turned off · {c.kept} kept
        · {c.conflicts} {c.conflicts === 1 ? 'conflict' : 'conflicts'}
      </p>
      <p className="text-copy-13 text-muted-foreground m-0">
        Only what you have not changed is updated. Nothing is deleted: removed objects are archived
        (restorable) and automations turned off. Fields keep their type and every option; your
        items, answers and automation on or off settings stay as they are.
      </p>
      {p.conflicts.length ? (
        <section className="flex flex-col gap-2" aria-labelledby="upgrade-conflicts-title">
          <h3
            id="upgrade-conflicts-title"
            className="text-label-13 m-0 flex items-center gap-1.5 font-medium"
          >
            <AlertTriangle className="text-warn size-4" aria-hidden /> Conflicts ·{' '}
            {p.conflicts.length}
          </h3>
          {p.conflicts.map((x) => (
            <ConflictChoice
              key={x.id}
              c={x}
              value={choices[x.id] ?? 'mine'}
              disabled={disabled}
              onChange={(v) => onChoice(x.id, v)}
            />
          ))}
        </section>
      ) : null}
      <Changes title="Added" list={p.added} id="upgrade-added" />
      <Changes title="Changed" list={p.changed} id="upgrade-changed" />
      <Changes title="Archived or turned off" list={p.archived} id="upgrade-archived" />
      <Changes title="Kept as they are" list={p.kept} id="upgrade-kept" />
      {p.warnings.length ? (
        <ul className="text-copy-13 text-muted-foreground m-0 flex list-none flex-col gap-1 p-0">
          {p.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * "Update available x → y" and its dialog. Owners and admins. Rendered with `to: null` when there is nothing to
 * update, so the dialog that just applied an update stays open with its result while the page refreshes; the dialog
 * keeps the versions it was opened with.
 */
export function PackUpgrade({
  org,
  installId,
  title,
  from,
  to,
}: {
  org: string;
  installId: string;
  title: string;
  from: string;
  to: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState({ from, to: to ?? '' });
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [choices, setChoices] = useState<Record<string, 'mine' | 'theirs'>>({});

  async function load() {
    setStep({ kind: 'loading' });
    setChoices({});
    let r: Result<UpgradePreviewResult>;
    try {
      r = await previewPackUpgradeAction({ org, installId });
    } catch {
      setStep({ kind: 'error', message: 'The update could not be previewed. Try again.' });
      return;
    }
    setStep(r.ok ? { kind: 'ready', data: r.data } : { kind: 'error', message: r.error.message });
  }

  async function apply(data: UpgradePreviewResult) {
    setStep({ kind: 'applying', data });
    let r: Result<UpgradeResult>;
    try {
      r = await upgradePackAction({ org, installId, hash: data.hash, choices });
    } catch {
      setStep({
        kind: 'failed',
        data,
        message: 'The update did not finish. Nothing was changed. Try again.',
      });
      return;
    }
    if (!r.ok) {
      setStep({ kind: 'failed', data, message: r.error.message });
      return;
    }
    setStep({ kind: 'done', data, result: r.data });
    toast(`Updated ${r.data.title} to ${r.data.to}: ${r.data.summary}`);
    router.refresh();
  }

  const busy = step.kind === 'applying';
  const data = step.kind === 'loading' || step.kind === 'error' ? null : step.data;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
      }}
    >
      {to ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Update ${title} from ${from} to ${to}`}
          onClick={() => {
            setVersions({ from, to });
            setOpen(true);
            void load();
          }}
        >
          <ArrowUpCircle aria-hidden /> Update to {to}
        </Button>
      ) : null}
      <DialogContent className="flex max-h-[85vh] w-[min(640px,calc(100vw-32px))] flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col gap-1 pr-8">
          <DialogTitle className="text-heading-20">
            Update {title}{' '}
            <span className="text-label-13-mono text-muted-foreground align-middle">
              {versions.from} → {versions.to}
            </span>
          </DialogTitle>
          <DialogDescription className="text-copy-14 text-muted-foreground">
            A dry run: what updating changes in this workspace. Nothing is written until you apply
            it.
          </DialogDescription>
        </div>

        {step.kind === 'loading' ? (
          <div aria-busy="true" aria-label="Loading the update" className="flex flex-col gap-2">
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
        {data && step.kind !== 'done' ? (
          <Body
            data={data}
            choices={choices}
            disabled={busy}
            onChoice={(id, v) => setChoices((c) => ({ ...c, [id]: v }))}
          />
        ) : null}
        {busy ? (
          <div role="status" className="flex flex-col gap-2">
            <p className="text-copy-14 m-0 flex items-center gap-1.5">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Updating {title}: every change
              is written in one step, or none.
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
          <div role="status" className="flex flex-col gap-1">
            <p className="text-copy-16 m-0 flex items-center gap-1.5 font-medium">
              <Check className="text-good size-4" aria-hidden /> Updated {step.result.title} to{' '}
              {step.result.to}.
            </p>
            <p className="text-copy-14 text-muted-foreground m-0">{step.result.summary}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {step.kind === 'done' ? (
            <Button type="button" onClick={() => setOpen(false)}>
              Done
            </Button>
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
              {data ? (
                <Button
                  type="button"
                  disabled={busy || data.preview.state !== 'ready'}
                  onClick={() => (busy ? undefined : void apply(data))}
                >
                  {busy ? 'Updating…' : step.kind === 'failed' ? 'Try again' : `Apply update`}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
