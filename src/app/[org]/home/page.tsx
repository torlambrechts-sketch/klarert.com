import Link from 'next/link';
import { CircleCheck, Circle, Plus } from 'lucide-react';
import { FolderManager } from '@/components/sheets/folders';
import { WorkList } from '@/components/my-work/work-row';
import { Button } from '@/components/ui/button';
import { checklistDone, homeSummary, type ChecklistStepId } from '@/engine/home';
import { formatDateTime } from '@/engine/fields/helpers';
import { isAdminRole, isEditorRole, requireMember } from '@/server/auth';
import { getHome, getMyWork } from '@/server/repositories/my-work';
import { getNav } from '@/server/repositories/sheets';

export const metadata = { title: 'Home · Compliance OS' };

// Home (docs/05 §4): greeting and a one-line summary, Getting started (computed; hidden once done), Needs you,
// Next 30 days and Recent activity. Every number comes from the workspace's data.

const card =
  'border-line flex flex-col gap-3 rounded-[var(--radius-card)] border bg-white p-4 sm:p-5';

export default async function HomePage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const { workspace, role, profile } = await requireMember(org);
  const first = profile.display_name.split(/\s+/)[0];
  const [nav, home, mine] = await Promise.all([
    getNav(workspace.id),
    getHome(workspace.id, workspace.time_zone).catch(() => null),
    getMyWork(workspace.id, workspace.time_zone).catch(() => null),
  ]);
  const summary = mine ? homeSummary(mine.work, mine.today) : null;
  const canEdit = isEditorRole(role);
  const canManage = isAdminRole(role);

  const stepLink = (id: ChecklistStepId): { href: string; label: string } | null => {
    const sheet = home?.firstSheetId ? `/${org}/s/${home.firstSheetId}` : null;
    switch (id) {
      case 'sheet':
        return canEdit ? { href: `/${org}/s/new`, label: 'New sheet' } : null;
      case 'items':
        return canEdit && sheet ? { href: sheet, label: 'Open the sheet' } : null;
      case 'status':
        return canEdit && sheet ? { href: `${sheet}?view=table`, label: 'Add a field' } : null;
      case 'invite':
        return canManage ? { href: `/${org}/settings`, label: 'Invite' } : null;
      case 'automation':
        return canEdit ? { href: `/${org}/automations?new=1`, label: 'New automation' } : null;
      case 'activity':
        return home?.firstItem
          ? {
              href: `/${org}/s/${home.firstItem.sheetId}?item=${encodeURIComponent(home.firstItem.displayId)}`,
              label: 'Open an item',
            }
          : null;
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1>Good to see you, {first}</h1>
          <p className="text-muted-foreground m-0" data-testid="home-summary">
            {summary ? summary.line : 'Your work could not be loaded.'}
          </p>
        </div>
        {canEdit ? (
          <Button asChild>
            <Link href={`/${org}/s/new`}>
              <Plus aria-hidden /> New sheet
            </Link>
          </Button>
        ) : null}
      </div>

      {home && !checklistDone(home.checklist) ? (
        <section className={card} aria-labelledby="getting-started">
          <div className="flex flex-col gap-0.5">
            <h2 id="getting-started" className="text-base font-bold">
              Getting started
            </h2>
            <p className="text-muted-foreground m-0 text-sm">
              {home.checklist.filter((s) => s.done).length} of {home.checklist.length} done. This
              list goes away once every step is done.
            </p>
          </div>
          <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="checklist">
            {home.checklist.map((s) => {
              const link = s.done ? null : stepLink(s.id);
              return (
                <li key={s.id} className="flex min-h-9 items-center gap-2">
                  {s.done ? (
                    <CircleCheck className="text-good size-5 shrink-0" aria-hidden />
                  ) : (
                    <Circle className="text-muted-foreground size-5 shrink-0" aria-hidden />
                  )}
                  <span className={s.done ? 'text-muted-foreground line-through' : 'font-semibold'}>
                    {s.label}
                  </span>
                  <span className="sr-only">{s.done ? ', done' : ', to do'}</span>
                  {link ? (
                    <Link href={link.href} className="text-focus ml-auto text-sm font-semibold">
                      {link.label}
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2" aria-labelledby="needs-you">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="needs-you" className="text-base font-bold">
            Needs you{' '}
            {summary ? (
              <span className="text-muted-foreground font-semibold">({summary.needsYouCount})</span>
            ) : null}
          </h2>
          <Link href={`/${org}/my-work`} className="text-focus text-sm font-semibold">
            Open My work
          </Link>
        </div>
        {!summary ? (
          <Retry org={org} what="Your work" />
        ) : summary.needsYou.length === 0 ? (
          <p className="border-line text-muted-foreground m-0 rounded-[var(--radius-card)] border border-dashed bg-white p-4">
            Nothing is overdue, requested of you or due in the next 14 days.
          </p>
        ) : (
          <WorkList org={org} rows={summary.needsYou} label="Needs you" />
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="next-30">
        <h2 id="next-30" className="text-base font-bold">
          Next 30 days{' '}
          {summary ? (
            <span className="text-muted-foreground font-semibold">({summary.next30.length})</span>
          ) : null}
        </h2>
        {!summary ? (
          <Retry org={org} what="Your dates" />
        ) : summary.next30.length === 0 ? (
          <p className="border-line text-muted-foreground m-0 rounded-[var(--radius-card)] border border-dashed bg-white p-4">
            None of your items has a date in the next 30 days.
          </p>
        ) : (
          <WorkList org={org} rows={summary.next30} label="Next 30 days" />
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="recent">
        <h2 id="recent" className="text-base font-bold">
          Recent activity
        </h2>
        {!home ? (
          <Retry org={org} what="Recent activity" />
        ) : home.recent.length === 0 ? (
          <p className="border-line text-muted-foreground m-0 rounded-[var(--radius-card)] border border-dashed bg-white p-4">
            No activity yet. Changes to items show here.
          </p>
        ) : (
          <ol
            aria-label="Recent activity"
            className="border-line m-0 list-none overflow-hidden rounded-[var(--radius-card)] border bg-white p-0"
          >
            {home.recent.map((r) => (
              <li key={r.id} className="border-line border-t first:border-t-0">
                <Link
                  href={`/${org}/s/${r.item.sheetId}?item=${encodeURIComponent(r.item.displayId)}`}
                  className="hover:bg-soft flex flex-col gap-0.5 px-3 py-2 text-[13px] outline-offset-[-2px]"
                >
                  <span className="break-words">
                    <b>{r.who}</b> · {r.text}
                  </span>
                  <span className="text-muted-foreground font-mono text-[11.5px]">
                    {r.item.displayId} · {r.item.name} · {r.item.sheetName} ·{' '}
                    {formatDateTime(r.at, workspace.time_zone)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      {canEdit ? (
        <section className={card} aria-labelledby="folders">
          <div className="flex flex-col gap-0.5">
            <h2 id="folders" className="text-base font-bold">
              Folders
            </h2>
            <p className="text-muted-foreground m-0 text-sm">
              Folders are the sections of the side menu. A folder can be deleted once it is empty.
            </p>
          </div>
          <FolderManager
            org={org}
            folders={nav.folders.map((f) => ({
              id: f.id,
              name: f.name,
              sheetCount: f.sheets.length,
            }))}
          />
        </section>
      ) : null}
    </main>
  );
}

function Retry({ org, what }: { org: string; what: string }) {
  return (
    <div
      role="alert"
      className="border-line flex flex-col items-start gap-2 rounded-[var(--radius-card)] border bg-white p-4"
    >
      <p className="m-0">{what} could not be loaded.</p>
      <Link
        href={`/${org}/home`}
        className="border-line rounded-md border px-3 py-1.5 text-sm font-semibold"
      >
        Retry
      </Link>
    </div>
  );
}
