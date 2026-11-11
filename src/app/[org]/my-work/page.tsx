import { EmptyPage } from '@/components/shell/empty-page';
import { requireMember } from '@/server/auth';

export const metadata = { title: 'My work · Compliance OS' };

export default async function MyWorkPage({ params }: { params: Promise<{ org: string }> }) {
  await requireMember((await params).org);
  return (
    <EmptyPage
      title="My work"
      message="Nothing here yet. Items assigned to you, requests to you and your overdue items will be listed here."
    />
  );
}
