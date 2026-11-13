import Link from 'next/link';
import { MessageSquareText } from 'lucide-react';
import { formatDate } from '@/engine/fields/helpers';
import type { WorkRow } from '@/engine/my-work';
import { Chip } from '@/components/fields/shared';
import { cn } from '@/lib/utils';

// One row of My work and Home (docs/05 §4): status pill · name and "CA-014 · Corrective actions · Due date" · the due
// label on the right, red and worded "overdue" when it is (colour is never the only signal).

export const itemHref = (org: string, r: Pick<WorkRow, 'sheetId' | 'displayId'>) =>
  `/${org}/s/${r.sheetId}?item=${encodeURIComponent(r.displayId)}`;

export function WorkRowView({ org, row }: { org: string; row: WorkRow }) {
  const meta = [
    row.displayId,
    row.parent ? `in ${row.parent.displayId} ${row.parent.name}` : null,
    row.sheetName,
    row.due?.fieldName,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="border-line border-t first:border-t-0">
      <Link
        href={itemHref(org, row)}
        className="hover:bg-subtle flex min-w-0 items-center gap-3 px-4 py-3 outline-offset-[-2px] [ul[data-bare]_&]:px-[22px]"
        data-testid="work-row"
      >
        <span className="hidden w-[132px] shrink-0 sm:block">
          {row.status ? <Chip option={row.status} /> : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-label-14 font-medium break-words">{row.name}</span>
          <span className="text-muted-foreground text-label-12 flex min-w-0 flex-wrap items-center gap-x-2">
            <span className="text-label-12-mono truncate">{meta}</span>
            {row.status ? (
              <span className="sm:hidden">
                <Chip option={row.status} />
              </span>
            ) : null}
            {row.requests.length > 0 ? (
              <span className="text-ink inline-flex items-center gap-1 font-medium">
                <MessageSquareText className="size-3.5" aria-hidden />
                {row.requests.length === 1
                  ? 'Update requested'
                  : `${row.requests.length} updates requested`}
              </span>
            ) : null}
          </span>
        </span>
        {row.due ? (
          <span
            className={cn(
              'text-label-13 flex shrink-0 flex-col items-end text-right',
              row.overdue ? 'text-crit font-medium' : 'text-ink',
            )}
          >
            <span>{formatDate(row.due.date)}</span>
            {!row.done ? <span className="text-label-12">{row.due.relative}</span> : null}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

export function WorkList({
  org,
  rows,
  label,
  bare,
}: {
  org: string;
  rows: WorkRow[];
  label: string;
  /** Inside a card: no frame of its own. */
  bare?: boolean;
}) {
  return (
    <ul
      aria-label={label}
      data-bare={bare ? '' : undefined}
      className={cn(
        'bg-background-100 m-0 list-none overflow-hidden p-0',
        !bare && 'border-line rounded-lg border',
      )}
    >
      {rows.map((r) => (
        <WorkRowView key={r.itemId} org={org} row={r} />
      ))}
    </ul>
  );
}
