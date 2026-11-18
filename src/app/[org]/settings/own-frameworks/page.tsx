import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HeadCard, PageHeader } from '@/components/shell/page-header';
import { isAdminRole, requireMember } from '@/server/auth';
import { ownFrameworkEditor } from '@/server/commands/own-frameworks';
import { OwnFrameworkGrid } from '../own-editor';
import { OwnFrameworkStart } from '../own-start';

export const metadata = { title: 'Your framework · Compliance OS' };

// Workspace admin › Frameworks › Add your own, and the grid of a draft (docs/12 Your own frameworks). Owners and
// admins only; every command checks again.
export default async function OwnFrameworkPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ key?: string }>;
}) {
  const { org } = await params;
  const { key } = await searchParams;
  const { workspace, role } = await requireMember(org);
  const crumb = (
    <Link href={`/${org}/settings?tab=frameworks`} className="hover:text-ink">
      Frameworks
    </Link>
  );
  if (!isAdminRole(role))
    return (
      <main className="w-full px-4 pt-5 pb-8 sm:px-12 sm:pt-[26px]">
        <h1>Your frameworks</h1>
        <p className="text-muted-foreground mt-2">
          Only owners and admins can write the workspace&apos;s own frameworks.
        </p>
      </main>
    );
  const r = await ownFrameworkEditor({ org, ...(key ? { key } : {}) });
  return (
    <main className="flex w-full flex-col gap-5 px-4 pt-5 pb-8 [--hero-gap:20px] sm:px-12 sm:pt-[26px]">
      <PageHeader
        crumb={crumb}
        title={key ? (r.ok && r.data.draft?.title) || 'Your framework' : 'Add your own framework'}
        description={`Written by ${workspace.name}. Not reviewed by Klarert. It gets the same library, statement of applicability, coverage and links to your controls as a catalogue framework.`}
      />
      <HeadCard>
        {!r.ok ? (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="m-0">{r.error.message}</p>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/${org}/settings/own-frameworks${key ? `?key=${key}` : ''}`}>
                  <RotateCcw aria-hidden /> Retry
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`/${org}/settings?tab=frameworks`}>Back to Frameworks</Link>
              </Button>
            </div>
          </div>
        ) : key && r.data.draft ? (
          <OwnFrameworkGrid key={r.data.key} org={org} data={r.data} />
        ) : (
          <OwnFrameworkStart org={org} catalogue={r.data.catalogue} />
        )}
      </HeadCard>
    </main>
  );
}
