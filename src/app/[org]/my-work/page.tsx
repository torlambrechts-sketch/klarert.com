import Link from 'next/link';
import { AlertTriangle, CalendarClock, MessageSquareText, UserRound } from 'lucide-react';
import {
  BUCKET_LABEL,
  filterRows,
  isBucket,
  sections,
  type Bucket,
  type MyWork,
} from '@/engine/my-work';
import { MyWorkFilters } from '@/components/my-work/my-work-filters';
import { WorkList } from '@/components/my-work/work-row';
import { PageHeader } from '@/components/shell/page-header';
import { cn } from '@/lib/utils';
import { requireMember } from '@/server/auth';
import { getMyWork } from '@/server/repositories/my-work';

export const metadata = { title: 'My work · Compliance OS' };

// My work (docs/01 FR-37, docs/05 §4): KPI tiles that filter, then the rows by date. Filters: ?filter=<bucket> and
// ?sheet=<id> (the filter chips list both with counts). Filter links are plain anchors: the client router at times
// fetched a search-param-only navigation of this page and never committed it, so the click did nothing; a document
// navigation always lands.

const TILES: { bucket: Bucket; icon: typeof AlertTriangle }[] = [
  { bucket: 'overdue', icon: AlertTriangle },
  { bucket: 'due', icon: CalendarClock },
  { bucket: 'requests', icon: MessageSquareText },
  { bucket: 'assigned', icon: UserRound },
];

export default async function MyWorkPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ filter?: string; sheet?: string }>;
}) {
  const { org } = await params;
  const sp = await searchParams;
  const { workspace } = await requireMember(org);
  const bucket = isBucket(sp.filter) ? sp.filter : null;
  const sheetId = typeof sp.sheet === 'string' && sp.sheet ? sp.sheet : null;
  let data: Awaited<ReturnType<typeof getMyWork>> = null;
  let failed = false;
  try {
    data = await getMyWork(workspace.id, workspace.time_zone);
  } catch {
    failed = true;
  }
  const base = `/${org}/my-work`;
  const href = (b: Bucket | null) => {
    const q = new URLSearchParams();
    if (b) q.set('filter', b);
    if (sheetId) q.set('sheet', sheetId);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-7 sm:pt-[26px]">
      <PageHeader
        title="My work"
        description="Items assigned to you and requests to you, soonest first."
      />
      {failed || !data ? (
        <div
          role="alert"
          className="border-line flex flex-col items-start gap-2 rounded-xl border bg-white p-5 shadow-xs"
        >
          <p className="m-0">My work could not be loaded.</p>
          <a
            href={href(bucket)}
            className="border-line hover:bg-soft inline-flex h-9 items-center rounded-md border bg-white px-3.5 text-[13.5px] font-medium shadow-xs"
          >
            Retry
          </a>
        </div>
      ) : (
        <>
          <nav aria-label="My work filters" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {TILES.map(({ bucket: b, icon: Icon }) => {
              const active = bucket === b;
              return (
                <a
                  key={b}
                  href={active ? href(null) : href(b)}
                  aria-current={active ? 'page' : undefined}
                  data-testid={`kpi-${b}`}
                  className={cn(
                    'border-line hover:border-line-strong flex flex-col gap-1.5 rounded-xl border bg-white px-5 py-[18px] shadow-xs outline-offset-2',
                    active && 'border-brand ring-brand ring-1',
                  )}
                >
                  <span className="text-ink flex items-center justify-between gap-1.5 text-[13.5px] font-medium">
                    {BUCKET_LABEL[b]}
                    <Icon className="text-muted-foreground size-4" aria-hidden />
                  </span>
                  <span
                    className={cn(
                      'text-[30px] leading-[1.1] font-bold tracking-[-0.03em] tabular-nums',
                      b === 'overdue' && data.work.counts.overdue > 0 && 'text-crit',
                    )}
                  >
                    {data.work.counts[b]}
                  </span>
                </a>
              );
            })}
          </nav>
          <MyWorkFilters
            org={org}
            counts={{ ...data.work.counts, sheets: data.work.sheets }}
            filter={bucket}
            sheet={sheetId}
          />
          <Rows org={org} work={data.work} bucket={bucket} sheetId={sheetId} />
        </>
      )}
    </main>
  );
}

function Rows({
  org,
  work,
  bucket,
  sheetId,
}: {
  org: string;
  work: MyWork;
  bucket: Bucket | null;
  sheetId: string | null;
}) {
  const rows = filterRows(work, { bucket, sheetId });
  const sheetName = sheetId ? work.sheets.find((s) => s.id === sheetId)?.name : null;
  if (work.rows.length === 0)
    return (
      <div className="border-line flex flex-col items-start gap-2 rounded-xl border border-dashed bg-white p-6">
        <p className="text-muted-foreground m-0">
          Nothing needs you. Items where you are in a people field, and requests to you, show here.
        </p>
        <Link href={`/${org}/home`} className="text-ink font-medium underline underline-offset-4">
          Go to Home
        </Link>
      </div>
    );
  if (rows.length === 0)
    return (
      <div className="border-line flex flex-col items-start gap-2 rounded-xl border border-dashed bg-white p-6">
        <p className="text-muted-foreground m-0">Nothing matches this filter.</p>
        <a href={`/${org}/my-work`} className="text-ink font-medium underline underline-offset-4">
          Show everything
        </a>
      </div>
    );
  const title = [bucket ? BUCKET_LABEL[bucket] : null, sheetName].filter(Boolean).join(' · ');
  if (bucket || sheetId)
    return (
      <section className="flex flex-col gap-2" aria-labelledby="work-filtered">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="work-filtered" className="text-[15px] font-semibold tracking-[-0.01em]">
            {title}{' '}
            <span className="text-muted-foreground font-mono text-xs font-normal">
              ({rows.length})
            </span>
          </h2>
          <a
            href={`/${org}/my-work`}
            className="text-ink text-sm font-medium underline underline-offset-4"
          >
            Clear filter
          </a>
        </div>
        <WorkList org={org} rows={rows} label={title} />
      </section>
    );
  return (
    <>
      {sections(rows).map((s) => (
        <section
          key={s.bucket}
          className="flex flex-col gap-2"
          aria-labelledby={`work-${s.bucket}`}
        >
          <h2 id={`work-${s.bucket}`} className="text-[15px] font-semibold tracking-[-0.01em]">
            {BUCKET_LABEL[s.bucket]}{' '}
            <span className="text-muted-foreground font-mono text-xs font-normal">
              ({s.rows.length})
            </span>
          </h2>
          <WorkList org={org} rows={s.rows} label={BUCKET_LABEL[s.bucket]} />
        </section>
      ))}
    </>
  );
}
