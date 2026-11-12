'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { AreaPanel } from '@/components/shell/area-panel';

// Second panel on My work (docs/05 §2.2): the Home area's pages, then filters with counts — Everything, Overdue,
// Due in 14 days, Assigned to me, Requests to me, then By sheet.

export type PanelCounts = {
  everything: number;
  overdue: number;
  due: number;
  assigned: number;
  requests: number;
  sheets: { id: string; name: string; count: number }[];
};

const FILTERS: {
  key: 'everything' | 'overdue' | 'due' | 'assigned' | 'requests';
  label: string;
}[] = [
  { key: 'everything', label: 'Everything' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'due', label: 'Due in 14 days' },
  { key: 'assigned', label: 'Assigned to me' },
  { key: 'requests', label: 'Requests to me' },
];

function Row({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center justify-between gap-2 rounded-md px-2 py-1.5 font-semibold',
          active ? 'bg-yel' : 'hover:bg-yel/40',
        )}
      >
        <span className="truncate">{label}</span>
        <span className="text-[12.5px] tabular-nums">{count}</span>
      </Link>
    </li>
  );
}

export function MyWorkPanel({ org, counts }: { org: string; counts: PanelCounts | null }) {
  const path = usePathname();
  const search = useSearchParams();
  const base = `/${org}/my-work`;
  const onPage = path === base;
  const filter = search.get('filter');
  const sheet = search.get('sheet');
  return (
    <div className="flex flex-col gap-4">
      <AreaPanel
        title="Home"
        links={[
          { href: `/${org}/home`, label: 'Overview' },
          { href: base, label: 'My work' },
        ]}
      />
      {counts ? (
        <>
          <nav aria-label="Filter my work" className="flex flex-col gap-1 px-3">
            <h3 className="px-2 text-[10.5px] font-bold tracking-wide text-[#6B5B26] uppercase">
              Filters
            </h3>
            <ul className="flex flex-col gap-0.5">
              {FILTERS.map((f) => (
                <Row
                  key={f.key}
                  href={f.key === 'everything' ? base : `${base}?filter=${f.key}`}
                  label={f.label}
                  count={counts[f.key]}
                  active={onPage && !sheet && (f.key === 'everything' ? !filter : filter === f.key)}
                />
              ))}
            </ul>
          </nav>
          {counts.sheets.length > 0 ? (
            <nav aria-label="My work by sheet" className="flex flex-col gap-1 px-3">
              <h3 className="px-2 text-[10.5px] font-bold tracking-wide text-[#6B5B26] uppercase">
                By sheet
              </h3>
              <ul className="flex flex-col gap-0.5">
                {counts.sheets.map((s) => (
                  <Row
                    key={s.id}
                    href={`${base}?sheet=${s.id}`}
                    label={s.name}
                    count={s.count}
                    active={onPage && sheet === s.id}
                  />
                ))}
              </ul>
            </nav>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
