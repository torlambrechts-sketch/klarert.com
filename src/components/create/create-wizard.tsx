'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  LayoutDashboard,
  ListPlus,
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
import { INTENTS } from '@/lib/create/intents';
import { cn } from '@/lib/utils';
import {
  bundleDetailsAction,
  createBundleAction,
  createOptionsAction,
} from '@/app/[org]/create-actions';
import type { BundleDetails, CreateOptions, CreatePack } from '@/server/commands/bundles';
import { BundlePreview } from './bundle-preview';
import { BundleDetailsForm, defaultReviewDate, type DetailsState } from './bundle-details-form';
import type { CreateRequest } from './create-provider';

// The Create wizard (docs/05 §4 Create): a full-screen picker in the shell, at most three steps with a stepper.
// (1) the goal box and the cards; (2) a starting point (a ready-made set with its preview, a sheet start, a sheet to
// add to, a recipe); (3) a ready-made set's name, owner, review date, folder and level, then Create. Sheets, entries,
// automations, forms and dashboards hand over to the screens that already make them, so there is one code path each.
// Nothing is written before Create.

export type CardId = 'solve' | 'sheet' | 'entry' | 'automation' | 'form' | 'dashboard';

const CARDS: { id: CardId; title: string; outcome: string; icon: React.ReactNode }[] = [
  {
    id: 'solve',
    title: 'Solve a problem',
    outcome: 'A ready-made set of sheets, forms, automations and a dashboard that work together.',
    icon: <Sparkles aria-hidden />,
  },
  {
    id: 'sheet',
    title: 'Sheet',
    outcome: 'A table to keep track of anything, one row per item.',
    icon: <Sheet aria-hidden />,
  },
  {
    id: 'entry',
    title: 'Entry',
    outcome: 'Add one item to a sheet you already have.',
    icon: <ListPlus aria-hidden />,
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
      ...opts.packs.flatMap((p) =>
        p.apps.map((a) => ({
          kind: 'app' as const,
          id: a,
          title: p.title,
          description: p.description,
        })),
      ),
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
    // an app is offered as the set that carries it
    const seen = new Set<string>();
    return ranked
      .map((m) =>
        m.kind === 'app'
          ? {
              ...m,
              kind: 'pack' as const,
              id: opts.packs.find((p) => p.apps.includes(m.id))?.key ?? m.id,
            }
          : m,
      )
      .filter((m) => {
        const k = `${m.kind}:${m.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 5);
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
      setCreateError(null);
    }
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
      });
      if (!r.ok) {
        setCreateError(
          r.error.fieldErrors ? Object.values(r.error.fieldErrors)[0]! : r.error.message,
        );
        return;
      }
      toast(`Created ${r.data.name}: ${r.data.made.join(', ')}.`, { duration: 6000 });
      go(r.data.sheetId ? `/${org}/s/${r.data.sheetId}?created=1` : `/${org}/home`);
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
  const canNext =
    card === 'solve' &&
    step === 2 &&
    !!pack &&
    !pack.installed &&
    !!ready &&
    !!opts?.canInstall &&
    !blocked &&
    keptSheets > 0;

  const primary =
    step === 1 ? null : card === 'solve' && step === 2 ? (
      <Button type="button" onClick={toDetails} disabled={!canNext} data-testid="create-next">
        Next <ArrowRight aria-hidden />
      </Button>
    ) : card === 'solve' && step === 3 ? (
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
          className="bg-background-100 shadow-modal fixed inset-0 z-50 flex flex-col outline-none min-[760px]:inset-4 min-[760px]:mx-auto min-[760px]:max-w-[1120px] min-[760px]:rounded-xl min-[760px]:border"
        >
          <header className="border-line flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-3 sm:px-6">
            <DialogPrimitive.Title className="text-heading-16">Create</DialogPrimitive.Title>
            <ol
              aria-label="Steps"
              className="flex min-w-0 flex-1 items-center gap-2 max-[759px]:order-3 max-[759px]:basis-full"
            >
              {STEPS.map((label, i) => {
                const n = (i + 1) as 1 | 2 | 3;
                const shown = card === 'solve' || n < 3;
                if (!shown) return null;
                return (
                  <li
                    key={label}
                    aria-current={step === n ? 'step' : undefined}
                    className={cn(
                      'text-label-13 flex items-center gap-1.5',
                      step === n ? 'text-ink font-medium' : 'text-muted-foreground',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'text-label-11-mono flex size-5 items-center justify-center rounded-full border',
                        step === n
                          ? 'bg-ink text-primary-foreground border-transparent'
                          : 'border-line',
                      )}
                    >
                      {n}
                    </span>
                    <span className={cn(step !== n && 'max-[759px]:sr-only')}>{label}</span>
                    {i < 2 && shown && (card === 'solve' || n < 2) ? (
                      <span aria-hidden className="bg-line ml-1 h-px w-5" />
                    ) : null}
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
                <p className="text-copy-14">{options.message}</p>
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
            ) : card === 'solve' && step === 3 && !(ready && form && pack) ? (
              <Skeleton />
            ) : card === 'solve' && step === 3 && ready && form && pack ? (
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
            ) : card === 'entry' ? (
              <SheetPicker
                heading="Add an entry to"
                description="Your most recently used sheets come first."
                sheets={opts!.sheets}
                query={sheetQuery}
                setQuery={setSheetQuery}
                disabled={!opts!.canEdit ? 'Viewers cannot add items. Ask an editor.' : null}
                onPick={(id) => go(`/${org}/s/${id}?new=1`)}
                onNewSheet={() => pickCard('sheet')}
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
            <footer className="border-line bg-background-100 sticky bottom-0 flex shrink-0 items-center gap-2 border-t px-4 py-3 sm:px-6">
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
      <h2 data-step-heading tabIndex={-1} className="text-heading-20 outline-none">
        {title}
      </h2>
      {description ? (
        <p className="text-copy-14 text-muted-foreground mt-1">{description}</p>
      ) : null}
    </div>
  );
}

function GoalStep({
  goal,
  setGoal,
  matches,
  packs,
  onMatch,
  onCard,
  canEdit,
}: {
  goal: string;
  setGoal: (g: string) => void;
  matches: GoalMatch[];
  packs: CreatePack[];
  onMatch: (m: GoalMatch) => void;
  onCard: (c: CardId) => void;
  canEdit: boolean;
}) {
  const kindWord = { pack: 'Ready-made set', start: 'Sheet', recipe: 'Automation', app: 'App' };
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="create-goal" className="flex flex-col gap-3">
        <h2
          id="create-goal"
          data-step-heading
          tabIndex={-1}
          className="text-heading-24 outline-none"
        >
          What do you need to handle?
        </h2>
        <label className="border-line focus-within:border-focus flex h-12 items-center gap-2 rounded-lg border px-3 focus-within:shadow-[0_0_0_3px_rgb(161_161_170/0.25)]">
          <Search className="text-muted-foreground size-5 shrink-0" aria-hidden />
          <input
            autoFocus
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="For example: customer complaints"
            aria-label="What do you need to handle?"
            aria-describedby="create-goal-help"
            className="text-copy-16 text-ink placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none"
            data-testid="create-goal"
          />
        </label>
        <p id="create-goal-help" className="text-copy-13 text-muted-foreground">
          Matched with keywords on this device. Nothing you type is sent anywhere.
        </p>
        <ul aria-label="Examples" className="flex flex-wrap gap-2">
          {goalChips(INTENTS).map((c) => (
            <li key={c}>
              <button
                type="button"
                onClick={() => setGoal(c)}
                aria-pressed={goal === c}
                className="border-line hover:border-line-strong text-label-13 aria-pressed:bg-ink aria-pressed:text-primary-foreground h-8 rounded-full border px-3 transition-colors duration-150"
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
                  return (
                    <li key={`${m.kind}:${m.id}`}>
                      <button
                        type="button"
                        onClick={() => onMatch(m)}
                        className="border-line hover:border-line-strong hover:bg-subtle flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors duration-150"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="text-label-14 block font-medium">{m.title}</span>
                          <span className="text-copy-13 text-muted-foreground line-clamp-2">
                            {m.description || kindWord[m.kind]}
                          </span>
                        </span>
                        <span className="bg-soft text-label-12 text-muted-foreground shrink-0 rounded-full px-2 py-0.5">
                          {installed ? 'Set up' : kindWord[m.kind]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-copy-14 text-muted-foreground">
                Nothing ready-made matches yet. Pick one of the options below.
              </p>
            )}
          </div>
        ) : null}
      </section>
      <section aria-labelledby="create-cards">
        <h2 id="create-cards" className="text-label-13 text-muted-foreground mb-2 font-medium">
          Or create
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((c) => {
            const off = !canEdit && c.id !== 'solve';
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
                  <span className="text-heading-16">{c.title}</span>
                  <span className="text-copy-13 text-muted-foreground">
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
  return (
    <div className="grid gap-6 min-[1000px]:grid-cols-[320px_minmax(0,1fr)]">
      <section aria-labelledby="create-sets">
        <h2
          id="create-sets"
          data-step-heading
          tabIndex={-1}
          className="text-heading-20 mb-1 outline-none"
        >
          Pick a ready-made set
        </h2>
        <p className="text-copy-13 text-muted-foreground mb-3">
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
                  <span className="text-label-14 min-w-0 flex-1 truncate font-medium">
                    {p.title}
                  </span>
                  {p.installed ? (
                    <span className="bg-soft text-label-12 text-muted-foreground rounded-full px-2 py-0.5">
                      Set up
                    </span>
                  ) : null}
                </span>
                <span className="text-copy-13 text-muted-foreground line-clamp-2">
                  {p.description}
                </span>
                <span className="text-label-12 text-muted-foreground">{p.inside}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="What will be created" className="min-w-0">
        {!pack ? (
          <div className="border-line text-copy-14 text-muted-foreground flex min-h-[200px] items-center justify-center rounded-lg border border-dashed p-6 text-center">
            Pick a set to see exactly what it creates.
          </div>
        ) : pack.installed ? (
          <div className="border-line flex flex-col items-start gap-3 rounded-lg border p-5">
            <h3 className="text-heading-16">{pack.title} is already set up here</h3>
            <p className="text-copy-14 text-muted-foreground">
              It was created as {pack.installed.name}. A set is created once per workspace.
            </p>
            <Button type="button" onClick={() => onOpen(pack.installed!.sheetId)}>
              Open {pack.installed.name}
            </Button>
          </div>
        ) : !details || details.state === 'loading' ? (
          <div aria-busy="true" aria-label="Loading the preview" className="flex flex-col gap-3">
            <div className="bg-soft h-[72px] animate-pulse rounded-lg" />
            <div className="bg-soft h-[240px] animate-pulse rounded-lg" />
          </div>
        ) : details.state === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="text-copy-14">{details.message}</p>
            <Button type="button" variant="outline" onClick={onRetry}>
              <RotateCcw aria-hidden /> Retry
            </Button>
          </div>
        ) : (
          <BundlePreview
            details={details.data}
            excluded={excluded}
            onChange={setExcluded}
            note={note}
            canInstall={opts.canInstall}
          />
        )}
      </section>
    </div>
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
      {disabled ? <p className="text-copy-14 text-muted-foreground mb-3">{disabled}</p> : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((s) => (
          <li key={s.id}>
            {disabled ? (
              <div aria-disabled className={cn(cls, 'cursor-not-allowed opacity-60')}>
                <span className="text-label-14 font-medium">{s.title}</span>
                <span className="text-copy-13 text-muted-foreground">{s.description}</span>
              </div>
            ) : (
              <Link
                href={hrefOf(s.id)}
                onClick={onGo}
                data-testid={`create-start-${s.id}`}
                className={cls}
              >
                <span className="text-label-14 font-medium">{s.title}</span>
                <span className="text-copy-13 text-muted-foreground">{s.description}</span>
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
      {disabled ? <p className="text-copy-14 text-muted-foreground">{disabled}</p> : null}
      {sheets.length > 6 ? (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a sheet"
          aria-label="Find a sheet"
          className="border-line focus-visible:border-focus text-label-14 h-10 w-full max-w-[420px] rounded-md border px-3 outline-none"
        />
      ) : null}
      {sheets.length === 0 ? (
        <div className="border-line flex flex-col items-start gap-3 rounded-lg border border-dashed p-5">
          <p className="text-copy-14">No sheets yet. Create a sheet first.</p>
          {onNewSheet ? (
            <Button type="button" onClick={onNewSheet}>
              New sheet
            </Button>
          ) : null}
        </div>
      ) : shown.length === 0 ? (
        <p className="text-copy-14 text-muted-foreground">No sheet matches.</p>
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
                <span className="text-label-14 w-full truncate font-medium">{s.name}</span>
                <span className="text-label-12 text-muted-foreground w-full truncate">
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
        <legend className="text-label-14 mb-2 font-medium">Recipe</legend>
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
              <span className="text-copy-13">{r.title}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <section aria-labelledby="automation-sheet">
        <h3 id="automation-sheet" className="text-label-14 mb-2 font-medium">
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
      <p className="text-copy-13 text-muted-foreground flex items-center gap-1.5">
        <Puzzle className="size-4" aria-hidden /> Recipes fill in the builder; nothing runs until
        you turn it on.
      </p>
    </div>
  );
}
