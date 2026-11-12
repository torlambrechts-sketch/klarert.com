'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { AutomationTabs } from './tabs';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatDateTime } from '@/engine/fields/helpers';
import { inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ErrorBox, ListSkeleton } from './states';
import { OutcomeChip, outcomeLabel } from './outcome';
import {
  RUN_OUTCOMES,
  RUN_PAGE,
  useAutomations,
  useRuns,
  useWorkspaceSheets,
  type RunRow,
} from './queries';

// The run log (docs/04 §10, ?tab=runs): filters by sheet, automation and outcome (kept in the URL), one row per run
// with time, automation, sheet, a link to the item, an outcome chip with text and the detail; each row expands to
// its steps.

const selectClass = cn(inputClass, 'h-9 w-auto max-w-full pr-6');

export function RunLog(props: { org: string; orgId: string; timeZone: string }) {
  const { org, orgId } = props;
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const filters = {
    sheetId: params.get('sheet'),
    automationId: params.get('automation'),
    outcome: params.get('outcome'),
  };
  const runs = useRuns(orgId, filters);
  const sheets = useWorkspaceSheets(orgId);
  const autos = useAutomations(orgId);
  const setFilter = (key: string, value: string) => {
    const q = new URLSearchParams(params.toString());
    q.set('tab', 'runs');
    if (value) q.set(key, value);
    else q.delete(key);
    router.replace(`${path}?${q.toString()}`);
  };
  const autoChoices = (autos.data ?? []).filter(
    (a) => !filters.sheetId || a.sheetId === filters.sheetId,
  );
  const filtered = !!(filters.sheetId || filters.automationId || filters.outcome);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:px-7 sm:pt-[26px]">
      <PageHeader
        title="Run log"
        description="Every run of every automation, newest first, with what each step did."
      />
      <AutomationTabs org={org} active="runs" />
      <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Filters">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground font-medium">Sheet</span>
          <select
            className={selectClass}
            value={filters.sheetId ?? ''}
            onChange={(e) => setFilter('sheet', e.target.value)}
          >
            <option value="">All sheets</option>
            {(sheets.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground font-medium">Automation</span>
          <select
            className={selectClass}
            value={filters.automationId ?? ''}
            onChange={(e) => setFilter('automation', e.target.value)}
          >
            <option value="">All automations</option>
            {autoChoices.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground font-medium">Outcome</span>
          <select
            className={selectClass}
            value={filters.outcome ?? ''}
            onChange={(e) => setFilter('outcome', e.target.value)}
          >
            <option value="">All outcomes</option>
            {RUN_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {outcomeLabel(o)}
              </option>
            ))}
          </select>
        </label>
        {filtered ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => router.replace(`${path}?tab=runs`)}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
      {runs.isError ? (
        <ErrorBox text="The run log could not be loaded." retry={() => void runs.refetch()} />
      ) : runs.isPending ? (
        <ListSkeleton />
      ) : runs.data.length === 0 ? (
        <div className="border-line rounded-[var(--radius-card)] border border-dashed bg-white p-6">
          <p className="text-muted-foreground m-0">
            {filtered
              ? 'No runs match these filters.'
              : 'No automation runs yet. Every run will be listed here with its steps.'}
          </p>
        </div>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Runs">
            {runs.data.map((r) => (
              <RunItem key={r.id} run={r} org={org} timeZone={props.timeZone} />
            ))}
          </ul>
          {runs.data.length === RUN_PAGE ? (
            <p className="text-muted-foreground m-0 text-xs">
              Showing the latest {RUN_PAGE} runs. Filter to see older ones.
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}

function detailOf(r: RunRow): string {
  if (r.detail) return r.detail;
  return r.steps.map((s) => s.summary).join('; ');
}

function RunItem({ run, org, timeZone }: { run: RunRow; org: string; timeZone: string }) {
  const [open, setOpen] = useState(false);
  const stepsId = `run-${run.id}-steps`;
  return (
    <li className="border-line flex flex-col gap-2 rounded-[var(--radius-card)] border bg-white p-3">
      <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm md:grid-cols-[150px_minmax(0,1.2fr)_minmax(0,1fr)_auto]">
        <span className="text-muted-foreground font-mono text-xs md:pt-0.5">
          {formatDateTime(run.startedAt, timeZone)}
        </span>
        <span className="min-w-0">
          <span className="font-semibold break-words">
            {run.automationName ?? 'Deleted automation'}
          </span>
          <span className="text-muted-foreground block text-xs">
            {run.sheetName ?? 'Deleted sheet'}
            {run.depth > 0 ? ` · caused by another automation (depth ${run.depth})` : ''}
          </span>
        </span>
        <span className="min-w-0">
          {run.itemId && run.sheetId && run.itemDisplayId ? (
            <Link
              className="hover:underline"
              href={`/${org}/s/${run.sheetId}?item=${encodeURIComponent(run.itemDisplayId)}`}
            >
              <span className="font-mono text-xs">{run.itemDisplayId}</span> {run.itemName}
            </Link>
          ) : (
            <span className="text-muted-foreground">Item no longer available</span>
          )}
        </span>
        <span className="flex items-start gap-2 md:justify-end">
          <OutcomeChip outcome={run.status} />
        </span>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-muted-foreground m-0 min-w-0 flex-1 text-[13px] break-words">
          {detailOf(run) || 'No steps.'}
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-expanded={open}
          aria-controls={stepsId}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          {run.steps.length === 1 ? '1 step' : `${run.steps.length} steps`}
        </Button>
      </div>
      {open ? (
        <ol id={stepsId} className="m-0 flex flex-col gap-1.5 pl-5 text-sm" aria-label="Steps">
          {run.steps.length === 0 ? (
            <li className="text-muted-foreground">No steps ran.</li>
          ) : (
            run.steps.map((s, i) => (
              <li key={i}>
                <span className="flex flex-wrap items-center gap-2">
                  <span>{s.summary}</span>
                  <OutcomeChip outcome={s.outcome} />
                  {s.message ? <span className="text-muted-foreground">{s.message}</span> : null}
                </span>
              </li>
            ))
          )}
        </ol>
      ) : null}
    </li>
  );
}
