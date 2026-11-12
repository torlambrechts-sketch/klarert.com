import { MyWorkPanel } from '@/components/my-work/my-work-panel';
import { requireMember } from '@/server/auth';
import { getMyWork } from '@/server/repositories/my-work';

export default async function Panel({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const { workspace } = await requireMember(org);
  const data = await getMyWork(workspace.id, workspace.time_zone).catch(() => null);
  return (
    <MyWorkPanel
      org={org}
      counts={data ? { ...data.work.counts, sheets: data.work.sheets } : null}
    />
  );
}
