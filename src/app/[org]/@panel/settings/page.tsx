import { AreaPanel } from '@/components/shell/area-panel';

export default async function Panel({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  return (
    <AreaPanel
      title="Settings"
      links={[
        { href: `/${org}/settings?tab=members`, label: 'Members' },
        { href: `/${org}/settings?tab=teams`, label: 'Teams and roles' },
        { href: `/${org}/settings?tab=entities`, label: 'Entities and sites' },
      ]}
    />
  );
}
