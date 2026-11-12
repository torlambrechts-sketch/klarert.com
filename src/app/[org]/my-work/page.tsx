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
import { WorkList } from '@/components/my-work/work-row';
import { cn } from '@/lib/utils';
import { requireMember } from '@/server/auth';
import { getMyWork } from '@/server/repositories/my-work';

export const metadata = { title: 'My work · Compliance OS' };

// My work (docs/01 FR-37, docs/05 §4): KPI tiles that filter, then the rows by date. Filters: ?filter=<bucket> and
// ?sheet=<id> (the second panel lists both with counts). Filter links are plain anchors: the client router at times
// fetched a search-param-only navigation of this page (it has a parallel @panel slot) and never committed it, so the
// click did nothing; a document navigation always lands.

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
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1>My work</h1>
        <p className="text-muted-foreground m-0 text-sm">
          Items assigned to you and requests to you, soonest first.
        </p>
      </div>
      {failed || !data ? (
        <div
          role="alert"
          className="border-line flex flex-col items-start gap-2 rounded-[var(--radius-card)] border bg-white p-4"
        >
          <p className="m-0">My work could not be loaded.</p>
          <a
            href={href(bucket)}
            className="border-line rounded-md border px-3 py-1.5 text-sm font-semibold"
          >
            Retry
          </a>
        </div>
      ) : (
        <>
          <nav aria-label="My work filters" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TILES.map(({ bucket: b, icon: Icon }) => {
              const active = bucket === b;
              return (
                <a
                  key={b}
                  href={active ? href(null) : href(b)}
                  aria-current={active ? 'page' : undefined}
                  data-testid={`kpi-${b}`}
                  className={cn(
                    'border-line flex flex-col gap-1 rounded-[var(--radius-card)] border bg-white p-3 outline-offset-2',
                    active && 'border-ink ring-ink ring-1',
                  )}
                >
                  <span className="text-muted-foreground flex items-center gap-1.5 text-[12.5px] font-semibold">
                    <Icon className="size-4" aria-hidden /> {BUCKET_LABEL[b]}
                  </span>
                  <span
                    className={cn(
                      'text-[26px] leading-none font-extrabold',
                      b === 'overdue' && data.work.counts.overdue > 0 && 'text-crit',
                    )}
                  >
                    {data.work.counts[b]}
                  </span>
                </a>
              );
            })}
          </nav>
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
      <div className="border-line flex flex-col items-start gap-2 rounded-[var(--radius-card)] border border-dashed bg-white p-6">
        <p className="text-muted-foreground m-0">
          Nothing needs you. Items where you are in a people field, and requests to you, show here.
        </p>
        <Link href={`/${org}/home`} className="text-focus font-semibold">
          Go to Home
        </Link>
      </div>
    );
  if (rows.length === 0)
    return (
      <div className="border-line flex flex-col items-start gap-2 rounded-[var(--radius-card)] border border-dashed bg-white p-6">
        <p className="text-muted-foreground m-0">Nothing matches this filter.</p>
        <a href={`/${org}/my-work`} className="text-focus font-semibold">
          Show everything
        </a>
      </div>
    );
  const title = [bucket ? BUCKET_LABEL[bucket] : null, sheetName].filter(Boolean).join(' · ');
  if (bucket || sheetId)
    return (
      <section className="flex flex-col gap-2" aria-labelledby="work-filtered">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="work-filtered" className="text-base font-bold">
            {title} <span className="text-muted-foreground font-semibold">({rows.length})</span>
          </h2>
          <a href={`/${org}/my-work`} className="text-focus text-sm font-semibold">
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
          <h2 id={`work-${s.bucket}`} className="text-base font-bold">
            {BUCKET_LABEL[s.bucket]}{' '}
            <span className="text-muted-foreground font-semibold">({s.rows.length})</span>
          </h2>
          <WorkList org={org} rows={s.rows} label={BUCKET_LABEL[s.bucket]} />
        </section>
      ))}
    </>
  );
}
