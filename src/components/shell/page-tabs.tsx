'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export type PageTab = { id: string; label: string; href: string };

/**
 * Underline tabs under a page header (docs/05 §2): a 2 px ink underline on the current one. When they are wider than
 * the page (nine dashboards, an app's screens at 390 px) the row scrolls sideways, and the current tab is brought into
 * view when the page opens or the tab changes, before paint, so nothing jumps.
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
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const ul = list.current;
    const tab = ul?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!ul || !tab) return;
    const box = ul.getBoundingClientRect();
    const at = tab.getBoundingClientRect();
    // only when it is not wholly in view; then centred, so the tabs on either side show too
    if (at.left >= box.left && at.right <= box.right) return;
    ul.scrollLeft += at.left - box.left - (box.width - at.width) / 2;
  }, [active]);
  return (
    <nav aria-label={label} className={cn('border-line border-b', className)}>
      <ul
        ref={list}
        className="m-0 flex [scrollbar-width:none] list-none gap-[22px] overflow-x-auto p-0"
      >
        {tabs.map((t) => (
          <li key={t.id}>
            <Link
              href={t.href}
              aria-current={t.id === active ? 'page' : undefined}
              className="text-muted-foreground hover:text-ink aria-[current=page]:text-ink text-label-14 relative flex h-10 items-center px-px whitespace-nowrap outline-offset-[-2px] aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-0 aria-[current=page]:after:-bottom-px aria-[current=page]:after:h-0.5 aria-[current=page]:after:rounded-sm aria-[current=page]:after:bg-[var(--ink)]"
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
