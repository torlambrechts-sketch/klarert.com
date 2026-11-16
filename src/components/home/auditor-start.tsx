import Link from 'next/link';
import { ClipboardCheck, FileCheck2, History, ListChecks } from 'lucide-react';
import { Card } from '@/components/shell/page-header';
import { auditorBanner } from '@/engine/access';
import { auditorStartLinks, type AuditorStartLink } from '@/engine/auditor-start';
import type { ServerClient } from '@/lib/supabase/server';

// Home for an auditor (board review A10, docs/05 §4): a short "Start here" panel in place of the My work tiles, which
// stay empty for a read-only role. Links to Audit outputs, the statement of applicability, the Evidence library and
// the activity log (in the audit pack). If the libraries cannot be read the SoA link goes to the list on Audit outputs.

const ICONS: Record<AuditorStartLink['id'], typeof ClipboardCheck> = {
  audit: ClipboardCheck,
  soa: ListChecks,
  evidence: FileCheck2,
  activity: History,
};

export async function AuditorStart({
  org,
  orgId,
  db,
  expiresAt,
  timeZone,
}: {
  org: string;
  orgId: string;
  db: ServerClient;
  expiresAt: string | null;
  timeZone: string;
}) {
  const { data } = await db
    .from('sheets')
    .select('id, name')
    .eq('org_id', orgId)
    .eq('is_library', true)
    .is('archived_at', null)
    .is('parent_sheet_id', null)
    .order('position');
  const links = auditorStartLinks(
    org,
    (data ?? []).map((s) => ({ sheetId: s.id, name: s.name })),
  );
  return (
    <Card
      headingId="auditor-start"
      title="Start here"
      description={
        expiresAt
          ? `${auditorBanner(expiresAt, timeZone)}. Everything an audit needs is in these four places.`
          : 'Read-only auditor access. Everything an audit needs is in these four places.'
      }
    >
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2" data-testid="auditor-start">
        {links.map((l) => {
          const Icon = ICONS[l.id];
          return (
            <li key={l.id} className="flex">
              <Link
                href={l.href}
                className="border-line hover:border-line-strong hover:bg-subtle flex w-full items-start gap-3 rounded-lg border px-4 py-3 outline-offset-2"
              >
                <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-ink text-label-14 font-medium">{l.label}</span>
                  <span className="text-muted-foreground text-copy-13">{l.description}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
