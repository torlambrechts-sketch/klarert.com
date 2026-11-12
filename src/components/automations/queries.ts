'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Step } from '@/engine/automations';
import type { Automation, Condition, Field } from '@/engine/types';
import { FIELD_COLUMNS, toField } from '@/lib/sheet-rows';
import { createClient } from '@/lib/supabase/client';

// Reads for the Automations page, the builder, the sheet's side sheet and the item panel. All under the person's RLS
// (members read automations, runs and pauses of their workspace); writes go through the commands.

export interface AutomationSummary {
  id: string;
  sheetId: string;
  name: string;
  enabled: boolean;
  trigger: Automation['trigger'];
  conditions: Condition[];
  actions: Automation['actions'];
  source: string;
  version: number;
  locked: boolean;
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
}

export const automationsKey = (orgId: string) => ['automations', orgId] as const;

const COLUMNS =
  'id, sheet_id, name, enabled, trigger, conditions, actions, source, version, locked, run_count, last_run_at, created_at';

/** Every automation of the workspace, oldest first (the order they run in). Filter by sheet in the caller. */
export function useAutomations(orgId: string | undefined) {
  return useQuery({
    queryKey: automationsKey(orgId ?? ''),
    enabled: !!orgId,
    queryFn: async (): Promise<AutomationSummary[]> => {
      const { data, error } = await createClient()
        .from('automations')
        .select(COLUMNS)
        .eq('org_id', orgId!)
        .order('created_at')
        .order('id');
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        id: r.id,
        sheetId: r.sheet_id,
        name: r.name,
        enabled: r.enabled,
        trigger: r.trigger as Automation['trigger'],
        conditions: (r.conditions ?? []) as unknown as Condition[],
        actions: (r.actions ?? []) as Automation['actions'],
        source: r.source,
        version: r.version,
        locked: r.locked,
        runCount: r.run_count,
        lastRunAt: r.last_run_at,
        createdAt: r.created_at,
      }));
    },
    staleTime: 15_000,
  });
}

export function useRefreshAutomations(orgId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: automationsKey(orgId) });
}

export interface SheetRef {
  id: string;
  name: string;
}

/** Sheets of the workspace that are not archived, by name. */
export function useWorkspaceSheets(orgId: string | undefined) {
  return useQuery({
    queryKey: ['automation-sheets', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<SheetRef[]> => {
      const { data, error } = await createClient()
        .from('sheets')
        .select('id, name')
        .eq('org_id', orgId!)
        .is('archived_at', null)
        .order('name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

/** Every field of the workspace (create_item targets, update_linked, incoming links). */
export function useWorkspaceFields(orgId: string | undefined) {
  return useQuery({
    queryKey: ['automation-fields', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<Field[]> => {
      const { data, error } = await createClient()
        .from('fields')
        .select(FIELD_COLUMNS)
        .eq('org_id', orgId!)
        .is('archived_at', null)
        .order('position');
      if (error) throw new Error(error.message);
      return (data ?? []).map(toField);
    },
    staleTime: 60_000,
  });
}

/** Members' job titles: who holds a job role (notify jobRole:, for Test on an item). */
export function useJobTitles(orgId: string | undefined) {
  return useQuery({
    queryKey: ['automation-job-titles', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('memberships')
        .select('user_id, job_title')
        .eq('org_id', orgId!);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

/** Automations paused for one item. */
export function usePauses(itemId: string) {
  return useQuery({
    queryKey: ['automation-pauses', itemId],
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await createClient()
        .from('automation_pauses')
        .select('automation_id')
        .eq('item_id', itemId);
      if (error) throw new Error(error.message);
      return new Set((data ?? []).map((r) => r.automation_id));
    },
  });
}

export type RunOutcome = 'done' | 'partial' | 'failed' | 'stopped';
export const RUN_OUTCOMES: RunOutcome[] = ['done', 'partial', 'failed', 'stopped'];

export interface RunRow {
  id: number;
  automationId: string | null;
  automationName: string | null;
  sheetId: string | null;
  sheetName: string | null;
  itemId: string | null;
  itemDisplayId: string | null;
  itemName: string | null;
  status: string;
  detail: string;
  steps: Step[];
  depth: number;
  startedAt: string;
}

export interface RunFilters {
  sheetId: string | null;
  automationId: string | null;
  outcome: string | null;
}

export const RUN_PAGE = 100;

/** The latest runs of the workspace, newest first, filtered on the server. */
export function useRuns(orgId: string, filters: RunFilters) {
  return useQuery({
    queryKey: ['automation-runs', orgId, filters],
    queryFn: async (): Promise<RunRow[]> => {
      let q = createClient()
        .from('automation_runs')
        .select(
          'id, automation_id, sheet_id, item_id, status, detail, steps, depth, started_at, automations(name), sheets(name), items(display_id, name)',
        )
        .eq('org_id', orgId)
        .order('id', { ascending: false })
        .limit(RUN_PAGE);
      if (filters.sheetId) q = q.eq('sheet_id', filters.sheetId);
      if (filters.automationId) q = q.eq('automation_id', filters.automationId);
      if (filters.outcome) q = q.eq('status', filters.outcome);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        id: r.id,
        automationId: r.automation_id,
        automationName: r.automations?.name ?? null,
        sheetId: r.sheet_id,
        sheetName: r.sheets?.name ?? null,
        itemId: r.item_id,
        itemDisplayId: r.items?.display_id ?? null,
        itemName: r.items?.name ?? null,
        status: r.status,
        detail: r.detail,
        steps: (Array.isArray(r.steps) ? r.steps : []) as unknown as Step[],
        depth: r.depth,
        startedAt: r.started_at,
      }));
    },
    staleTime: 5_000,
  });
}
