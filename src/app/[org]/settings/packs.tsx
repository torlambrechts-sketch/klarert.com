'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  BookOpen,
  Check,
  Layers,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { SettingChoice } from '@/components/packs/setting-choice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { LevelSummary } from '@/engine/packs/levels';
import type { PackSettingValues } from '@/engine/packs/settings';
import type { PackSetting } from '@/engine/packs/types';
import type { InstallResult, PackPreviewResult } from '@/server/commands/packs';
import type { Result } from '@/server/result';
import {
  archivePackAction,
  installPackAction,
  previewPackAction,
  setPackSettingsAction,
} from './actions';

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
  const toAdopt = p.frameworks.filter((f) => !f.adopted && !f.optional);
  const linked = p.frameworks.filter((f) => f.optional && f.adopted);
  return (
    <div className="flex flex-col gap-4">
      {p.state === 'ready' && p.extendsLevel && p.level ? (
        <p className="text-copy-14 m-0" data-testid="extends-level">
          {p.extendsLevel.name} is installed. {p.level.name} adds only what is missing; your sheets,
          items and settings stay as they are.
        </p>
      ) : null}
      {p.state !== 'installed' && toAdopt.length ? (
        <p
          className="border-line bg-soft text-copy-14 m-0 flex gap-2 rounded-md border p-3"
          data-testid="adopts-framework"
        >
          <BookOpen className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Adopts the {toAdopt.map((f) => data.frameworkTitles[f.library] ?? f.library).join(', ')}{' '}
            requirement library first: one item per requirement, the statement of applicability and
            the Applicability view. The pack&apos;s sheets link to it.
          </span>
        </p>
      ) : null}
      {p.state === 'ready' && p.installsFirst?.length ? (
        <p
          className="border-line bg-soft text-copy-14 m-0 flex gap-2 rounded-md border p-3"
          data-testid="installs-first"
        >
          <Layers className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {p.installsFirst
              .map((d) =>
                d.raise
                  ? `Adds ${d.levelName ?? d.level} to ${d.title} first.`
                  : `Installs ${d.title} ${d.version}${d.levelName ? ` (${d.levelName})` : ''} first.`,
              )
              .join(' ')}{' '}
            This pack adds its columns, views and tags to those shared registers.
          </span>
        </p>
      ) : null}
      {p.state === 'ready' && p.extends?.length ? (
        <div className="flex flex-col gap-1" data-testid="extends-list">
          <p className="text-label-14 m-0 font-medium">Adds to the shared registers</p>
          <ul className="text-copy-14 text-muted-foreground m-0 flex list-disc flex-col gap-0.5 pl-5">
            {p.extends.map((e) => (
              <li key={`${e.pack}:${e.sheet}`}>
                {e.sheet}:{' '}
                {[
                  ...e.adds,
                  ...e.views.map((v) => `the view ${v}`),
                  ...e.options.map((o) => `the option ${o}`),
                ].join(', ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {p.state !== 'installed' && linked.length ? (
        <p className="text-copy-14 text-muted-foreground m-0" data-testid="links-framework">
          Links its items to the{' '}
          {linked.map((f) => data.frameworkTitles[f.library] ?? f.library).join(', ')} requirement
          library you have adopted.
        </p>
      ) : null}
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
                {a.enabled && a.testMode
                  ? ' (test mode: logs what it would do until you turn it on)'
                  : ''}
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

/** The levels of a pack as a radio group: what each one creates (docs/11 Levels). */
function LevelChoice({
  levels,
  installed,
  value,
  disabled,
  onChange,
}: {
  levels: LevelSummary[];
  installed: string | null;
  value: string | null;
  disabled: boolean;
  onChange: (key: string) => void;
}) {
  const installedRank = installed ? levels.findIndex((l) => l.key === installed) : -1;
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="text-label-13 text-muted-foreground mb-1.5 font-medium">
        Choose a level
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {levels.map((l, i) => {
          const done = i <= installedRank;
          const checked = value === l.key;
          return (
            <label
              key={l.key}
              className={`border-line flex cursor-pointer flex-col gap-1 rounded-md border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${
                checked ? 'border-ink bg-soft' : 'hover:border-line-strong'
              } ${done ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="pack-level"
                  value={l.key}
                  checked={checked}
                  disabled={disabled || done}
                  onChange={() => onChange(l.key)}
                  aria-label={l.name}
                  aria-describedby={`level-${l.key}-what`}
                  className="accent-ink size-4"
                />
                <span className="text-label-14 font-medium">{l.name}</span>
                {done ? (
                  <span className="text-label-12 bg-good-soft ml-auto flex items-center gap-1 rounded px-1.5 py-0.5">
                    <Check className="text-good size-3" aria-hidden /> Installed
                  </span>
                ) : null}
              </span>
              <span id={`level-${l.key}-what`} className="text-copy-13 text-muted-foreground">
                {l.description}
              </span>
              <span className="text-label-13">
                {i === 0 ? 'Creates' : 'Adds'}: {(i === 0 ? l.sheets : l.adds).join(', ')}
              </span>
              <span className="text-label-12 text-muted-foreground">
                {plural(l.sheets.length, 'sheet')} · {plural(l.automations, 'automation')} ·{' '}
                {plural(l.dashboards, 'dashboard')} in all
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** "Settings" on an installed pack with settings: change the choices; the defaults they set follow. */
export function PackSettings({
  org,
  installId,
  title,
  defs,
  values,
}: {
  org: string;
  installId: string;
  title: string;
  defs: PackSetting[];
  values: PackSettingValues;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PackSettingValues>(values);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function save() {
    setError(null);
    start(async () => {
      let r: Awaited<ReturnType<typeof setPackSettingsAction>>;
      try {
        r = await setPackSettingsAction({ org, installId, settings: draft });
      } catch {
        setError('The settings were not saved. Try again.');
        return;
      }
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      toast(
        r.data.fields
          ? `Saved the settings of ${title}. ${r.data.lines.join('; ')}.`
          : `Saved the settings of ${title}.`,
      );
      setOpen(false);
      router.refresh();
    });
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          setDraft(values);
          setError(null);
        }
        setOpen(next);
      }}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Settings of ${title}`}
        onClick={() => {
          setDraft(values);
          setError(null);
          setOpen(true);
        }}
      >
        <SlidersHorizontal aria-hidden /> Settings
      </Button>
      <DialogContent className="flex max-h-[85vh] w-[min(640px,calc(100vw-32px))] flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col gap-1 pr-8">
          <DialogTitle className="text-heading-20">Settings of {title}</DialogTitle>
          <DialogDescription className="text-copy-14 text-muted-foreground">
            Your choices set the defaults of new items in the pack&apos;s sheets. Items you already
            have keep their values.
          </DialogDescription>
        </div>
        {defs.map((s) => (
          <SettingChoice
            key={s.key}
            setting={s}
            value={draft[s.key] ?? null}
            disabled={pending}
            onChange={(id) =>
              setDraft((d) => {
                const next = { ...d };
                if (id) next[s.key] = id;
                else delete next[s.key];
                return next;
              })
            }
          />
        ))}
        {error ? (
          <p role="alert" className="text-crit-ink text-copy-14 m-0 flex items-center gap-1.5">
            <X className="size-4" aria-hidden /> {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={save}>
            {pending ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Preview" on a pack: what installing it would do here, then Install with its progress and Open. */
export function PackPreview({
  org,
  pack,
  label = 'Preview',
}: {
  org: string;
  pack: {
    key: string;
    title: string;
    version: string;
    levels?: LevelSummary[];
    installedLevel?: string | null;
    /** Settings chosen at install (docs/11 Pack settings); not offered when adding a level. */
    settings?: PackSetting[];
  };
  /**
   * The button's words, e.g. "Add Full" on an installed pack. Null: no button (the pack is at its highest level), kept
   * mounted so the dialog that just added the last level stays open with its result while the page refreshes.
   */
  label?: string | null;
}) {
  const [settingValues, setSettingValues] = useState<PackSettingValues>({});
  const settingDefs = pack.installedLevel ? [] : (pack.settings ?? []);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const levels = pack.levels ?? [];
  const firstOpen = () => {
    if (!levels.length) return null;
    const at = pack.installedLevel ? levels.findIndex((l) => l.key === pack.installedLevel) : -1;
    return (levels[at + 1] ?? levels[levels.length - 1])!.key;
  };
  const [level, setLevel] = useState<string | null>(firstOpen);

  async function load(chosen: string | null = level) {
    setStep({ kind: 'loading' });
    let r: Result<PackPreviewResult>;
    try {
      r = await previewPackAction({ org, key: pack.key, ...(chosen ? { level: chosen } : {}) });
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
      r = await installPackAction({
        org,
        key: pack.key,
        hash: data.hash,
        ...(level ? { level } : {}),
        ...(Object.keys(settingValues).length ? { settings: settingValues } : {}),
      });
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
      {label === null ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`${label} ${pack.title}`}
          onClick={() => {
            const l = firstOpen();
            setLevel(l);
            setOpen(true);
            void load(l);
          }}
        >
          {label}
        </Button>
      )}
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

        {levels.length ? (
          <LevelChoice
            levels={levels}
            installed={pack.installedLevel ?? null}
            value={level}
            disabled={step.kind === 'installing' || step.kind === 'done'}
            onChange={(k) => {
              setLevel(k);
              void load(k);
            }}
          />
        ) : null}

        {settingDefs.length && step.kind !== 'done' ? (
          <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
            <legend className="text-label-13 text-muted-foreground mb-1.5 font-medium">
              Settings (you can change them later under Installed packs)
            </legend>
            {settingDefs.map((s) => (
              <SettingChoice
                key={s.key}
                setting={s}
                value={settingValues[s.key] ?? null}
                disabled={step.kind === 'installing'}
                onChange={(id) =>
                  setSettingValues((d) => {
                    const next = { ...d };
                    if (id) next[s.key] = id;
                    else delete next[s.key];
                    return next;
                  })
                }
              />
            ))}
          </fieldset>
        ) : null}

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
              <Check className="text-good size-4" aria-hidden />{' '}
              {step.result.extended
                ? `Added ${step.result.level ?? 'the level'} to ${step.result.title}.`
                : `Installed ${step.result.title}${step.result.level ? ` (${step.result.level})` : ''}.`}
            </p>
            {step.result.installedFirst?.length ? (
              <p className="text-copy-14 text-muted-foreground m-0">
                Installed {step.result.installedFirst.join(', ')} first.
              </p>
            ) : null}
            {step.result.adopted.length ? (
              <p className="text-copy-14 text-muted-foreground m-0">
                Adopted {step.result.adopted.join(', ')} first.
              </p>
            ) : null}
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
  addOn,
}: {
  org: string;
  installId: string;
  title: string;
  /** An add-on (docs/11 Extends): what it added to other packs' shared registers goes, their rows stay. */
  addOn?: { onto: string[]; standard: string | null } | null;
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
        `Archived ${title}: ${plural(c.sheets ?? 0, 'sheet')} archived${
          c.fields ? `, ${plural(c.fields, 'column')} taken off the shared registers` : ''
        }, ${plural(c.automations ?? 0, 'automation')} turned off.`,
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
      {addOn ? (
        <span className="text-label-13 text-muted-foreground" data-testid="archive-addon-note">
          Archives its own sheets and dashboards, turns its automations off and takes its columns,
          views and empty groups
          {addOn.standard ? ` and the ${addOn.standard} tag` : ''} off the shared registers of{' '}
          {addOn.onto.join(', ')}. No shared rows are deleted: items it added there, and items
          tagged with it, stay with their history.
        </span>
      ) : (
        <span className="text-label-13 text-muted-foreground">
          Archives its sheets, folders and dashboards and turns its automations off. Items and the
          activity log are kept.
        </span>
      )}
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
