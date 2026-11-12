import { PageTabs } from '@/components/shell/page-header';

/** All automations · Run log (docs/05 §2.2): underline tabs under the page header. */
export function AutomationTabs({ org, active }: { org: string; active: 'all' | 'runs' }) {
  return (
    <PageTabs
      label="Automations pages"
      active={active}
      tabs={[
        { id: 'all', label: 'All automations', href: `/${org}/automations?tab=all` },
        { id: 'runs', label: 'Run log', href: `/${org}/automations?tab=runs` },
      ]}
    />
  );
}
