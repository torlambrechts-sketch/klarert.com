'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { AutomationTabs } from './tabs';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CalendarClock, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { runDateChecksNowAction } from '@/app/[org]/automations/actions';
import {
  applyRecipe,
  defaultMapping,
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
import { AutomationList, type ListPermissions } from './automation-list';
import { AutomationBuilder } from './builder';
import {
  automationsKey,
  useAutomations,
  useDirectory,
  useJobTitles,
  useWorkspaceFields,
  useWorkspaceSheets,
  type SheetRef,
} from './queries';
import { RunLog } from './run-log';
import { ErrorBox, ListSkeleton } from './states';

// The Automations page (docs/04 §10, docs/05 §4): all automations or one sheet's (?sheet=), the builder (?new=1,
// ?edit=<id>), recipes (?recipes=1, then ?recipe=<id>&sheet=<id>) and the run log (?tab=runs). Owners and admins can
// "Run date checks now": the scheduler's own code for this workspace (docs/04 §8).

export interface ScreenProps {
  org: string;
  orgId: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  timeZone: string;
  userId: string;
}

const selectClass = cn(inputClass, 'h-9 w-auto max-w-full pr-6');

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
  if (params.get('edit') || params.get('new') || params.get('recipe'))
    return <BuilderScreen {...props} perms={perms} />;
  if (params.get('recipes')) return <RecipeGallery {...props} perms={perms} />;
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
  const autos = useAutomations(orgId);
  const sheets = useWorkspaceSheets(orgId);
  const ctxOf = useSummaryCtx(orgId, props.timeZone, props.userId);
  const list = (autos.data ?? []).filter((a) => !sheetFilter || a.sheetId === sheetFilter);
  const sheetName = (id: string) => sheets.data?.find((s) => s.id === id)?.name;
  const base = `/${org}/automations`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:px-7 sm:pt-[26px]">
      <PageHeader
        title="Automations"
        description="When something happens on a sheet, if conditions hold, then actions run. Every run is logged."
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
      <AutomationTabs org={org} active="all" />
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground font-medium">Sheet</span>
        <select
          className={selectClass}
          value={sheetFilter ?? ''}
          onChange={(e) => nav({ tab: 'all', sheet: e.target.value || null })}
        >
          <option value="">All sheets</option>
          {(sheets.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {!perms.canEdit ? (
        <p className="text-muted-foreground m-0 text-sm">
          You can see automations and their runs. Ask an editor or admin to change them.
        </p>
      ) : null}
      {autos.isError ? (
        <ErrorBox text="Automations could not be loaded." retry={() => void autos.refetch()} />
      ) : autos.isPending ? (
        <ListSkeleton />
      ) : list.length === 0 ? (
        <div className="border-line rounded-xl border border-dashed bg-white p-6">
          <p className="text-muted-foreground m-0">
            {sheetFilter ? 'No automations on this sheet yet.' : 'No automations yet.'}{' '}
            {perms.canEdit ? 'Start from a recipe or build a new one.' : ''}
          </p>
        </div>
      ) : (
        <AutomationList
          org={org}
          orgId={orgId}
          automations={list}
          perms={perms}
          ctxOf={ctxOf}
          sheetName={sheetFilter ? undefined : sheetName}
          timeZone={props.timeZone}
          editHref={(a) => `${base}?edit=${a.id}`}
        />
      )}
    </main>
  );
}

// ───────────────────────── recipes ─────────────────────────

function RecipeGallery(props: ScreenProps & { perms: ListPermissions }) {
  const params = useSearchParams();
  const nav = useNav();
  const sheets = useWorkspaceSheets(props.orgId);
  const [sheetId, setSheetId] = useState(params.get('sheet') ?? '');
  const [recipeId, setRecipeId] = useState(RECIPES[0]?.id ?? '');
  if (!props.perms.canEdit) return <ReadOnly org={props.org} />;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-7 sm:pt-[26px]">
      <PageHeader
        crumb={
          <Link href={`/${props.org}/automations`} className="hover:text-ink">
            Automations
          </Link>
        }
        title="Start from a recipe"
        description="Pick a recipe and a sheet. Next you choose which fields of the sheet the recipe uses, then adjust it in the builder."
      />
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Sheet</span>
        <select
          className={selectClass}
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
      </label>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold">Recipe</legend>
        {RECIPES.map((r) => (
          <label
            key={r.id}
            className={cn(
              'border-line flex cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border bg-white p-3',
              recipeId === r.id && 'border-ink',
            )}
          >
            <input
              type="radio"
              name="recipe"
              className="mt-1"
              checked={recipeId === r.id}
              onChange={() => setRecipeId(r.id)}
            />
            <span className="flex flex-col">
              <span className="font-semibold">{r.title}</span>
              <span className="text-muted-foreground text-xs">
                Uses{' '}
                {Object.keys(r.roles)
                  .map((role) => `a ${role} field`)
                  .join(', ')}
              </span>
            </span>
          </label>
        ))}
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
  onDone,
  onCancel,
}: {
  recipe: Recipe;
  ctx: Ctx;
  onDone(mapping: RoleMapping): void;
  onCancel(): void;
}) {
  const candidates = roleCandidates(recipe, ctx);
  const [mapping, setMapping] = useState<RoleMapping>(() => defaultMapping(recipe, ctx));
  return (
    <section
      aria-labelledby="map-roles"
      className="border-line flex flex-col gap-3 rounded-[var(--radius-card)] border bg-white p-4"
    >
      <h2 id="map-roles" className="m-0 text-[17px] font-extrabold">
        Choose the fields this recipe uses
      </h2>
      <p className="text-muted-foreground m-0 text-sm">{recipe.title}</p>
      <div className="flex flex-col gap-2">
        {Object.keys(recipe.roles).map((role) => {
          const list = candidates[role] ?? [];
          const id = `role-${role}`;
          return (
            <div key={role} className="flex flex-wrap items-center gap-2">
              <label htmlFor={id} className="w-40 text-sm font-semibold capitalize">
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
                <span className="text-muted-foreground text-xs">
                  This sheet has no {recipe.roles[role]!.join(' or ')} field. Add one, or adjust the
                  automation in the builder.
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => onDone(mapping)}>
          Continue in the builder
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
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

function BuilderScreen(props: ScreenProps & { perms: ListPermissions }) {
  const { org, orgId, perms } = props;
  const params = useSearchParams();
  const nav = useNav();
  const router = useRouter();
  const qc = useQueryClient();
  const editId = params.get('edit');
  const recipe = recipeById(params.get('recipe'));
  const autos = useAutomations(orgId);
  const editing = editId ? autos.data?.find((a) => a.id === editId) : undefined;
  const [chosenSheet, setChosenSheet] = useState('');
  const sheetId = editing?.sheetId ?? params.get('sheet') ?? null;
  const sheets = useWorkspaceSheets(orgId);
  const fields = useWorkspaceFields(orgId);
  const titles = useJobTitles(orgId);
  const data = useBuilderSheet(sheetId);
  const [mapping, setMapping] = useState<RoleMapping | null>(null);

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

  if (!perms.canEdit) return <ReadOnly org={org} />;
  const back = () => nav({ tab: 'all', sheet: sheetId });
  const title = editId
    ? 'Edit automation'
    : recipe
      ? 'New automation from a recipe'
      : 'New automation';

  let body: React.ReactNode;
  if (editId && autos.isPending) body = <ListSkeleton />;
  else if (editId && !editing)
    body = <p className="text-muted-foreground">This automation no longer exists.</p>;
  else if (editing?.locked && !perms.isAdmin)
    body = (
      <p className="text-muted-foreground">
        This automation is locked. Only owners and admins can change it. Duplicate it to make your
        own.
      </p>
    );
  else if (!sheetId)
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">Sheet</span>
          <select
            className={selectClass}
            value={chosenSheet}
            onChange={(e) => setChosenSheet(e.target.value)}
          >
            <option value="">Choose a sheet</option>
            {(sheets.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          disabled={!chosenSheet}
          onClick={() => nav({ new: '1', sheet: chosenSheet })}
        >
          Continue
        </Button>
      </div>
    );
  else if (data.isError || fields.isError)
    body = <ErrorBox text="The sheet could not be loaded." retry={() => void data.refetch()} />;
  else if (!ctx || !data.data || !sheets.data) body = <ListSkeleton />;
  else if (recipe && !mapping)
    body = (
      <RoleMappingStep
        recipe={recipe}
        ctx={ctx}
        onDone={setMapping}
        onCancel={() => router.back()}
      />
    );
  else {
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
    body = (
      <AutomationBuilder
        key={`${editId ?? 'new'}:${recipe?.id ?? ''}:${JSON.stringify(mapping)}`}
        org={org}
        ctx={ctx}
        items={data.data.items}
        sheets={sheets.data as SheetRef[]}
        roleHolders={roleHolders}
        initial={initial}
        automationId={editing?.id ?? null}
        source={recipe ? recipeSource(recipe.id) : 'custom'}
        onSaved={async () => {
          await qc.invalidateQueries({ queryKey: automationsKey(orgId) });
          nav({ tab: 'all', sheet: sheetId });
        }}
        onCancel={back}
      />
    );
  }

  const sheetName = sheets.data?.find((s) => s.id === sheetId)?.name;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6 sm:px-7 sm:pt-[26px]">
      <PageHeader
        crumb={
          <Link href={`/${props.org}/automations`} className="hover:text-ink">
            Automations
          </Link>
        }
        title={title}
        description={sheetName ? `On ${sheetName}` : undefined}
      />
      {body}
    </main>
  );
}
