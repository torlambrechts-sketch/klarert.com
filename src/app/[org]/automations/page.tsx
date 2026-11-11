import { EmptyPage } from '@/components/shell/empty-page';
import { requireMember } from '@/server/auth';

export const metadata = { title: 'Automations · Compliance OS' };

export default async function AutomationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireMember((await params).org);
  const runs = (await searchParams).tab === 'runs';
  return runs ? (
    <EmptyPage
      title="Run log"
      message="No automation runs yet. Every run will be listed here with its steps."
    />
  ) : (
    <EmptyPage
      title="Automations"
      message="No automations yet. Automations of every sheet in this workspace will be listed here."
    />
  );
}
