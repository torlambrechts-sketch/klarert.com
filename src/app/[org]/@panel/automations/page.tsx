import { AreaPanel } from '@/components/shell/area-panel';

export default async function Panel({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  return (
    <AreaPanel
      title="Automations"
      links={[
        { href: `/${org}/automations?tab=all`, label: 'All automations' },
        { href: `/${org}/automations?tab=runs`, label: 'Run log' },
      ]}
    />
  );
}
