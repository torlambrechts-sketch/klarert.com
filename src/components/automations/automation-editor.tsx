'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { sheetCtx, type SheetData } from '@/engine/sheet-data';
import type { Ctx } from '@/engine/types';
import { inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { fetchSheetData } from '@/lib/sheet-query';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { ListPermissions } from './automation-list';
import { AutomationBuilder } from './builder';
import {
  automationsKey,
  useAutomations,
  useJobTitles,
  useWorkspaceFields,
  useWorkspaceSheets,
  type SheetRef,
} from './queries';
import { ErrorBox, ListSkeleton } from './states';

// The automation builder with everything it needs (docs/04 §10): the sheet it runs on read once, the workspace's
// fields and job titles, a recipe's field mapping first when it starts from a recipe, then the builder for a new
// automation or a saved one. Used in place on the Automations page and in the Design tab's side window (docs/05 §3.8),
// so both edit through the same commands with the same checks.

const selectClass = cn(inputClass, 'select-chevron h-8 w-auto max-w-[280px] text-14 shadow-none');

function useBuilderSheet(sheetId: string | null, given: SheetData | undefined) {
  return useQuery({
    queryKey: ['builder-sheet', sheetId],
    enabled: !!sheetId && !given,
    queryFn: async () => {
      const d = await fetchSheetData(createClient(), sheetId!);
      if (!d) throw new Error('This sheet no longer exists or you cannot see it.');
      return d;
    },
    staleTime: 30_000,
  });
}

export interface AutomationEditorProps {
  org: string;
  orgId: string;
  timeZone: string;
  userId: string;
  perms: ListPermissions;
  /** The automation to edit, or null for a new one. */
  editId: string | null;
  /** The sheet it runs on (a saved automation's own sheet wins). */
  sheetId: string | null;
  recipe: Recipe | null;
  /** The first row of the builder (the sheet it runs on). */
  head: React.ReactNode;
  /** The sheet's data when the caller has it already (the sheet page): no second read of its items. */
  sheetData?: SheetData;
  /** A new automation's starting draft (the Design tab's "+ Add output" kinds); default an empty draft. */
  startWith?: (ctx: Ctx) => AutomationDraft;
  onDone(): void;
  onSaved?(id: string): void;
}

export function AutomationEditor(props: AutomationEditorProps) {
  const { org, orgId, perms, editId, recipe, head } = props;
  const qc = useQueryClient();
  const autos = useAutomations(orgId);
  const editing = editId ? autos.data?.find((a) => a.id === editId) : undefined;
  const sheetId = editing?.sheetId ?? props.sheetId ?? null;
  const sheets = useWorkspaceSheets(orgId);
  const fields = useWorkspaceFields(orgId);
  const titles = useJobTitles(orgId);
  const given =
    props.sheetData && props.sheetData.sheet.id === sheetId ? props.sheetData : undefined;
  const loaded = useBuilderSheet(sheetId, given);
  const data = given ?? loaded.data;
  const [mapping, setMapping] = useState<RoleMapping | null>(null);

  const ctx = useMemo(() => {
    if (!data || !fields.data) return null;
    const base = sheetCtx(data, {
      now: new Date(),
      timeZone: props.timeZone,
      userId: props.userId,
      isAdmin: perms.isAdmin,
      newId: (p) => `${p}${Math.random().toString(36).slice(2, 8)}`,
    });
    return withWorkspaceFields(base, fields.data);
  }, [data, fields.data, props.timeZone, props.userId, perms.isAdmin]);

  const roleHolders = useMemo(() => {
    const names = new Map((data?.jobRoles ?? []).map((r) => [r.id, r.name.trim().toLowerCase()]));
    return (roleId: string) =>
      (titles.data ?? [])
        .filter((m) => m.job_title && m.job_title.trim().toLowerCase() === names.get(roleId))
        .map((m) => m.user_id);
  }, [data, titles.data]);

  const frame = (children: React.ReactNode) => (
    <div className="flex flex-col gap-2.5">
      <div className="border-line bg-surface flex flex-col rounded-lg border px-3.5 py-1.5">
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
  const note = (text: string) => <p className="text-muted-foreground text-14 m-0 py-2.5">{text}</p>;

  if (editId && autos.isPending) return <ListSkeleton />;
  if (editId && !editing) return frame(note('This automation no longer exists.'));
  if (editing?.locked && !perms.isAdmin)
    return frame(
      note(
        'This automation is locked. Only owners and admins can change it. Duplicate it to make your own.',
      ),
    );
  if (!sheetId) return frame(note('Choose the sheet it runs on to build the rest.'));
  if (loaded.isError || fields.isError)
    return <ErrorBox text="The sheet could not be loaded." retry={() => void loaded.refetch()} />;
  if (!ctx || !data || !sheets.data) return <ListSkeleton />;
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
      : (props.startWith?.(ctx) ?? emptyDraft(ctx));
  return (
    <AutomationBuilder
      key={`${editId ?? 'new'}:${sheetId}:${recipe?.id ?? ''}:${JSON.stringify(mapping)}`}
      org={org}
      ctx={ctx}
      items={data.items}
      sheets={sheets.data as SheetRef[]}
      roleHolders={roleHolders}
      initial={initial}
      automationId={editing?.id ?? null}
      version={editing?.version}
      head={head}
      source={recipe ? recipeSource(recipe.id) : 'custom'}
      onSaved={async (id) => {
        await qc.invalidateQueries({ queryKey: automationsKey(orgId) });
        props.onSaved?.(id);
        props.onDone();
      }}
      onCancel={props.onDone}
    />
  );
}

/** A recipe's roles mapped to this sheet's fields, before the builder opens (docs/04 §11). */
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
        className="border-line bg-surface flex flex-col rounded-lg border px-3.5 py-1.5"
      >
        {head}
        <div className="border-soft flex flex-col gap-0.5 border-b py-2.5">
          <h3 id="map-roles" className="text-14 m-0 font-semibold">
            Choose the fields this recipe uses
          </h3>
          <p className="text-muted-foreground text-13 m-0">{recipe.title}</p>
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
                className="text-muted-foreground text-12 w-full font-medium sm:w-24"
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
                <span className="text-muted-foreground text-13">
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
