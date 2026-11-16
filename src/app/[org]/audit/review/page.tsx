import Link from 'next/link';
import { CircleDashed, ListChecks } from 'lucide-react';
import { PrintButton } from '@/app/poster/[viewId]/print-button';
import { CreateReviewButton } from '@/components/audit/create-review-button';
import { inputClass } from '@/components/fields/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { addDays, addMonths, formatDateTime, isIsoDate } from '@/engine/fields/helpers';
import { todayIn } from '@/engine/sheet-data';
import { requireMember } from '@/server/auth';
import { managementReviewInputs } from '@/server/commands/audit';
import { BRAND } from '@/lib/brand';

export const dynamic = 'force-dynamic';
export const metadata = { title: `Management review inputs · ${BRAND.product}` };

// Management review inputs (docs/11 Audit outputs): compiled for a period by the pure compileManagementReview from
// the workspace's sheets (the ISO/IEC 27001 pack's by pack ref), server-rendered so it prints. Editors can add a
// Management review item with the inputs. Every compilation is logged as an export.

export default async function ReviewInputsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { org } = await params;
  const sp = await searchParams;
  const { workspace } = await requireMember(org);
  const today = todayIn(new Date(), workspace.time_zone);
  const to = isIsoDate(sp.to) ? sp.to! : today;
  const from = isIsoDate(sp.from) ? sp.from! : addDays(addMonths(to, -12), 1);
  const r = await managementReviewInputs({ org, from, to });
  const periodForm = (
    <form
      method="get"
      className="flex flex-col gap-3 sm:flex-row sm:items-end print:hidden"
      aria-label="Period"
    >
      <label className="flex flex-col gap-1">
        <span className="text-label-12 text-muted-foreground">From</span>
        <input type="date" name="from" defaultValue={from} required className={inputClass} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-label-12 text-muted-foreground">To</span>
        <input type="date" name="to" defaultValue={to} required className={inputClass} />
      </label>
      <Button type="submit" variant="outline" className="self-start sm:self-auto">
        Compile again
      </Button>
    </form>
  );
  if (!r.ok)
    return (
      <main className="flex w-full flex-col gap-5 px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px]">
        <PageHeader crumb="Audit outputs" title="Management review inputs" />
        {periodForm}
        <div
          role="alert"
          className="border-line bg-background-100 flex flex-col items-start gap-2 rounded-lg border p-5"
        >
          <p className="m-0">{r.error.fieldErrors?.to ?? r.error.message}</p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/${org}/audit/review?from=${from}&to=${to}`}>Retry</Link>
          </Button>
        </div>
      </main>
    );
  const d = r.data;
  const nothing = d.review.sections.every((s) => !s.available);
  return (
    <main
      className="flex w-full flex-col gap-5 px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px] print:p-0"
      data-testid="review-page"
    >
      <PageHeader
        crumb={
          <Link href={`/${org}/audit`} className="hover:text-ink">
            Audit outputs
          </Link>
        }
        title="Management review inputs"
        description={`${d.review.periodLabel} · compiled from your sheets as they are now.`}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <PrintButton />
          </div>
        }
      />
      {periodForm}
      <dl className="text-copy-13 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Workspace</dt>
        <dd className="m-0">{d.workspace}</dd>
        <dt className="text-muted-foreground">Period</dt>
        <dd className="m-0">{d.review.periodLabel}</dd>
        <dt className="text-muted-foreground">Generated</dt>
        <dd className="m-0">
          {formatDateTime(d.generatedAt, d.timeZone)} by {d.generatedBy}
        </dd>
      </dl>
      {nothing ? (
        <div className="border-line bg-background-100 rounded-lg border p-5">
          <p className="m-0">Nothing to compile yet.</p>
          <p className="text-copy-13 text-muted-foreground m-0 mt-1">
            The inputs come from the ISO/IEC 27001 pack&apos;s sheets (risks, nonconformities,
            audits, incidents) and your adopted frameworks. Owners and admins install them in
            Workspace admin.
          </p>
        </div>
      ) : null}
      <ol className="m-0 flex list-none flex-col gap-4 p-0" aria-label="Inputs">
        {d.review.sections.map((s, i) => (
          <li
            key={s.key}
            className="border-line bg-background-100 flex break-inside-avoid flex-col gap-2 rounded-lg border p-5 sm:px-[22px]"
            data-section={s.key}
          >
            <h2 className="text-heading-16 flex items-baseline gap-2">
              <span className="text-muted-foreground tabular-nums">{i + 1}.</span> {s.title}
            </h2>
            {s.available ? null : (
              <p className="text-copy-13 text-muted-foreground m-0 flex items-center gap-1.5">
                <CircleDashed className="size-3.5 shrink-0" aria-hidden /> No sheet holds this yet.
              </p>
            )}
            {s.facts.length ? (
              <ul className="text-copy-14 m-0 flex flex-col gap-1 pl-5">
                {s.facts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : null}
            {s.items.length ? (
              <ul
                className="divide-soft m-0 flex list-none flex-col divide-y p-0"
                aria-label={`Items: ${s.title}`}
              >
                {s.items.map((it) => (
                  <li
                    key={`${s.key}-${it.id}`}
                    className="text-copy-13 flex flex-wrap items-baseline gap-x-2 py-1.5"
                  >
                    <Link
                      href={`/${org}/s/${it.sheetId}?item=${encodeURIComponent(it.displayId)}`}
                      className="text-label-13-mono text-ink underline-offset-4 hover:underline"
                    >
                      {it.displayId}
                    </Link>
                    <span className="min-w-0 break-words">{it.name}</span>
                    <span className="text-muted-foreground">{it.note}</span>
                  </li>
                ))}
                {s.more ? (
                  <li className="text-copy-13 text-muted-foreground py-1.5">and {s.more} more</li>
                ) : null}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
      {d.reviewSheet ? (
        <section
          className="border-line bg-background-100 flex flex-col gap-3 rounded-lg border p-5 sm:px-[22px] print:hidden"
          aria-labelledby="review-record"
        >
          <h2 id="review-record" className="text-heading-16 flex items-center gap-2">
            <ListChecks className="size-4" aria-hidden /> Record the review
          </h2>
          <p className="text-copy-13 text-muted-foreground m-0">
            Adds an item to {d.reviewSheet.name} for this period, ticks the inputs that have data
            and posts this report as its first update.
          </p>
          {d.canCreate ? (
            <CreateReviewButton org={org} from={from} to={to} sheetName={d.reviewSheet.name} />
          ) : (
            <p className="text-copy-13 m-0">Only editors can add items. You can print this page.</p>
          )}
        </section>
      ) : null}
    </main>
  );
}
