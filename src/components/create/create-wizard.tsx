'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { toast } from 'sonner';
import {
  AppWindow,
  ArrowLeft,
  ArrowRight,
  FileText,
  LayoutDashboard,
  Puzzle,
  RotateCcw,
  Search,
  Sheet,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { goalChips, rankGoal, type Candidate, type GoalMatch } from '@/engine/create/match';
import { appsFor } from '@/engine/packs/select';
import type { PackSettingValues } from '@/engine/packs/settings';
import { INTENTS } from '@/lib/create/intents';
import { cn } from '@/lib/utils';
import {
  bundleDetailsAction,
  createBundleAction,
  createOptionsAction,
} from '@/app/[org]/create-actions';
import type { BundleDetails, CreateOptions, CreatePack } from '@/server/commands/bundles';
import { AppList, AppSummary } from './app-step';
import { BundlePreview } from './bundle-preview';
import { BundleDetailsForm, defaultReviewDate, type DetailsState } from './bundle-details-form';
import type { CreateRequest } from './create-provider';

// The Create wizard (docs/05 §4 Create): a full-screen picker in the shell, at most three steps with a stepper.
// (1) the goal box and the cards; (2) a starting point (a ready-made set with its preview, an app and the set that
// brings it, a sheet start, a sheet to add to, a recipe); (3) a ready-made set's name, owner, review date, folder,
// settings (when its pack declares any) and level, then Create. Sheets, automations, forms and dashboards hand
// over to the screens that already make them, and an app is created as the set that carries it, so there is one code
// path each. Nothing is written before Create.

// No card adds an item: "+ New" in the sheet's header is the one way to add one (owner decision 15 Nov 2026, UX-4).
export type CardId = 'solve' | 'app' | 'sheet' | 'automation' | 'form' | 'dashboard';

const CARDS: { id: CardId; title: string; outcome: string; icon: React.ReactNode }[] = [
  {
    id: 'solve',
    title: 'Solve a problem',
    outcome: 'A ready-made set of sheets, forms, automations and a dashboard that work together.',
    icon: <Sparkles aria-hidden />,
  },
  {
    id: 'app',
    title: 'App',
    outcome: 'Screens for one job, such as reporting a problem or working on your actions.',
    icon: <AppWindow aria-hidden />,
  },
  {
    id: 'sheet',
    title: 'Sheet',
    outcome: 'A table to keep track of anything, one row per item.',
    icon: <Sheet aria-hidden />,
  },
  {
    id: 'automation',
    title: 'Automation',
    outcome: 'Let the workspace remind, assign or update things for you.',
    icon: <Zap aria-hidden />,
  },
  {
    id: 'form',
    title: 'Form',
    outcome: 'Collect items from people who do not work in the sheet.',
    icon: <FileText aria-hidden />,
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    outcome: 'See the numbers that matter on one page.',
    icon: <LayoutDashboard aria-hidden />,
  },
];

const STEPS = ['What you need', 'Starting point', 'Details'] as const;

type Load<T> =
  { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: T };

export function CreateWizard({
  org,
  request,
  onClose,
}: {
  org: string;
  request: CreateRequest;
  onClose: () => void;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<Load<CreateOptions>>({ state: 'loading' });
  const [step, setStep] = useState<1 | 2 | 3>(request.card ? 2 : 1);
  const [card, setCard] = useState<CardId | null>(request.card ?? null);
  const [goal, setGoal] = useState(request.goal ?? '');
  const [packKey, setPackKey] = useState<string | null>(null);
  const [appKey, setAppKey] = useState<string | null>(null);
  const [settings, setSettings] = useState<PackSettingValues | null>(null);
  const [recipeId, setRecipeId] = useState<string>('');
  const [details, setDetails] = useState<Load<BundleDetails> | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState<DetailsState | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [sheetQuery, setSheetQuery] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  const loadOptions = useCallback(async () => {
    setOptions({ state: 'loading' });
    try {
      const r = await createOptionsAction({ org });
      setOptions(
        r.ok ? { state: 'ready', data: r.data } : { state: 'error', message: r.error.message },
      );
    } catch {
      setOptions({
        state: 'error',
        message: 'The starting points could not be loaded. Try again.',
      });
    }
  }, [org]);
  useEffect(() => void loadOptions(), [loadOptions]);

  const opts = options.state === 'ready' ? options.data : null;
  const pack: CreatePack | null = opts?.packs.find((p) => p.key === packKey) ?? null;
  const app = opts?.apps.find((a) => a.key === appKey) ?? null;

  const loadDetails = useCallback(
    async (key: string, lvl: string | null) => {
      setDetails({ state: 'loading' });
      try {
        const r = await bundleDetailsAction({ org, key, level: lvl });
        setDetails(
          r.ok ? { state: 'ready', data: r.data } : { state: 'error', message: r.error.message },
        );
      } catch {
        setDetails({ state: 'error', message: 'The preview could not be made. Try again.' });
      }
    },
    [org],
  );
  useEffect(() => {
    if (packKey) void loadDetails(packKey, level);
  }, [packKey, level, loadDetails]);

  // a new step starts at the top, with focus on its heading
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    bodyRef.current?.querySelector<HTMLElement>('[data-step-heading]')?.focus();
  }, [step, card]);

  const candidates: Candidate[] = useMemo(() => {
    if (!opts) return [];
    return [
      ...opts.packs.map((p) => ({
        kind: 'pack' as const,
        id: p.key,
        title: p.title,
        description: p.description,
      })),
      ...opts.apps.map((a) => ({
        kind: 'app' as const,
        id: a.key,
        title: a.title,
        description: a.description,
      })),
      ...opts.starts.map((s) => ({
        kind: 'start' as const,
        id: s.id,
        title: s.title,
        description: s.description,
      })),
      ...opts.recipes.map((r) => ({
        kind: 'recipe' as const,
        id: r.id,
        title: r.title,
        description: '',
      })),
    ];
  }, [opts]);
  const matches: GoalMatch[] = useMemo(() => {
    if (!opts) return [];
    const ranked = rankGoal(goal, INTENTS, candidates, 8);
    // an app is offered as itself (the App card), next to the set that carries it
    const seen = new Set<string>();
    return (
      ranked
        // a start shipped as a ready-made set is offered once, as the set
        .filter((m) => !(m.kind === 'start' && opts.packs.some((p) => p.key === `start-${m.id}`)))
        .filter((m) => {
          const k = `${m.kind}:${m.id}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, 5)
    );
  }, [goal, candidates, opts]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  const choosePack = (key: string) => {
    if (key !== packKey) {
      setPackKey(key);
      setLevel(null);
      setExcluded([]);
      setNote(null);
      setForm(null);
      setSettings(null);
      setCreateError(null);
    }
  };
  // an app not set up here is created as the set that brings it (the same preview and planner as Solve a problem)
  const chooseApp = (key: string) => {
    setAppKey(key);
    const a = opts?.apps.find((x) => x.key === key);
    if (a?.state === 'new') choosePack(a.packKey);
  };
  const pickCard = (id: CardId) => {
    if (id === 'dashboard') return go(`/${org}/dashboards?new=1`);
    setCard(id);
    setStep(2);
  };
  const pickMatch = (m: GoalMatch) => {
    if (m.kind === 'pack') {
      setCard('solve');
      choosePack(m.id);
      setStep(2);
    } else if (m.kind === 'app') {
      setCard('app');
      chooseApp(m.id);
      setStep(2);
    } else if (m.kind === 'start') go(sheetHref(m.id));
    else if (m.kind === 'recipe') {
      setCard('automation');
      setRecipeId(m.id);
      setStep(2);
    }
  };
  const sheetHref = (start: string) =>
    `/${org}/s/new?start=${start}${request.folderId ? `&folder=${request.folderId}` : ''}`;

  const back = () => {
    setCreateError(null);
    if (step === 3) return setStep(2);
    if (step === 2) {
      setStep(1);
      setCard(null);
    }
  };

  const toDetails = () => {
    if (!pack || !opts) return;
    // the pack's settings start at their defaults (docs/11 Pack settings); a choice made before is kept
    if (details?.state === 'ready')
      setSettings(
        (cur) =>
          cur ??
          Object.fromEntries(
            details.data.settings.flatMap((x) => (x.default ? [[x.key, x.default]] : [])),
          ),
      );
    setForm(
      (f) =>
        f ?? {
          name: pack.title,
          ownerId: opts.me,
          reviewBy: defaultReviewDate(new Date()),
          folder: 'pack',
        },
    );
    setStep(3);
  };

  const create = async () => {
    if (!pack || !form || details?.state !== 'ready') return;
    setCreating(true);
    setCreateError(null);
    try {
      const r = await createBundleAction({
        org,
        key: pack.key,
        hash: details.data.hash,
        level: details.data.level?.key ?? null,
        exclude: excluded,
        folder:
          form.folder === 'pack'
            ? { mode: 'pack' }
            : form.folder === 'none'
              ? { mode: 'none' }
              : { mode: 'folder', name: form.folder.slice('folder:'.length) },
        name: form.name,
        ownerId: form.ownerId,
        reviewBy: form.reviewBy,
        ...(settings && Object.keys(settings).length ? { settings } : {}),
      });
      if (!r.ok) {
        setCreateError(
          r.error.fieldErrors ? Object.values(r.error.fieldErrors)[0]! : r.error.message,
        );
        return;
      }
      toast(`Created ${r.data.name}: ${r.data.made.join(', ')}.`, { duration: 6000 });
      // an app lands on the app itself (its first screen); a set on its first sheet
      go(
        card === 'app' && app?.forYou
          ? `/${org}/apps/${app.key}`
          : r.data.sheetId
            ? `/${org}/s/${r.data.sheetId}?created=1`
            : `/${org}/home`,
      );
    } catch {
      setCreateError('Nothing was created. Check your connection and try again.');
    } finally {
      setCreating(false);
    }
  };

  const formValid =
    !!form && form.name.trim() && form.ownerId && /^\d{4}-\d{2}-\d{2}$/.test(form.reviewBy);
  const ready = details?.state === 'ready' ? details.data : null;
  const blocked = ready?.check?.state === 'blocked';
  const keptSheets = ready
    ? ready.parts.filter((p) => p.kind === 'sheet' && !excluded.includes(p.id)).length
    : 0;
  // the chosen app's screens that stay with the parts ticked (docs/13: a screen without its objects is hidden)
  const appNeeds = ready && app ? ready.apps.find((a) => a.key === app.key) : undefined;
  const keptScreens = appNeeds ? (appsFor([appNeeds], excluded)[0]?.screens ?? 0) : null;
  const setFlow = card === 'solve' || (card === 'app' && app?.state === 'new');
  const canNext =
    setFlow &&
    (card !== 'app' || (keptScreens ?? 0) > 0) &&
    step === 2 &&
    !!pack &&
    !pack.installed &&
    !!ready &&
    !!opts?.canInstall &&
    !blocked &&
    // a set on registers the workspace has may make no sheet of its own (CAPA on Core's register)
    (keptSheets > 0 || ready.uses.length > 0);

  const primary =
    step === 1 ? null : setFlow && step === 2 ? (
      <Button type="button" onClick={toDetails} disabled={!canNext} data-testid="create-next">
        Next <ArrowRight aria-hidden />
      </Button>
    ) : setFlow && step === 3 ? (
      <Button
        type="button"
        onClick={() => void create()}
        disabled={!formValid || creating}
        data-testid="create-submit"
      >
        {creating ? 'Creating…' : 'Create'}
      </Button>
    ) : null;

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/55" />
        <DialogPrimitive.Content
          data-testid="create-wizard"
          aria-describedby={undefined}
          className="bg-surface shadow-modal fixed inset-0 z-50 flex flex-col outline-none min-[760px]:inset-4 min-[760px]:mx-auto min-[760px]:max-w-[1120px] min-[760px]:rounded-xl min-[760px]:border"
        >
          <header className="border-line flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-3 sm:px-6">
            <DialogPrimitive.Title className="text-card-title">Create</DialogPrimitive.Title>
            <ol
              aria-label="Steps"
              className="flex min-w-0 flex-1 items-center gap-2 max-[759px]:order-3 max-[759px]:basis-full"
            >
              {STEPS.map((label, i) => {
                const n = (i + 1) as 1 | 2 | 3;
                return (
                  <li
                    key={label}
                    aria-current={step === n ? 'step' : undefined}
                    className={cn(
                      'text-13 flex items-center gap-1.5',
                      step === n ? 'text-ink font-medium' : 'text-muted-foreground',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'text-12 flex size-5 items-center justify-center rounded-full border font-mono',
                        step === n
                          ? 'bg-ink text-primary-foreground border-transparent'
                          : 'border-line',
                      )}
                    >
                      {n}
                    </span>
                    <span className={cn(step !== n && 'max-[759px]:sr-only')}>{label}</span>
                    {i < 2 ? <span aria-hidden className="bg-line ml-1 h-px w-5" /> : null}
                  </li>
                );
              })}
            </ol>
            <DialogPrimitive.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close"
                className="ml-auto"
              >
                <X aria-hidden />
              </Button>
            </DialogPrimitive.Close>
          </header>

          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            {options.state === 'loading' ? (
              <Skeleton />
            ) : options.state === 'error' ? (
              <div role="alert" className="flex flex-col items-start gap-3 py-8">
                <p className="text-14">{options.message}</p>
                <Button type="button" variant="outline" onClick={() => void loadOptions()}>
                  <RotateCcw aria-hidden /> Retry
                </Button>
              </div>
            ) : step === 1 ? (
              <GoalStep
                goal={goal}
                setGoal={setGoal}
                matches={matches}
                packs={opts!.packs}
                apps={opts!.apps}
                onMatch={pickMatch}
                onCard={pickCard}
                canEdit={opts!.canEdit}
              />
            ) : card === 'solve' && step === 2 ? (
              <SolveStep
                opts={opts!}
                packKey={packKey}
                onPick={choosePack}
                details={details}
                onRetry={() => packKey && void loadDetails(packKey, level)}
                excluded={excluded}
                setExcluded={(ex, n) => {
                  setExcluded(ex);
                  setNote(n);
                }}
                note={note}
                onOpen={(sheetId) => go(sheetId ? `/${org}/s/${sheetId}` : `/${org}/home`)}
              />
            ) : card === 'app' && step === 2 ? (
              <div className="grid gap-6 min-[1000px]:grid-cols-[320px_minmax(0,1fr)]">
                <AppList apps={opts!.apps} appKey={appKey} onPick={chooseApp} />
                <section
                  aria-label="What you get"
                  className={cn('min-w-0', app && 'max-[999px]:order-first')}
                >
                  {!app ? (
                    <div className="border-line text-14 text-muted-foreground flex min-h-[200px] items-center justify-center rounded-lg border border-dashed p-6 text-center">
                      Pick an app to see its screens and what it needs.
                    </div>
                  ) : (
                    <AppSummary
                      org={org}
                      app={app}
                      canInstall={opts!.canInstall}
                      onOpen={go}
                      keptScreens={keptScreens}
                      installsFirst={ready?.check?.installsFirst ?? []}
                    >
                      <SetPreview
                        details={details}
                        onRetry={() => packKey && void loadDetails(packKey, level)}
                        excluded={excluded}
                        setExcluded={(ex, n) => {
                          setExcluded(ex);
                          setNote(n);
                        }}
                        note={note}
                        canInstall={opts!.canInstall}
                      />
                    </AppSummary>
                  )}
                </section>
              </div>
            ) : setFlow && step === 3 && !(ready && form && pack) ? (
              <Skeleton />
            ) : setFlow && step === 3 && ready && form && pack ? (
              <BundleDetailsForm
                details={ready}
                pack={pack}
                opts={opts!}
                value={form}
                onChange={setForm}
                level={level ?? ready.level?.key ?? null}
                onLevel={(l) => {
                  setLevel(l);
                  setExcluded([]);
                  setNote(null);
                }}
                excluded={excluded}
                error={createError}
                settings={settings ?? {}}
                onSettings={setSettings}
              />
            ) : card === 'sheet' ? (
              <PickList
                heading="Start a sheet from"
                description="Pick a starting point. Next you name it and adjust its columns."
                items={[
                  ...opts!.starts.map((s) => ({
                    id: s.id,
                    title: s.title,
                    description: s.description,
                  })),
                  {
                    id: 'csv',
                    title: 'Import a spreadsheet',
                    description: 'Paste or upload CSV: columns become fields, rows become items.',
                  },
                ]}
                disabled={
                  !opts!.canEdit ? 'Viewers cannot create sheets. Ask an editor or admin.' : null
                }
                hrefOf={sheetHref}
                onGo={onClose}
              />
            ) : card === 'form' ? (
              <SheetPicker
                heading="Collect items into"
                description="The form adds items to this sheet. You build it in the sheet's Forms tab."
                sheets={opts!.sheets}
                query={sheetQuery}
                setQuery={setSheetQuery}
                disabled={
                  !opts!.canInstall ? 'Only owners and admins create forms. Ask an admin.' : null
                }
                onPick={(id) => go(`/${org}/s/${id}?view=form&newform=1`)}
                onNewSheet={() => pickCard('sheet')}
              />
            ) : card === 'automation' ? (
              <AutomationStep
                opts={opts!}
                recipeId={recipeId}
                setRecipeId={setRecipeId}
                query={sheetQuery}
                setQuery={setSheetQuery}
                onPick={(sheetId) =>
                  go(
                    recipeId
                      ? `/${org}/automations?recipe=${recipeId}&sheet=${sheetId}`
                      : `/${org}/automations?new=1&sheet=${sheetId}`,
                  )
                }
              />
            ) : null}
          </div>

          {step > 1 ? (
            <footer className="border-line bg-surface sticky bottom-0 flex shrink-0 items-center gap-2 border-t px-4 py-3 sm:px-6">
              <Button type="button" variant="outline" onClick={back} data-testid="create-back">
                <ArrowLeft aria-hidden /> Back
              </Button>
              <span className="flex-1" />
              {primary}
            </footer>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
      <div className="bg-soft h-[52px] animate-pulse rounded-lg" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="bg-soft h-[118px] animate-pulse rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function StepHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h2 data-step-heading tabIndex={-1} className="text-panel-title outline-none">
        {title}
      </h2>
      {description ? <p className="text-14 text-muted-foreground mt-1">{description}</p> : null}
    </div>
  );
}

function GoalStep({
  goal,
  setGoal,
  matches,
  packs,
  apps,
  onMatch,
  onCard,
  canEdit,
}: {
  goal: string;
  setGoal: (g: string) => void;
  matches: GoalMatch[];
  packs: CreatePack[];
  apps: CreateOptions['apps'];
  onMatch: (m: GoalMatch) => void;
  onCard: (c: CardId) => void;
  canEdit: boolean;
}) {
  const kindWord = { pack: 'Ready-made set', start: 'Sheet', recipe: 'Automation', app: 'App' };
  const readyApps = new Set(apps.filter((a) => a.state === 'ready').map((a) => a.key));
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="create-goal" className="flex flex-col gap-3">
        <h2 id="create-goal" data-step-heading tabIndex={-1} className="text-kpi outline-none">
          What do you need to handle?
        </h2>
        <label className="border-line focus-within:border-focus focus-within:ring-focus flex h-12 items-center gap-2 rounded-lg border px-3 focus-within:ring-2">
          <Search className="text-muted-foreground size-5 shrink-0" aria-hidden />
          <input
            autoFocus
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="For example: customer complaints"
            aria-label="What do you need to handle?"
            aria-describedby="create-goal-help"
            className="text-16 text-ink placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none"
            data-testid="create-goal"
          />
        </label>
        <p id="create-goal-help" className="text-13 text-muted-foreground">
          Matched with keywords on this device. Nothing you type is sent anywhere.
        </p>
        <ul aria-label="Examples" className="flex flex-wrap gap-2">
          {goalChips(INTENTS).map((c) => (
            <li key={c}>
              <button
                type="button"
                onClick={() => setGoal(c)}
                aria-pressed={goal === c}
                className="border-line hover:border-line-strong text-13 aria-pressed:bg-ink aria-pressed:text-primary-foreground h-8 rounded-full border px-3 transition-colors duration-150"
              >
                {c}
              </button>
            </li>
          ))}
        </ul>
        {goal.trim() ? (
          <div aria-live="polite">
            {matches.length ? (
              <ul
                aria-label="Closest matches"
                className="grid gap-2 sm:grid-cols-2"
                data-testid="create-matches"
              >
                {matches.map((m) => {
                  const installed =
                    m.kind === 'pack' && packs.find((p) => p.key === m.id)?.installed;
                  const appReady = m.kind === 'app' && readyApps.has(m.id);
                  return (
                    <li key={`${m.kind}:${m.id}`}>
                      <button
                        type="button"
                        onClick={() => onMatch(m)}
                        className="border-line hover:border-line-strong hover:bg-subtle flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors duration-150"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="text-14 block font-medium">{m.title}</span>
                          <span className="text-13 text-muted-foreground line-clamp-2">
                            {m.description || kindWord[m.kind]}
                          </span>
                        </span>
                        <span className="bg-soft text-12 text-muted-foreground shrink-0 rounded-full px-2 py-0.5">
                          {installed ? 'Set up' : appReady ? 'Ready' : kindWord[m.kind]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-14 text-muted-foreground">
                Nothing ready-made matches yet. Pick one of the options below.
              </p>
            )}
          </div>
        ) : null}
      </section>
      <section aria-labelledby="create-cards">
        <h2 id="create-cards" className="text-13 text-muted-foreground mb-2 font-medium">
          Or create
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((c) => {
            // a set and an app are previewed by everyone; creating them is for owners and admins
            const off = !canEdit && c.id !== 'solve' && c.id !== 'app';
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onCard(c.id)}
                  disabled={off}
                  data-testid={`create-card-${c.id}`}
                  className="border-line hover:border-line-strong hover:bg-subtle flex h-full w-full flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-5"
                >
                  <span className="text-ink">{c.icon}</span>
                  <span className="text-card-title">{c.title}</span>
                  <span className="text-13 text-muted-foreground">
                    {off ? 'Ask an editor or admin.' : c.outcome}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function SolveStep({
  opts,
  packKey,
  onPick,
  details,
  onRetry,
  excluded,
  setExcluded,
  note,
  onOpen,
}: {
  opts: CreateOptions;
  packKey: string | null;
  onPick: (k: string) => void;
  details: Load<BundleDetails> | null;
  onRetry: () => void;
  excluded: string[];
  setExcluded: (ex: string[], note: string | null) => void;
  note: string | null;
  onOpen: (sheetId: string | null) => void;
}) {
  const pack = opts.packs.find((p) => p.key === packKey) ?? null;
  // side by side, the chosen set stays in sight in the list; on phones its preview comes first instead
  useEffect(() => {
    if (!packKey || !window.matchMedia('(min-width: 1000px)').matches) return;
    document
      .querySelector(`[data-testid="create-set-${packKey}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [packKey]);
  return (
    <div className="grid gap-6 min-[1000px]:grid-cols-[320px_minmax(0,1fr)]">
      <section aria-labelledby="create-sets">
        <h2
          id="create-sets"
          data-step-heading
          tabIndex={-1}
          className="text-panel-title mb-1 outline-none"
        >
          Pick a ready-made set
        </h2>
        <p className="text-13 text-muted-foreground mb-3">
          Each set is the sheets, forms, automations and dashboards for one job.
        </p>
        <ul role="radiogroup" aria-label="Ready-made sets" className="flex flex-col gap-2">
          {opts.packs.map((p) => (
            <li key={p.key}>
              <button
                type="button"
                role="radio"
                aria-checked={p.key === packKey}
                onClick={() => onPick(p.key)}
                data-testid={`create-set-${p.key}`}
                className="border-line hover:border-line-strong aria-checked:border-ink aria-checked:bg-subtle flex w-full flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors duration-150 aria-checked:shadow-[inset_0_0_0_1px_var(--ink)]"
              >
                <span className="flex w-full items-center gap-2">
                  <span className="text-14 min-w-0 flex-1 truncate font-medium">{p.title}</span>
                  {p.installed ? (
                    <span className="bg-soft text-12 text-muted-foreground rounded-full px-2 py-0.5">
                      Set up
                    </span>
                  ) : null}
                </span>
                <span className="text-13 text-muted-foreground line-clamp-2">{p.description}</span>
                <span className="text-12 text-muted-foreground">{p.inside}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section
        aria-label="What will be created"
        className={cn('min-w-0', pack && 'max-[999px]:order-first')}
      >
        {!pack ? (
          <div className="border-line text-14 text-muted-foreground flex min-h-[200px] items-center justify-center rounded-lg border border-dashed p-6 text-center">
            Pick a set to see exactly what it creates.
          </div>
        ) : pack.installed ? (
          <div className="border-line flex flex-col items-start gap-3 rounded-lg border p-5">
            <h3 className="text-card-title">{pack.title} is already set up here</h3>
            <p className="text-14 text-muted-foreground">
              It was created as {pack.installed.name}. A set is created once per workspace.
            </p>
            <Button type="button" onClick={() => onOpen(pack.installed!.sheetId)}>
              Open {pack.installed.name}
            </Button>
          </div>
        ) : (
          <SetPreview
            details={details}
            onRetry={onRetry}
            excluded={excluded}
            setExcluded={setExcluded}
            note={note}
            canInstall={opts.canInstall}
          />
        )}
      </section>
    </div>
  );
}

/** A set's preview as it loads: Solve a problem's and the App card's (for an app not set up yet). */
function SetPreview({
  details,
  onRetry,
  excluded,
  setExcluded,
  note,
  canInstall,
}: {
  details: Load<BundleDetails> | null;
  onRetry: () => void;
  excluded: string[];
  setExcluded: (ex: string[], note: string | null) => void;
  note: string | null;
  canInstall: boolean;
}) {
  if (!details || details.state === 'loading')
    return (
      <div aria-busy="true" aria-label="Loading the preview" className="flex flex-col gap-3">
        <div className="bg-soft h-[72px] animate-pulse rounded-lg" />
        <div className="bg-soft h-[240px] animate-pulse rounded-lg" />
      </div>
    );
  if (details.state === 'error')
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="text-14">{details.message}</p>
        <Button type="button" variant="outline" onClick={onRetry}>
          <RotateCcw aria-hidden /> Retry
        </Button>
      </div>
    );
  return (
    <BundlePreview
      details={details.data}
      excluded={excluded}
      onChange={setExcluded}
      note={note}
      canInstall={canInstall}
    />
  );
}

function PickList({
  heading,
  description,
  items,
  disabled,
  hrefOf,
  onGo,
}: {
  heading: string;
  description: string;
  items: { id: string; title: string; description: string }[];
  disabled: string | null;
  hrefOf: (id: string) => string;
  onGo: () => void;
}) {
  const cls =
    'border-line hover:border-line-strong hover:bg-subtle flex h-full w-full flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors duration-150';
  return (
    <div>
      <StepHeading title={heading} description={description} />
      {disabled ? <p className="text-14 text-muted-foreground mb-3">{disabled}</p> : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((s) => (
          <li key={s.id}>
            {disabled ? (
              <div aria-disabled className={cn(cls, 'cursor-not-allowed opacity-60')}>
                <span className="text-14 font-medium">{s.title}</span>
                <span className="text-13 text-muted-foreground">{s.description}</span>
              </div>
            ) : (
              <Link
                href={hrefOf(s.id)}
                onClick={onGo}
                data-testid={`create-start-${s.id}`}
                className={cls}
              >
                <span className="text-14 font-medium">{s.title}</span>
                <span className="text-13 text-muted-foreground">{s.description}</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SheetList({
  sheets,
  query,
  setQuery,
  disabled,
  onPick,
  onNewSheet,
}: {
  sheets: CreateOptions['sheets'];
  query: string;
  setQuery: (q: string) => void;
  disabled: string | null;
  onPick: (id: string) => void;
  onNewSheet?: () => void;
}) {
  const q = query.trim().toLowerCase();
  const shown = sheets.filter((s) => !q || s.name.toLowerCase().includes(q)).slice(0, 50);
  return (
    <div className="flex flex-col gap-3">
      {disabled ? <p className="text-14 text-muted-foreground">{disabled}</p> : null}
      {sheets.length > 6 ? (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a sheet"
          aria-label="Find a sheet"
          className="border-line focus-visible:border-focus text-14 focus-visible:ring-focus h-10 w-full max-w-[420px] rounded-md border px-3 outline-none focus-visible:ring-2"
        />
      ) : null}
      {sheets.length === 0 ? (
        <div className="border-line flex flex-col items-start gap-3 rounded-lg border border-dashed p-5">
          <p className="text-14">No sheets yet. Create a sheet first.</p>
          {onNewSheet ? (
            <Button type="button" onClick={onNewSheet}>
              New sheet
            </Button>
          ) : null}
        </div>
      ) : shown.length === 0 ? (
        <p className="text-14 text-muted-foreground">No sheet matches.</p>
      ) : (
        <ul aria-label="Sheets" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                disabled={!!disabled}
                onClick={() => onPick(s.id)}
                className="border-line hover:border-line-strong hover:bg-subtle flex w-full flex-col items-start rounded-lg border px-3 py-2.5 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="text-14 w-full truncate font-medium">{s.name}</span>
                <span className="text-12 text-muted-foreground w-full truncate">
                  {s.folder ? `${s.folder} · ` : ''}
                  {s.itemLabel}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SheetPicker(props: {
  heading: string;
  description: string;
  sheets: CreateOptions['sheets'];
  query: string;
  setQuery: (q: string) => void;
  disabled: string | null;
  onPick: (id: string) => void;
  onNewSheet: () => void;
}) {
  return (
    <div>
      <StepHeading title={props.heading} description={props.description} />
      <SheetList {...props} />
    </div>
  );
}

function AutomationStep({
  opts,
  recipeId,
  setRecipeId,
  query,
  setQuery,
  onPick,
}: {
  opts: CreateOptions;
  recipeId: string;
  setRecipeId: (id: string) => void;
  query: string;
  setQuery: (q: string) => void;
  onPick: (sheetId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <StepHeading
        title="Start an automation"
        description="Pick a recipe (or start blank) and the sheet it watches. You finish it in the builder."
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-14 mb-2 font-medium">Recipe</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { id: '', title: 'Blank automation: choose the trigger and actions yourself' },
            ...opts.recipes,
          ].map((r) => (
            <label
              key={r.id || 'blank'}
              className="border-line has-checked:border-ink has-checked:bg-subtle flex cursor-pointer items-start gap-2 rounded-lg border p-3"
            >
              <input
                type="radio"
                name="recipe"
                value={r.id}
                checked={recipeId === r.id}
                onChange={() => setRecipeId(r.id)}
                className="mt-0.5 accent-[var(--ink)]"
              />
              <span className="text-13">{r.title}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <section aria-labelledby="automation-sheet">
        <h3 id="automation-sheet" className="text-14 mb-2 font-medium">
          Sheet it watches
        </h3>
        <SheetList
          sheets={opts.sheets}
          query={query}
          setQuery={setQuery}
          disabled={!opts.canEdit ? 'Viewers cannot build automations. Ask an editor.' : null}
          onPick={onPick}
        />
      </section>
      <p className="text-13 text-muted-foreground flex items-center gap-1.5">
        <Puzzle className="size-4" aria-hidden /> Recipes fill in the builder; nothing runs until
        you turn it on.
      </p>
    </div>
  );
}
