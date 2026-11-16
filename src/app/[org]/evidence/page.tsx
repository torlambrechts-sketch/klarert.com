import Link from 'next/link';
import { Search } from 'lucide-react';
import {
  buildEvidenceLibrary,
  EVIDENCE_STATUSES,
  EVIDENCE_STATUS_LABEL,
  isEvidenceStatus,
  type EvidenceStatus,
} from '@/engine/evidence-library';
import { todayIn } from '@/engine/sheet-data';
import { inputClass } from '@/components/fields/shared';
import { DownloadButton } from '@/components/insights/download-button';
import { EvidenceBadge, EvidenceStatusIcon } from '@/components/insights/tone';
import { itemHref } from '@/components/my-work/work-row';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { requireMember } from '@/server/auth';
import { fetchEvidence } from '@/server/repositories/evidence';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `Evidence library · ${BRAND.product}` };

// Evidence library (docs/05 §4): the current version of every file across the sheets, with validity worked out by
// the engine against today in the workspace time zone. Read-only: files are added and replaced in the item panel.
// Filters live in the URL (?q, ?sheet, ?status); the status tiles filter, like My work's. Plain anchors and a GET
// form, so the filters work before the page hydrates.

/** Rows rendered at most; the rest are reached by narrowing the filters. */
const MAX_ROWS = 500;

