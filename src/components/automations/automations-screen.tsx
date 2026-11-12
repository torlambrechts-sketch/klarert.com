'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import {
  ListCrumb,
  ListFrame,
  ListSearch,
  PanelCard,
  Segmented,
  toolbarSelectClass,
} from '@/components/shell/data-list';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CalendarClock, Loader2, Plus, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { runDateChecksNowAction } from '@/app/[org]/automations/actions';
import {
  applyRecipe,
  defaultMapping,
  describeAutomation,
  emptyDraft,
  recipeSource,
  roleCandidates,
  withWorkspaceFields,
  type AutomationDraft,
  type Recipe,
  type RoleMapping,
} from '@/engine/automations';
import { emptySheetData, sheetCtx, type SheetData } from '@/engine/sheet-data';
import type { Ctx } from '@/engine/types';
import { inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { RECIPES, recipeById } from '@/lib/recipes';
import { fetchSheetData } from '@/lib/sheet-query';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { ListPermissions } from './automation-list';
import { AutomationRows, AutomationTableHeader, NewAutomationRow } from './automation-table';
import { AutomationBuilder } from './builder';
import {
  automationsKey,
  useAutomations,
  useDirectory,
  useJobTitles,
  useRuns,
  useWorkspaceFields,
  useWorkspaceSheets,
  type SheetRef,
} from './queries';
import { RunLog, RunTable } from './run-log';
import { ErrorBox, ListSkeleton } from './states';

// The Automations page (docs/04 §10, docs/05 §4) in the board design: all automations or one sheet's (?sheet=) as an
// expandable list with search and an on/off filter; the builder opens in place (?new=1 as a new row at the top,
// ?edit=<id> in that row; ?recipe=<id>&sheet=<id> after the recipe cards of ?recipes=1); the latest runs under the
// list and the full run log at ?tab=runs. Owners and admins can "Run date checks now": the scheduler's own code for
// this workspace (docs/04 §8).

export interface ScreenProps {
  org: string;
  orgId: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  timeZone: string;
  userId: string;
}

const selectClass = cn(
  inputClass,
  'select-chevron h-8 w-auto max-w-[280px] text-[13.5px] shadow-none',
);

export function AutomationsScreen(props: ScreenProps) {
  const [client] = useState(
    () =>
      new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: 1 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <Body {...props} />
    </QueryClientProvider>
  );
}

function useNav() {
  const router = useRouter();
  const path = usePathname();
  return (params: Record<string, string | null | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    const s = q.toString();
    router.push(s ? `${path}?${s}` : path);
  };
}

function Body(props: ScreenProps) {
  const params = useSearchParams();
  const tab = params.get('tab');
  const perms: ListPermissions = {
    canEdit: props.role !== 'viewer',
    isAdmin: props.role === 'owner' || props.role === 'admin',
  };
  if (tab === 'runs') return <RunLog {...props} />;
  if ((params.get('edit') || params.get('new') || params.get('recipe')) && !perms.canEdit)
    return <ReadOnly org={props.org} />;
  if (params.get('recipes') && !params.get('recipe'))
    return <RecipeGallery {...props} perms={perms} />;
  return <ListScreen {...props} perms={perms} />;
}

/** The Ctx of each sheet built from the workspace's fields and people: enough for trigger summaries. */
export function useSummaryCtx(orgId: string, timeZone: string, userId: string) {
  const sheets = useWorkspaceSheets(orgId);
  const fields = useWorkspaceFields(orgId);
  const dir = useDirectory(orgId);
  return useMemo(() => {
    const cache = new Map<string, Ctx>();
    const now = new Date();
    return (sheetId: string): Ctx | null => {
      if (!sheets.data || !fields.data || !dir.data) return null;
      const hit = cache.get(sheetId);
      if (hit) return hit;
      const sheet = sheets.data.find((s) => s.id === sheetId);
      if (!sheet) return null;
      const data: SheetData = {
        ...emptySheetData(sheet),
        ...dir.data,
        fields: fields.data.filter((f) => f.sheetId === sheetId),
        related: { sheets: sheets.data, fields: fields.data, items: [] },
      };
      const ctx = sheetCtx(data, { now, timeZone, userId, newId: (p) => p });
      cache.set(sheetId, ctx);
      return ctx;
    };
  }, [sheets.data, fields.data, dir.data, timeZone, userId]);
}

/** "Run date checks now" (admins): same code as the scheduler, for this workspace only. */
function RunDateChecks({ org, orgId }: { org: string; orgId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await runDateChecksNowAction({ org });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      for (const m of r.data.messages) toast.success(m);
      await Promise.all([
        qc.invalidateQueries({ queryKey: automationsKey(orgId) }),
        qc.invalidateQueries({ queryKey: ['automation-runs', orgId] }),
      ]);
    } catch {
      toast.error('Date checks could not run. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" onClick={run} disabled={busy} aria-busy={busy}>
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <CalendarClock aria-hidden />}
      Run date checks now
    </Button>
  );
}

function ListScreen(props: ScreenProps & { perms: ListPermissions }) {
  const { org, orgId, perms } = props;
  const params = useSearchParams();
  const nav = useNav();
  const sheetFilter = params.get('sheet');
  const editId = params.get('edit');
  const creating = !!(params.get('new') || params.get('recipe'));
  const [q, setQ] = useState('');
  const [state, setState] = useState<'all' | 'on' | 'off'>('all');
  const autos = useAutomations(orgId);
  const sheets = useWorkspaceSheets(orgId);
  const ctxOf = useSummaryCtx(orgId, props.timeZone, props.userId);
  const latest = useRuns(orgId, { sheetId: sheetFilter, automationId: null, outcome: null });
  const runsHeading = useId();
  const sheetName = (id: string) => sheets.data?.find((s) => s.id === id)?.name;
  const all = autos.data ?? [];
  const needle = q.trim().toLowerCase();
  const list = all.filter((a) => {
    if (a.id === editId) return true;
    if (sheetFilter && a.sheetId !== sheetFilter) return false;
    if (state !== 'all' && a.enabled !== (state === 'on')) return false;
    if (!needle) return true;
    const ctx = ctxOf(a.sheetId);
    const text = `${a.name} ${ctx ? describeAutomation(a, ctx, sheetName) : ''} ${sheetName(a.sheetId) ?? ''}`;
    return text.toLowerCase().includes(needle);
  });
  const base = `/${org}/automations`;
  const on = all.filter((a) => a.enabled).length;
  const runCount = all.reduce((n, a) => n + a.runCount, 0);
  const back = () => nav({ sheet: sheetFilter });
  const filtered = !!(sheetFilter || needle || state !== 'all');

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:px-7 sm:pt-[26px]">
      <PageHeader
        className="pb-0.5"
        crumb={
          <ListCrumb
            section="Build"
            page="Automations"
            badge={
              autos.data
                ? `${on} of ${all.length} on · ${runCount.toLocaleString('en-GB')} ${runCount === 1 ? 'run' : 'runs'} logged`
                : undefined
            }
          />
        }
        title="Automations"
        description={
          <>
            “When, if, then” rules that run on the sheets. Open a rule to edit it in place; saving
            creates a new version. The stages items move through show in{' '}
            <Link href={`/${org}/workflow`} className="text-ink underline underline-offset-4">
              Workflow
            </Link>
            .
          </>
        }
        actions={
          perms.canEdit ? (
            <>
              {perms.isAdmin ? <RunDateChecks org={org} orgId={orgId} /> : null}
              <Button asChild variant="outline">
                <Link href={`${base}?recipes=1${sheetFilter ? `&sheet=${sheetFilter}` : ''}`}>
                  <BookOpen aria-hidden /> Start from a recipe
                </Link>
              </Button>
              <Button asChild>
                <Link href={`${base}?new=1${sheetFilter ? `&sheet=${sheetFilter}` : ''}`}>
                  <Plus aria-hidden /> New automation
                </Link>
              </Button>
            </>
          ) : null
        }
      />
      {!perms.canEdit ? (
        <p className="text-muted-foreground m-0 text-sm">
          You can see automations and their runs. Ask an editor or admin to change them.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <ListSearch
          value={q}
          onChange={setQ}
          label="Search automations"
          placeholder="Search automations…"
        />
        <label className="flex min-w-0 flex-1 items-center sm:flex-none">
          <span className="sr-only">Sheet</span>
          <select
            className={toolbarSelectClass}
            value={sheetFilter ?? ''}
            onChange={(e) => nav({ sheet: e.target.value || null })}
          >
            <option value="">All sheets</option>
            {(sheets.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <Segmented<'all' | 'on' | 'off'>
          label="State"
          value={state}
          onChange={setState}
          options={[
            { id: 'all', label: 'All' },
            { id: 'on', label: 'On' },
            { id: 'off', label: 'Off' },
          ]}
        />
      </div>
      {autos.isError ? (
        <ErrorBox text="Automations could not be loaded." retry={() => void autos.refetch()} />
      ) : autos.isPending ? (
        <ListSkeleton />
      ) : (
        <ListFrame label="Automations" header={<AutomationTableHeader />}>
          {creating && perms.canEdit ? (
            <NewAutomationRow
              title={params.get('recipe') ? 'New automation from a recipe' : 'New automation'}
              onClose={back}
            >
              <BuilderPanel {...props} perms={perms} onDone={back} />
            </NewAutomationRow>
          ) : null}
          <AutomationRows
            org={org}
            orgId={orgId}
            automations={list}
            perms={perms}
            ctxOf={ctxOf}
            sheetName={sheetName}
            timeZone={props.timeZone}
            openId={creating ? null : editId}
            onOpen={(id) => nav({ sheet: sheetFilter, edit: id })}
            editor={
              editId && !creating ? <BuilderPanel {...props} perms={perms} onDone={back} /> : null
            }
          />
          {list.length === 0 && !creating ? (
            <li className="text-muted-foreground p-6 text-center text-[14px]">
              {filtered
                ? 'No automations match.'
                : `No automations yet. ${perms.canEdit ? 'Start from a recipe or build a new one.' : ''}`}
            </li>
          ) : null}
        </ListFrame>
      )}
      <PanelCard
        title="Run log"
        headingId={runsHeading}
        aside={
          <Link
            href={`${base}?tab=runs${sheetFilter ? `&sheet=${sheetFilter}` : ''}`}
            className="text-ink underline underline-offset-4"
          >
            Open the run log
          </Link>
        }
      >
        {latest.isError ? (
          <div className="p-3">
            <ErrorBox text="The run log could not be loaded." retry={() => void latest.refetch()} />
          </div>
        ) : latest.isPending ? (
          <div className="p-3">
            <ListSkeleton />
          </div>
        ) : latest.data.length === 0 ? (
          <p className="text-muted-foreground m-0 px-4 py-6 text-[13.5px]">
            No runs yet. Every run is audited with “automation” as the actor and listed here.
          </p>
        ) : (
          <RunTable
            runs={latest.data.slice(0, LATEST_RUNS)}
            org={org}
            timeZone={props.timeZone}
            label="Latest runs"
          />
        )}
      </PanelCard>
    </main>
  );
}

/** Runs shown under the list; the run log has the rest. */
const LATEST_RUNS = 8;

// ───────────────────────── recipes ─────────────────────────

function RecipeGallery(props: ScreenProps & { perms: ListPermissions }) {
  const params = useSearchParams();
  const nav = useNav();
  const sheets = useWorkspaceSheets(props.orgId);
  const [sheetId, setSheetId] = useState(params.get('sheet') ?? '');
  const [recipeId, setRecipeId] = useState(RECIPES[0]?.id ?? '');
  const sheetSelect = useId();
  if (!props.perms.canEdit) return <ReadOnly org={props.org} />;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:px-7 sm:pt-[26px]">
      <PageHeader
        className="pb-0.5"
        crumb={<ListCrumb section="Build" page="Automations" badge={`${RECIPES.length} recipes`} />}
        title="Start from a recipe"
        description="Pick a recipe and a sheet. Next you choose which fields of the sheet the recipe uses, then adjust it in the builder."
      />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={sheetSelect} className="text-ink-3 text-[13.5px] font-medium">
          Sheet
        </label>
        <select
          id={sheetSelect}
          className={toolbarSelectClass}
          value={sheetId}
          onChange={(e) => setSheetId(e.target.value)}
        >
          <option value="">Choose a sheet</option>
          {(sheets.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 text-[14px] font-semibold">Recipe</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RECIPES.map((r) => (
            <label
              key={r.id}
              className={cn(
                'border-line hover:bg-subtle has-[:focus-visible]:outline-focus flex cursor-pointer items-start gap-3 rounded-[10px] border bg-white p-4 has-[:focus-visible]:outline-2',
                recipeId === r.id && 'border-ink ring-ink ring-1',
              )}
            >
              <span
                aria-hidden
                className="border-line text-ink-3 grid size-7 shrink-0 place-items-center rounded-full border bg-white"
              >
                <Zap className="size-3.5" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[14px] font-medium">{r.title}</span>
                <span className="text-muted-foreground text-[12.5px]">
                  Uses{' '}
                  {Object.keys(r.roles)
                    .map((role) => `${/^[aeiou]/.test(role) ? 'an' : 'a'} ${role} field`)
                    .join(', ')}
                </span>
              </span>
              <input
                type="radio"
                name="recipe"
                className="accent-ink mt-1"
                checked={recipeId === r.id}
                onChange={() => setRecipeId(r.id)}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!sheetId || !recipeId}
          onClick={() => nav({ recipe: recipeId, sheet: sheetId })}
        >
          Continue
        </Button>
        <Button asChild variant="outline">
          <Link href={`/${props.org}/automations`}>Cancel</Link>
        </Button>
      </div>
    </main>
  );
}

function RoleMappingStep({
  recipe,
  ctx,
  head,
  onDone,
  onCancel,
}: {
  recipe: Recipe;
  ctx: Ctx;
  head: React.ReactNode;
  onDone(mapping: RoleMapping): void;
  onCancel(): void;
}) {
  const candidates = roleCandidates(recipe, ctx);
  const [mapping, setMapping] = useState<RoleMapping>(() => defaultMapping(recipe, ctx));
  return (
    <div className="flex flex-col gap-2.5">
      <section
        aria-labelledby="map-roles"
        className="border-line flex flex-col rounded-lg border bg-white px-3.5 py-1.5"
      >
        {head}
        <div className="border-soft flex flex-col gap-0.5 border-b py-2.5">
          <h3 id="map-roles" className="m-0 text-[14px] font-semibold">
            Choose the fields this recipe uses
          </h3>
          <p className="text-muted-foreground m-0 text-[12.5px]">{recipe.title}</p>
        </div>
        {Object.keys(recipe.roles).map((role) => {
          const list = candidates[role] ?? [];
          const id = `role-${role}`;
          return (
            <div
              key={role}
              className="border-soft flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b py-2 last:border-b-0"
            >
              <label
                htmlFor={id}
                className="text-muted-foreground w-full text-[12px] font-medium sm:w-24"
              >
                {role} field
              </label>
              <select
                id={id}
                className={selectClass}
                value={mapping[role] ?? ''}
                onChange={(e) => setMapping((m) => ({ ...m, [role]: e.target.value || null }))}
              >
                <option value="">{list.length ? 'Choose a field' : 'No field fits'}</option>
                {list.map((f) => (
                  <option key={f.id} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </select>
              {list.length === 0 ? (
                <span className="text-muted-foreground text-[12.5px]">
                  This sheet has no {recipe.roles[role]!.join(' or ')} field. Add one, or adjust the
                  automation in the builder.
                </span>
              ) : null}
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2 py-2.5 sm:pl-[104px]">
          <Button type="button" onClick={() => onDone(mapping)}>
            Continue in the builder
          </Button>
        </div>
      </section>
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────── builder ─────────────────────────

function ReadOnly({ org }: { org: string }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-7 sm:pt-[26px]">
      <h1>Automations</h1>
      <p className="text-muted-foreground m-0">
        Viewers cannot change automations. Ask an editor or admin.
      </p>
      <div>
        <Button asChild variant="outline">
          <Link href={`/${org}/automations`}>Back to automations</Link>
        </Button>
      </div>
    </main>
  );
}

function useBuilderSheet(sheetId: string | null) {
  return useQuery({
    queryKey: ['builder-sheet', sheetId],
    enabled: !!sheetId,
    queryFn: async () => {
      const d = await fetchSheetData(createClient(), sheetId!);
      if (!d) throw new Error('This sheet no longer exists or you cannot see it.');
      return d;
    },
    staleTime: 30_000,
  });
}

/** The builder in place (in the new row or the edited row): the sheet row, then the recipe mapping or the builder. */
function BuilderPanel(props: ScreenProps & { perms: ListPermissions; onDone(): void }) {
  const { org, orgId, perms } = props;
  const params = useSearchParams();
  const nav = useNav();
  const qc = useQueryClient();
  const editId = params.get('edit');
  const recipe = recipeById(params.get('recipe'));
  const autos = useAutomations(orgId);
  const editing = editId ? autos.data?.find((a) => a.id === editId) : undefined;
  const sheetId = editing?.sheetId ?? params.get('sheet') ?? null;
  const sheets = useWorkspaceSheets(orgId);
  const fields = useWorkspaceFields(orgId);
  const titles = useJobTitles(orgId);
  const data = useBuilderSheet(sheetId);
  const [mapping, setMapping] = useState<RoleMapping | null>(null);
  const sheetRowId = useId();

  const ctx = useMemo(() => {
    if (!data.data || !fields.data) return null;
    const base = sheetCtx(data.data, {
      now: new Date(),
      timeZone: props.timeZone,
      userId: props.userId,
      isAdmin: perms.isAdmin,
      newId: (p) => `${p}${Math.random().toString(36).slice(2, 8)}`,
    });
    return withWorkspaceFields(base, fields.data);
  }, [data.data, fields.data, props.timeZone, props.userId, perms.isAdmin]);

  const roleHolders = useMemo(() => {
    const names = new Map(
      (data.data?.jobRoles ?? []).map((r) => [r.id, r.name.trim().toLowerCase()]),
    );
    return (roleId: string) =>
      (titles.data ?? [])
        .filter((m) => m.job_title && m.job_title.trim().toLowerCase() === names.get(roleId))
        .map((m) => m.user_id);
  }, [data.data, titles.data]);

  const sheetName = sheets.data?.find((s) => s.id === sheetId)?.name;
  // The first row: the sheet it runs on. A new automation picks it here; a saved one stays on its sheet.
  const head = (
    <div className="border-soft flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b py-2 last:border-b-0">
      <label
        htmlFor={editing ? undefined : sheetRowId}
        className="text-muted-foreground w-full text-[12px] font-medium sm:w-24"
      >
        Sheet
      </label>
      {editing ? (
        <span className="text-ink text-[13.5px]">{sheetName ?? 'Archived sheet'}</span>
      ) : (
        <select
          id={sheetRowId}
          className={selectClass}
          value={sheetId ?? ''}
          onChange={(e) =>
            nav({
              new: params.get('recipe') ? null : '1',
              recipe: params.get('recipe'),
              sheet: e.target.value || null,
            })
          }
        >
          <option value="">Choose a sheet</option>
          {(sheets.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
  const frame = (children: React.ReactNode) => (
    <div className="flex flex-col gap-2.5">
      <div className="border-line flex flex-col rounded-lg border bg-white px-3.5 py-1.5">
        {head}
        {children}
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={props.onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
  const note = (text: string) => (
    <p className="text-muted-foreground m-0 py-2.5 text-[13.5px]">{text}</p>
  );

  if (editId && autos.isPending) return <ListSkeleton />;
  if (editId && !editing) return frame(note('This automation no longer exists.'));
  if (editing?.locked && !perms.isAdmin)
    return frame(
      note(
        'This automation is locked. Only owners and admins can change it. Duplicate it to make your own.',
      ),
    );
  if (!sheetId) return frame(note('Choose the sheet it runs on to build the rest.'));
  if (data.isError || fields.isError)
    return <ErrorBox text="The sheet could not be loaded." retry={() => void data.refetch()} />;
  if (!ctx || !data.data || !sheets.data) return <ListSkeleton />;
  if (recipe && !mapping)
    return (
      <RoleMappingStep
        recipe={recipe}
        ctx={ctx}
        head={head}
        onDone={setMapping}
        onCancel={props.onDone}
      />
    );
  const initial: AutomationDraft = editing
    ? {
        name: editing.name,
        trigger: editing.trigger,
        conditions: editing.conditions,
        actions: editing.actions,
      }
    : recipe && mapping
      ? applyRecipe(recipe, mapping)
      : emptyDraft(ctx);
  return (
    <AutomationBuilder
      key={`${editId ?? 'new'}:${sheetId}:${recipe?.id ?? ''}:${JSON.stringify(mapping)}`}
      org={org}
      ctx={ctx}
      items={data.data.items}
      sheets={sheets.data as SheetRef[]}
      roleHolders={roleHolders}
      initial={initial}
      automationId={editing?.id ?? null}
      version={editing?.version}
      head={head}
      source={recipe ? recipeSource(recipe.id) : 'custom'}
      onSaved={async () => {
        await qc.invalidateQueries({ queryKey: automationsKey(orgId) });
        props.onDone();
      }}
      onCancel={props.onDone}
    />
  );
}
