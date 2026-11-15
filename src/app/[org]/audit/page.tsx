import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowRight, Download } from 'lucide-react';
import { AuditPackDialog } from '@/components/audit/audit-pack-dialog';
import { ExportsSkeleton } from '@/components/audit/exports-list';
import { ExportsSection } from '@/components/audit/exports-section';
import { inputClass } from '@/components/fields/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { canSeeExports } from '@/engine/audit/exports';
import { addDays, addMonths } from '@/engine/fields/helpers';
import { requireMember } from '@/server/auth';
import { listAuditOutputs } from '@/server/commands/audit';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audit outputs · Compliance OS' };

// Audit outputs (docs/11 Audit outputs): the statement of applicability of each adopted library, the audit pack and
// the management review inputs. Every member may export what they can read, auditors too. Owners, admins and auditors
// also see the Exports list: every audit export of the workspace, newest first (owner decision 15 Nov 2026).

function Card({
  title,
  description,
  children,
  testId,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="border-line bg-background-100 flex flex-col gap-4 rounded-lg border p-5 sm:px-[22px]"
      data-testid={testId}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-heading-16">{title}</h2>
        <p className="text-muted-foreground text-copy-13 m-0">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const { org } = await params;
  const { scope } = await searchParams;
  const { role } = await requireMember(org);
  const r = await listAuditOutputs({ org });
  if (!r.ok)
    return (
      <main className="flex w-full flex-col gap-5 px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px]">
        <PageHeader crumb="Insights" title="Audit outputs" />
        <div
          role="alert"
          className="border-line bg-background-100 flex flex-col items-start gap-2 rounded-lg border p-5"
        >
          <p className="m-0">{r.error.message}</p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/${org}/audit`}>Retry</Link>
          </Button>
        </div>
      </main>
    );
  const d = r.data;
  // the last 12 months by default
  const from = addDays(addMonths(d.today, -12), 1);
  const scopes = [...d.folders, ...d.installs].map((s) => s.value);
  const defaultScope = scope && scopes.includes(scope) ? scope : 'workspace';
  return (
    <main className="flex w-full flex-col gap-5 px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px]">
      <PageHeader
        crumb="Insights"
        title="Audit outputs"
        description="Exports for an auditor or a management review, made from your sheets as they are now. Each one holds only what you can see and is recorded in the activity log."
      />
      <Card
        title="Statement of applicability"
        description="Every requirement of an adopted framework with whether it applies, why, how far it is implemented, the owner, evidence and linked controls and risks."
        testId="audit-soa"
      >
        {d.libraries.length === 0 ? (
          <p className="text-muted-foreground text-copy-13 m-0">
            No framework is adopted yet. Owners and admins adopt one in Workspace admin ›
            Frameworks; its library then shows here.
          </p>
        ) : (
          <ul className="divide-line m-0 flex list-none flex-col divide-y p-0">
            {d.libraries.map((l) => (
              <li
                key={l.sheetId}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <span className="font-medium">{l.name}</span>
                <span className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/${org}/audit/soa/${l.sheetId}`}>View and print</Link>
                  </Button>
                  <form method="post" action={`/${org}/audit/soa/${l.sheetId}/csv`}>
                    <Button type="submit" variant="outline" size="sm">
                      <Download aria-hidden /> CSV
                      <span className="sr-only"> of {l.name}</span>
                    </Button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        title="Audit pack"
        description="One zip for an audit: the statement of applicability, every sheet in a folder or pack as CSV, an evidence index with SHA-256 hashes, and the activity log of a period, workspace entries included, with every hash chain checked."
        testId="audit-pack"
      >
        <div>
          <AuditPackDialog
            org={org}
            folders={d.folders}
            installs={d.installs}
            defaultFrom={from}
            defaultTo={d.today}
            defaultScope={defaultScope}
          />
        </div>
      </Card>
      <Card
        title="Management review inputs"
        description="Compiles what a management review has to consider for a period: actions from earlier reviews, changes in issues and interested parties, nonconformities, monitoring, audits, risks and chances to improve."
        testId="audit-review"
      >
        <form
          method="get"
          action={`/${org}/audit/review`}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <label className="flex flex-col gap-1">
            <span className="text-label-12 text-muted-foreground">From</span>
            <input type="date" name="from" defaultValue={from} required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-label-12 text-muted-foreground">To</span>
            <input type="date" name="to" defaultValue={d.today} required className={inputClass} />
          </label>
          <Button type="submit" variant="outline" className="self-start sm:self-auto">
            Compile <ArrowRight aria-hidden />
          </Button>
        </form>
      </Card>
      {canSeeExports(role) ? (
        <Card
          title="Exports"
          description="Every audit export made in this workspace, newest first: what was exported, who exported it, when and the filters used. Taken from the activity log."
          testId="audit-exports"
        >
          <Suspense fallback={<ExportsSkeleton />}>
            <ExportsSection org={org} />
          </Suspense>
        </Card>
      ) : null}
    </main>
  );
}
