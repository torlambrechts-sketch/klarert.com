import { cn } from '@/lib/utils';

// My work filters with counts (docs/05 §2.2): Everything, Overdue, Due in 14 days, Assigned to me, Requests to me,
// then By sheet. Rendered as chips under the page header. Plain anchors, like the page's filter tiles (see
// src/app/[org]/my-work/page.tsx).

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

function Chip({
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
      <a
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'text-13 inline-flex h-[30px] items-center gap-1.5 rounded-full border px-2.5 font-medium whitespace-nowrap',
          active
            ? 'bg-brand border-brand text-primary-foreground'
            : 'border-line text-ink hover:bg-soft hover:text-ink bg-surface',
        )}
      >
        <span className="max-w-[220px] truncate">{label}</span>
        <span
          className={cn(
            'text-12 font-mono tabular-nums',
            active ? 'text-faint' : 'text-muted-foreground',
          )}
        >
          {count}
        </span>
      </a>
    </li>
  );
}

export function MyWorkFilters({
  org,
  counts,
  filter,
  sheet,
}: {
  org: string;
  counts: PanelCounts;
  filter: string | null;
  sheet: string | null;
}) {
  const base = `/${org}/my-work`;
  return (
    <div className="flex flex-col gap-2">
      <nav aria-label="Filter my work">
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {FILTERS.map((f) => (
            <Chip
              key={f.key}
              href={f.key === 'everything' ? base : `${base}?filter=${f.key}`}
              label={f.label}
              count={counts[f.key]}
              active={!sheet && (f.key === 'everything' ? !filter : filter === f.key)}
            />
          ))}
        </ul>
      </nav>
      {counts.sheets.length > 0 ? (
        <nav aria-label="My work by sheet" className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-12 font-medium">By sheet</span>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {counts.sheets.map((s) => (
              <Chip
                key={s.id}
                href={`${base}?sheet=${s.id}`}
                label={s.name}
                count={s.count}
                active={sheet === s.id}
              />
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
