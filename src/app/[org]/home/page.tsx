import Link from 'next/link';
import { CreateSheetLink } from '@/components/create/create-provider';
import {
  AlertTriangle,
  CalendarClock,
  Circle,
  CircleCheck,
  MessageSquareText,
  Plus,
  UserRound,
} from 'lucide-react';
import { WorkList } from '@/components/my-work/work-row';
import { SetupCard } from '@/components/packs/setup-card';
import { TestModeBanner } from '@/components/packs/test-mode-banner';
import { Card, PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { checklistDone, greeting, homeSummary, hourIn, type ChecklistStepId } from '@/engine/home';
import { BUCKET_LABEL, type Bucket } from '@/engine/my-work';
import { formatDateTime } from '@/engine/fields/helpers';
import { isAdminRole, isEditorRole, requireMember } from '@/server/auth';
import { packSetups, testModePacks } from '@/server/commands/packs';
import { getHome, getMyWork } from '@/server/repositories/my-work';

export const metadata = { title: 'Home · Compliance OS' };

// Home (docs/05 §4): greeting and a one-line summary, My work tiles, Getting started (computed; hidden once done),
// Needs you, Next 30 days and Recent activity. Folders are organised in the side menu. Every number comes from the workspace's data.

const TILES: { bucket: Bucket; icon: typeof AlertTriangle }[] = [
  { bucket: 'overdue', icon: AlertTriangle },
  { bucket: 'due', icon: CalendarClock },
  { bucket: 'requests', icon: MessageSquareText },
  { bucket: 'assigned', icon: UserRound },
];

const textLink = 'text-ink text-label-13 font-medium underline-offset-4 hover:underline';

export default async function HomePage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const { workspace, role, profile } = await requireMember(org);
  const first = profile.display_name.split(/\s+/)[0];
  const [home, mine, setups, quiet] = await Promise.all([
    getHome(workspace.id, workspace.time_zone).catch(() => null),
    getMyWork(workspace.id, workspace.time_zone).catch(() => null),
    // a pack's guided setup (docs/11 Setup); left out when it cannot be read, it stays on Workspace admin › Packs
    packSetups({ org })
      .then((r) => (r.ok ? r.data : []))
      .catch(() => []),
    // pack automations waiting in test mode (docs/04 §14): owners and admins only
    testModePacks({ org })
      .then((r) => (r.ok ? r.data : []))
      .catch(() => []),
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

  const hello = greeting(hourIn(new Date(), workspace.time_zone));

  return (
    <main className="flex w-full flex-col gap-4 px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px]">
      <PageHeader
        className="border-line mb-2 border-b pb-[18px]"
        crumb={workspace.name}
        title={`${hello}, ${first}`}
        description={
          <span data-testid="home-summary">
            {summary ? summary.line : 'Your work could not be loaded.'}
          </span>
        }
        actions={
          canEdit ? (
            <Button asChild>
              <CreateSheetLink org={org}>
                <Plus aria-hidden /> New sheet
              </CreateSheetLink>
            </Button>
          ) : null
        }
      />

      {mine ? (
        <nav aria-label="My work at a glance" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {TILES.map(({ bucket, icon: Icon }) => {
            const n = mine.work.counts[bucket];
            return (
              <Link
                key={bucket}
                href={`/${org}/my-work?filter=${bucket}`}
                className="border-line hover:border-line-strong bg-background-100 flex flex-col gap-1.5 rounded-lg border px-5 py-[18px] outline-offset-2"
              >
                <span className="text-ink text-label-14 flex items-center justify-between gap-2 font-medium">
                  {BUCKET_LABEL[bucket]}
                  <Icon className="text-muted-foreground size-4" aria-hidden />
                </span>
                <span
                  className={
                    bucket === 'overdue' && n > 0
                      ? 'text-crit text-heading-32 leading-none tabular-nums'
                      : 'text-heading-32 leading-none tabular-nums'
                  }
                >
                  {n}
                </span>
                <span className="text-muted-foreground text-label-13">
                  {n === 1 ? '1 item' : `${n} items`}
                </span>
              </Link>
            );
          })}
        </nav>
      ) : null}

      <TestModeBanner org={org} packs={quiet} />

      {setups.map((s) => (
        <SetupCard
          key={s.installId}
          org={org}
          installId={s.installId}
          progress={s.progress}
          levelName={s.level?.name ?? null}
        />
      ))}

      {home && !checklistDone(home.checklist) ? (
        <Card
          headingId="getting-started"
          title="Getting started"
          description={`${home.checklist.filter((s) => s.done).length} of ${home.checklist.length} done. This list goes away once every step is done.`}
        >
          <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="checklist">
            {home.checklist.map((s) => {
              const link = s.done ? null : stepLink(s.id);
              return (
                <li key={s.id} className="flex min-h-9 items-center gap-2.5">
                  {s.done ? (
                    <CircleCheck className="text-good size-[18px] shrink-0" aria-hidden />
                  ) : (
                    <Circle className="text-faint size-[18px] shrink-0" aria-hidden />
                  )}
                  <span className={s.done ? 'text-muted-foreground line-through' : 'font-medium'}>
                    {s.label}
                  </span>
                  <span className="sr-only">{s.done ? ', done' : ', to do'}</span>
                  {link && s.id === 'sheet' ? (
                    <CreateSheetLink org={org} className={`${textLink} ml-auto`}>
                      {link.label}
                    </CreateSheetLink>
                  ) : link ? (
                    <Link href={link.href} className={`${textLink} ml-auto`}>
                      {link.label}
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          headingId="needs-you"
          title={
            <>
              Needs you{' '}
              {summary ? (
                <span className="text-muted-foreground text-label-12-mono font-normal">
                  ({summary.needsYouCount})
                </span>
              ) : null}
            </>
          }
          description="Overdue, requested of you or due in the next 14 days"
          flush
          footer={
            <>
              <span>Oldest first</span>
              <Link href={`/${org}/my-work`} className={textLink}>
                Open My work
              </Link>
            </>
          }
        >
          {!summary ? (
            <Retry org={org} what="Your work" />
          ) : summary.needsYou.length === 0 ? (
            <p className="text-muted-foreground text-copy-14 m-0 px-[22px] py-7 text-center">
              Nothing is overdue, requested of you or due in the next 14 days.
            </p>
          ) : (
            <WorkList org={org} rows={summary.needsYou} label="Needs you" bare />
          )}
        </Card>

        <Card
          headingId="next-30"
          title={
            <>
              Next 30 days{' '}
              {summary ? (
                <span className="text-muted-foreground text-label-12-mono font-normal">
                  ({summary.next30.length})
                </span>
              ) : null}
            </>
          }
          description="Your items with a date coming up"
          flush
        >
          {!summary ? (
            <Retry org={org} what="Your dates" />
          ) : summary.next30.length === 0 ? (
            <p className="text-muted-foreground text-copy-14 m-0 px-[22px] py-7 text-center">
              None of your items has a date in the next 30 days.
            </p>
          ) : (
            <WorkList org={org} rows={summary.next30} label="Next 30 days" bare />
          )}
        </Card>

        <Card
          headingId="recent"
          title="Recent activity"
          description="The latest changes across your sheets"
          flush
        >
          {!home ? (
            <Retry org={org} what="Recent activity" />
          ) : home.recent.length === 0 ? (
            <p className="text-muted-foreground text-copy-14 m-0 px-[22px] py-7 text-center">
              No activity yet. Changes to items show here.
            </p>
          ) : (
            <ol aria-label="Recent activity" className="m-0 list-none p-0">
              {home.recent.map((r) => (
                <li key={r.id} className="border-soft border-t first:border-t-0">
                  <Link
                    href={`/${org}/s/${r.item.sheetId}?item=${encodeURIComponent(r.item.displayId)}`}
                    className="hover:bg-subtle text-label-14 flex items-start gap-3 px-[22px] py-2.5 outline-offset-[-2px]"
                  >
                    <span
                      aria-hidden
                      className="bg-soft text-ink text-label-12 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full font-semibold"
                    >
                      {initials(r.who)}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="break-words">
                        <span className="font-medium">{r.who}</span> · {r.text}
                      </span>
                      <span className="text-muted-foreground text-label-12-mono truncate">
                        {r.item.displayId} · {r.item.name} · {r.item.sheetName} ·{' '}
                        {formatDateTime(r.at, workspace.time_zone)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </main>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

function Retry({ org, what }: { org: string; what: string }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 px-[22px] py-4">
      <p className="m-0">{what} could not be loaded.</p>
      <Button asChild variant="outline" size="sm">
        <Link href={`/${org}/home`}>Retry</Link>
      </Button>
    </div>
  );
}
