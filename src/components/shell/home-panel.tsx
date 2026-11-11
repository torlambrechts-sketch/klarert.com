import { AreaPanel } from '@/components/shell/area-panel';

export function HomePanel({ org }: { org: string }) {
  return (
    <AreaPanel
      title="Home"
      links={[
        { href: `/${org}/home`, label: 'Overview' },
        { href: `/${org}/my-work`, label: 'My work' },
      ]}
    />
  );
}
