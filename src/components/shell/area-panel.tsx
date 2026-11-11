'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

export type PanelLink = { href: string; label: string };

/** Is this link the current page? Query parameters in the link must match; the first link wins when absent. */
function isActive(link: PanelLink, first: boolean, path: string, search: URLSearchParams) {
  const url = new URL(link.href, 'http://x');
  if (url.pathname !== path) return false;
  for (const [k, v] of url.searchParams) {
    const current = search.get(k);
    if (current === null ? !first : current !== v) return false;
  }
  return true;
}

/** Second panel for pages that are not sheets: the area's pages (docs/05 §2.2). */
export function AreaPanel({ title, links }: { title: string; links: PanelLink[] }) {
  const path = usePathname();
  const search = useSearchParams();
  return (
    <div className="flex flex-col gap-2 px-3">
      <h2 className="px-2 text-[17px] font-extrabold">{title}</h2>
      <ul className="flex flex-col gap-0.5">
        {links.map((l, i) => {
          const active = links.some((x, j) => j < i && isActive(x, j === 0, path, search))
            ? false
            : isActive(l, i === 0, path, search);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-2 py-1.5 font-semibold',
                  active ? 'bg-yel' : 'hover:bg-yel/40',
                )}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
