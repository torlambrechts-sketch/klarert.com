import Link from 'next/link';
import { Download } from 'lucide-react';
import { CircleCheck } from 'lucide-react';
import { soaHeaderLines, SOA_COLUMNS } from '@/engine/audit/soa';
import { HeadCard, PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { requireMember } from '@/server/auth';
import { exportSoa } from '@/server/commands/audit';
import { PrintButton } from '@/app/poster/[viewId]/print-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Statement of applicability · Compliance OS' };

// The statement of applicability of an adopted library (docs/11 Audit outputs), server-rendered so it prints to PDF
// from the browser (the shell is hidden in print). Rows, words and counts come from the engine (buildSoa); the CSV
// is a form POST to ./csv. Every render is an export and is logged.

export default async function SoaPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; sheetId: string }>;
  searchParams: Promise<{ all?: string }>;
}) {
  const { org, sheetId } = await params;
  const { all } = await searchParams;
  await requireMember(org);
  const showAll = all === '1';
  const r = await exportSoa({ org, sheetId, all: showAll }, 'print');
  const back = `/${org}/s/${sheetId}`;
  if (!r.ok)
    return (
      <main className="flex w-full flex-col gap-5 px-4 pt-5 pb-8 [--hero-gap:20px] sm:px-12 sm:pt-[26px]">
        <PageHeader crumb="Audit outputs" title="Statement of applicability" />
        <HeadCard>
          <div
            role="alert"
            className="border-line bg-surface flex flex-col items-start gap-2 rounded-lg border p-5"
          >
            <p className="m-0">{r.error.message}</p>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/${org}/audit/soa/${sheetId}${showAll ? '?all=1' : ''}`}>Retry</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/${org}/audit`}>Audit outputs</Link>
              </Button>
            </div>
          </div>
        </HeadCard>
      </main>
    );
  const { soa, header, framework, hasSoaView, sheet } = r.data;
  const c = soa.counts;
  return (
    <main
      className="flex w-full flex-col gap-5 px-4 pt-5 pb-8 [--hero-gap:20px] sm:px-12 sm:pt-[26px] print:p-0"
      data-testid="soa-page"
    >
      <PageHeader
        crumb={
          <Link href={`/${org}/audit`} className="hover:text-ink">
            Audit outputs
          </Link>
        }
        title="Statement of applicability"
        description={`${framework.title} · ${header.scope}`}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <form method="post" action={`/${org}/audit/soa/${sheetId}/csv`}>
              {showAll ? <input type="hidden" name="all" value="1" /> : null}
              <Button type="submit" variant="outline">
                <Download aria-hidden /> Download CSV
              </Button>
            </form>
            <PrintButton />
          </div>
        }
      />
      <HeadCard>
        <dl className="text-13 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
          {soaHeaderLines(header).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="m-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
          <p className="text-13 m-0 tabular-nums" role="status">
            {c.total} requirements · {c.applicable} applicable · {c.notApplicable} not applicable ·{' '}
            {c.undecided} to decide · {c.implemented} implemented
          </p>
          {hasSoaView ? (
            <Link
              href={`/${org}/audit/soa/${sheetId}${showAll ? '' : '?all=1'}`}
              className="text-ink text-13 font-medium underline-offset-4 hover:underline"
            >
              {showAll ? 'Show the statement of applicability only' : 'Show every requirement'}
            </Link>
          ) : null}
          <Link
            href={`/${org}/s/${sheet.id}`}
            className="text-ink text-13 font-medium underline-offset-4 hover:underline"
          >
            Open {sheet.name}
          </Link>
        </div>
        <p className="text-13 m-0 hidden tabular-nums print:block">
          {c.total} requirements · {c.applicable} applicable · {c.notApplicable} not applicable ·{' '}
          {c.undecided} to decide · {c.implemented} implemented
        </p>
        {soa.rows.length === 0 ? (
          <div className="border-line bg-surface rounded-lg border p-5">
            <p className="m-0">No requirements in this statement.</p>
            <p className="text-13 text-muted-foreground m-0 mt-1">
              The library&apos;s view shows no items. Show every requirement, or check the
              view&apos;s filters in <Link href={back}>the library</Link>.
            </p>
          </div>
        ) : (
          <div className="border-line overflow-x-auto rounded-lg border print:overflow-visible print:border-0">
            <table className="text-13 w-full min-w-[960px] border-collapse print:min-w-0">
              <caption className="sr-only">
                Statement of applicability, {framework.title}, {c.total} requirements
              </caption>
              <thead className="bg-head print:table-header-group">
                <tr>
                  {SOA_COLUMNS.map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="border-line text-12 border-b px-2.5 py-2 text-left align-bottom font-medium"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {soa.rows.map((row) => (
                  <tr
                    key={row.itemId}
                    className="border-line break-inside-avoid border-b align-top"
                  >
                    <td className="text-13 px-2.5 py-2 font-mono whitespace-nowrap">{row.ref}</td>
                    <td className="px-2.5 py-2">{row.title}</td>
                    <td className="px-2.5 py-2">{row.applicable || '–'}</td>
                    <td className="px-2.5 py-2">{row.justification}</td>
                    <td className="px-2.5 py-2">
                      <span className="inline-flex items-center gap-1">
                        {row.implemented ? (
                          <CircleCheck className="text-good size-3.5 shrink-0" aria-hidden />
                        ) : null}
                        {row.status || '–'}
                      </span>
                    </td>
                    <td className="px-2.5 py-2">{row.owner}</td>
                    <td className="px-2.5 py-2">
                      {row.evidence.length ? (
                        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                          {row.evidence.map((e, i) => (
                            <li key={i} className="break-all">
                              {e.href ? <a href={e.href}>{e.name}</a> : e.name}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td className="px-2.5 py-2">
                      {row.linked.length ? (
                        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                          {row.linked.map((l) => (
                            <li key={l}>{l}</li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap">{row.lastReviewed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </HeadCard>
    </main>
  );
}
