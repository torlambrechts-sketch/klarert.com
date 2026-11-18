'use client';

import { useState } from 'react';
import Link from 'next/link';
import { HeadCard, PageHeader } from '@/components/shell/page-header';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { stepLine } from '@/engine/automations/chain';
import { formatDateTime } from '@/engine/fields/helpers';
import { inputClass } from '@/components/fields/shared';
import { ListCrumb } from '@/components/shell/data-list';
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

// The run log (docs/04 §10, ?tab=runs) in the board design's run table: filters by sheet, automation and outcome
// (kept in the URL), one row per run with time, automation, sheet, a link to the item, an outcome chip with text and
// what it did; each run opens to its steps in place. The same table shows the latest runs under the list.

const selectClass = cn(
  inputClass,
  'select-chevron h-[40px] w-auto max-w-full text-14 shadow-none sm:min-w-[170px]',
);

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
    <main className="flex w-full flex-col gap-4 px-4 pt-5 pb-8 sm:px-12 sm:pt-[26px]">
      <PageHeader
        className="pb-0.5"
        crumb={
          <ListCrumb
            section="Build"
            page="Automations"
            badge={runs.data ? `${runs.data.length} runs shown` : undefined}
          />
        }
        title="Run log"
        description={
          <>
            Every run of every automation, newest first, with what each step did. Every run is
            audited with “automation” as the actor.{' '}
            <Link href={`/${org}/automations`} className="underline underline-offset-4">
              Back to automations
            </Link>
          </>
        }
      />
      <HeadCard>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
          <label className="flex min-w-0 items-center">
            <span className="sr-only">Sheet</span>
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
          <label className="flex min-w-0 items-center">
            <span className="sr-only">Automation</span>
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
          <label className="flex min-w-0 items-center">
            <span className="sr-only">Outcome</span>
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
          <div className="border-line bg-surface rounded-lg border border-dashed p-6">
            <p className="text-muted-foreground m-0">
              {filtered
                ? 'No runs match these filters.'
                : 'No automation runs yet. Every run will be listed here with its steps.'}
            </p>
          </div>
        ) : (
          <>
            <div className="border-line bg-surface overflow-hidden rounded-lg border">
              <RunTable runs={runs.data} org={org} timeZone={props.timeZone} label="Runs" />
            </div>
            {runs.data.length === RUN_PAGE ? (
              <p className="text-muted-foreground text-12 m-0">
                Showing the latest {RUN_PAGE} runs. Filter to see older ones.
              </p>
            ) : null}
          </>
        )}
      </HeadCard>
    </main>
  );
}

function detailOf(r: RunRow): string {
  if (r.detail) return r.detail;
  return r.steps.map((s) => s.summary).join('; ');
}

/** The run table: time, automation, sheet, item, outcome and what it did, each run opening to its steps. */
export function RunTable({
  runs,
  org,
  timeZone,
  label,
}: {
  runs: RunRow[];
  org: string;
  timeZone: string;
  label: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table aria-label={label} className="text-13 w-full min-w-[860px] border-collapse">
        <thead>
          <tr>
            {['Time', 'Automation', 'Sheet', 'Item', 'Outcome', 'What it did'].map((h) => (
              <th
                key={h}
                scope="col"
                className="border-soft text-muted-foreground bg-surface text-12 border-b px-3.5 py-2.5 text-left font-normal whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <RunItem key={r.id} run={r} org={org} timeZone={timeZone} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const td = 'border-soft text-ink border-b px-3.5 py-2.5 align-top group-last:border-b-0';

function RunItem({ run, org, timeZone }: { run: RunRow; org: string; timeZone: string }) {
  const [open, setOpen] = useState(false);
  const stepsId = `run-${run.id}-steps`;
  return (
    <tr className="group hover:[&>td]:bg-row-hover">
      <td className={cn(td, 'text-muted-foreground text-12 font-mono whitespace-nowrap')}>
        {formatDateTime(run.startedAt, timeZone)}
      </td>
      <td className={cn(td, 'min-w-[180px]')}>
        <span className="text-ink break-words">{run.automationName ?? 'Deleted automation'}</span>
        {run.depth > 0 ? (
          <span className="text-muted-foreground text-12 block">
            Caused by another automation (depth {run.depth})
          </span>
        ) : null}
      </td>
      <td className={cn(td, 'min-w-[120px]')}>{run.sheetName ?? 'Deleted sheet'}</td>
      <td className={cn(td, 'min-w-[150px]')}>
        {run.itemId && run.sheetId && run.itemDisplayId ? (
          <Link
            className="hover:underline"
            href={`/${org}/s/${run.sheetId}?item=${encodeURIComponent(run.itemDisplayId)}`}
          >
            <span className="text-12 font-mono">{run.itemDisplayId}</span> {run.itemName}
          </Link>
        ) : (
          <span className="text-muted-foreground">Item no longer available</span>
        )}
      </td>
      <td className={td}>
        <OutcomeChip outcome={run.status} />
      </td>
      <td className={cn(td, 'min-w-[240px]')}>
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
          <span className="min-w-0 flex-1 break-words">{detailOf(run) || 'No steps.'}</span>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={stepsId}
            onClick={() => setOpen((o) => !o)}
            className="text-muted-foreground hover:bg-soft hover:text-ink focus-visible:outline-focus text-13 -my-1 inline-flex h-7 items-center gap-1 rounded-md px-1.5 font-medium whitespace-nowrap focus-visible:outline-2"
          >
            {open ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden />
            )}
            {run.steps.length === 1 ? '1 step' : `${run.steps.length} steps`}
          </button>
        </div>
        {open ? (
          <ol id={stepsId} className="m-0 mt-2 flex flex-col gap-1.5 pl-5" aria-label="Steps">
            {run.steps.length === 0 ? (
              <li className="text-muted-foreground">No steps ran.</li>
            ) : (
              run.steps.map((s, i) => (
                <li key={i}>
                  <span className="flex flex-wrap items-center gap-2">
                    {/* test mode (docs/04 §14): "Would notify Maria" */}
                    <span>{s.outcome === 'test' ? stepLine(s) : s.summary}</span>
                    <OutcomeChip outcome={s.outcome} />
                    {s.message ? <span className="text-muted-foreground">{s.message}</span> : null}
                  </span>
                </li>
              ))
            )}
          </ol>
        ) : null}
      </td>
    </tr>
  );
}
