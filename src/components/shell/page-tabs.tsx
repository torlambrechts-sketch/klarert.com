'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { OverflowTabs, underlineTab } from '@/components/ui/overflow-tabs';
import { cn } from '@/lib/utils';

export type PageTab = { id: string; label: string; href: string };

/**
 * Underline tabs under a page header (docs/18 §5 and §7): 14 px uppercase links with the 3 px --brand line on the
 * current one. Four or more become two tabs and More ▾ (OverflowTabs); the trigger shows the current tab when it is
 * in the menu.
 */
export function PageTabs({
  label,
  tabs,
  active,
  className,
}: {
  label: string;
  tabs: PageTab[];
  active: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <nav aria-label={label} className={cn('border-line border-b', className)}>
      <OverflowTabs
        label={label}
        tabs={tabs}
        active={active}
        className="flex-wrap gap-x-5 sm:gap-x-7"
        onSelect={(id) => {
          const t = tabs.find((x) => x.id === id);
          if (t) router.push(t.href);
        }}
        renderTab={(t, on) => (
          <Link href={t.href} aria-current={on ? 'page' : undefined} className={underlineTab(on)}>
            {t.label}
          </Link>
        )}
      />
    </nav>
  );
}