export default async function EvidencePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ q?: string; sheet?: string; status?: string }>;
}) {
  const { org } = await params;
  const sp = await searchParams;
  const { workspace, supabase } = await requireMember(org);
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 100) : '';
  const sheetId = typeof sp.sheet === 'string' && sp.sheet ? sp.sheet : null;
  const status = isEvidenceStatus(sp.status) ? sp.status : null;
  const today = todayIn(new Date(), workspace.time_zone);
  let lib: ReturnType<typeof buildEvidenceLibrary> | null = null;
  let total = 0;
  try {
    const rows = await fetchEvidence(supabase, workspace.id);
    total = rows.length;
    lib = buildEvidenceLibrary(rows, today, { q, sheetId, status });
  } catch {
    lib = null;
  }
  const base = `/${org}/evidence`;
  const href = (next: { status?: EvidenceStatus | null }) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (sheetId) p.set('sheet', sheetId);
    const s = next.status === undefined ? status : next.status;
    if (s) p.set('status', s);
    const str = p.toString();
    return str ? `${base}?${str}` : base;
  };

  return (
    <main className="flex w-full flex-col gap-5 px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px]">
      <PageHeader
        crumb="Reports"
        title="Evidence library"
        description="The current version of every file in your sheets, with who added it, when it was collected and how long it stays valid. Add and replace files in the item."
      />
      {!lib ? (
        <div
          role="alert"
          className="border-line bg-background-100 flex flex-col items-start gap-2 rounded-lg border p-5"
        >
          <p className="m-0">The evidence library could not be loaded.</p>
          <a
            href={href({})}
            className="border-line hover:bg-soft bg-background-100 text-label-14 inline-flex h-[40px] items-center rounded-md border px-3.5 font-medium transition-colors duration-150"
          >
            Retry
          </a>
        </div>
      ) : (
        <>
          <nav aria-label="Filter by status" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {EVIDENCE_STATUSES.map((s) => {
              const active = status === s;
              return (
                <a
                  key={s}
                  href={href({ status: active ? null : s })}
                  aria-current={active ? 'page' : undefined}
                  data-testid={`evidence-tile-${s}`}
                  className={cn(
                    'border-line hover:border-line-strong bg-background-100 flex flex-col gap-1.5 rounded-lg border px-5 py-[18px] outline-offset-2',
                    active && 'border-brand ring-brand ring-1',
                  )}
                >
                  <span className="text-ink text-label-14 flex items-center justify-between gap-1.5 font-medium">
                    {EVIDENCE_STATUS_LABEL[s]}
                    <EvidenceStatusIcon status={s} className="text-muted-foreground" />
                  </span>
                  <span
                    className={cn(
                      'text-heading-32 leading-none tabular-nums',
                      s === 'expired' && lib.counts.expired > 0 && 'text-crit',
                    )}
                  >
                    {lib.counts[s]}
                  </span>
                </a>
              );
            })}
          </nav>

          <form
            method="get"
            action={base}
            role="search"
            aria-label="Filter files"
            className="flex flex-wrap items-end gap-2"
          >
            <label className="text-label-13 flex min-w-[220px] flex-[1_1_280px] flex-col gap-1 font-medium">
              Search
              <span className="relative">
                <Search
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2"
                  aria-hidden
                />
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="File, item, sheet or field"
                  className={cn(inputClass, 'h-[40px] pl-8')}
                />
              </span>
            </label>
            <label className="text-label-13 flex flex-[0_1_220px] flex-col gap-1 font-medium">
              Sheet
              <select
                name="sheet"
                defaultValue={sheetId ?? ''}
                className={cn(inputClass, 'h-[40px]')}
              >
                <option value="">All sheets</option>
                {lib.sheets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-label-13 flex flex-[0_1_220px] flex-col gap-1 font-medium">
              Status
              <select
                name="status"
                defaultValue={status ?? ''}
                className={cn(inputClass, 'h-[40px]')}
              >
                <option value="">Every status</option>
                {EVIDENCE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {EVIDENCE_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline">
              Apply
            </Button>
            {q || sheetId || status ? (
              <a
                href={base}
                className="text-ink text-label-13 inline-flex h-[40px] items-center font-medium underline underline-offset-4"
              >
                Clear filters
              </a>
            ) : null}
          </form>

          {total === 0 ? (
            <div className="border-line bg-background-100 flex flex-col items-start gap-2 rounded-lg border border-dashed p-6">
              <p className="text-muted-foreground m-0">
                No files yet. Files added to evidence and attachment fields of an item show here.
              </p>
              <Link
                href={`/${org}/home`}
                className="text-ink font-medium underline underline-offset-4"
              >
                Go to Home
              </Link>
            </div>
          ) : lib.shown.length === 0 ? (
            <div className="border-line bg-background-100 flex flex-col items-start gap-2 rounded-lg border border-dashed p-6">
              <p className="text-muted-foreground m-0">Nothing matches these filters.</p>
              <a href={base} className="text-ink font-medium underline underline-offset-4">
                Show every file
              </a>
            </div>
          ) : (
            <section aria-labelledby="evidence-files" className="flex flex-col gap-2">
              <h2 id="evidence-files" className="text-heading-16">
                Files{' '}
                <span className="text-muted-foreground text-label-12-mono font-normal">
                  ({lib.shown.length})
                </span>
              </h2>
              <div className="border-line bg-background-100 overflow-x-auto rounded-lg border">
                <table className="text-label-13 w-full min-w-[980px] border-collapse">
                  <thead>
                    <tr className="border-line bg-subtle text-muted-foreground text-label-12 border-b text-left font-medium">
                      <th scope="col" className="px-3 py-2 font-medium">
                        File
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Item
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Sheet · field
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Source
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                        Collected
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                        Valid until
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Status
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                        Uploaded by
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lib.shown.slice(0, MAX_ROWS).map((r) => (
                      <tr key={r.fileId} className="border-line border-t first:border-t-0">
                        <td className="max-w-[260px] px-3 py-2">
                          <span className="flex min-w-0 items-center gap-1">
                            <DownloadButton org={org} fileId={r.fileId} filename={r.filename} />
                            <span className="min-w-0 truncate font-medium" title={r.filename}>
                              {r.filename}
                            </span>
                          </span>
                        </td>
                        <td className="max-w-[280px] px-3 py-2">
                          <Link
                            href={itemHref(org, {
                              sheetId: r.sheet.id,
                              displayId: r.item.displayId,
                            })}
                            className="hover:text-ink flex min-w-0 flex-col underline-offset-4 hover:underline"
                          >
                            <span className="text-muted-foreground text-label-12-mono">
                              {r.item.displayId}
                            </span>
                            <span className="truncate">{r.item.name}</span>
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex flex-col">
                            <span>{r.sheet.name}</span>
                            <span className="text-muted-foreground text-label-12">
                              {r.field.name}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.sourceLabel}</td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                          {r.collectedLabel}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                          <span className="flex flex-col">
                            <span>{r.validUntilLabel}</span>
                            {r.validityDetail ? (
                              <span className="text-muted-foreground text-label-12">
                                {r.validityDetail}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <EvidenceBadge status={r.status} label={r.statusLabel} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.uploadedBy ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {lib.shown.length > MAX_ROWS ? (
                <p className="text-muted-foreground text-copy-13 m-0">
                  Showing the first {MAX_ROWS} of {lib.shown.length} files. Search or choose a sheet
                  to see the rest.
                </p>
              ) : null}
            </section>
          )}
        </>
      )}
    </main>
  );
}
