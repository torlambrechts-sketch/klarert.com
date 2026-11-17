'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { DESTINATION_LABEL, type Destination, type LeaveRow } from '@/engine/flow';
import { toolbarSelectClass } from '@/components/shell/data-list';
import { HealthLine, PackChip } from './flow-bits';

// "Leaves the system" (docs/05 §4, owner decision 15 Nov 2026): every outside destination of the sheets shown, the fields
// each sends and which of them are personal data, addresses masked to their host. A data-flow record for auditors,
// filterable by destination; the export prints it.

export function LeavesTable({ org, rows }: { org: string; rows: LeaveRow[] }) {
  if (!rows.length)
    return (
      <p className="border-line text-muted-foreground text-copy-13 m-0 rounded-lg border border-dashed px-3 py-3">
        Nothing leaves the workspace from these sheets: no webhooks to Teams, Slack or other
        systems.
      </p>
    );
  return (
    <div className="border-line relative overflow-x-auto rounded-lg border print:overflow-visible">
      <table className="text-copy-13 w-full min-w-[760px] border-collapse print:min-w-0">
        <caption className="sr-only">Data that leaves the workspace</caption>
        <thead className="bg-head text-muted-foreground text-label-12 text-left">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Destination
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              From
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              What is sent
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              State
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const personal = r.fields.filter((f) => f.personal && !f.restricted);
            return (
              <tr key={r.id} className="border-line border-t align-top" data-testid="leaves-row">
                <td className="px-3 py-2">
                  <span className="font-medium">{DESTINATION_LABEL[r.destination]}</span>
                  <span className="text-muted-foreground block font-mono">{r.host}</span>
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/${org}/s/${r.sheetId}?view=design&step=${encodeURIComponent(`webhook:${r.id}`)}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {r.sheetName}
                  </Link>
                  <span className="text-muted-foreground block">{r.automationName}</span>
                  {r.pack ? <PackChip pack={r.pack} className="mt-1" /> : null}
                </td>
                <td className="px-3 py-2">
                  <p className="m-0">{r.note}</p>
                  <p className="text-muted-foreground m-0 mt-1">
                    {r.fields.map((f, i) => (
                      <span key={`${f.name}-${i}`}>
                        {i ? ', ' : ''}
                        {f.name}
                        {f.restricted
                          ? ' (sent as “Restricted”)'
                          : f.personal
                            ? ' (personal data)'
                            : ''}
                      </span>
                    ))}
                  </p>
                  {personal.length ? (
                    <p className="text-warn m-0 mt-1 flex items-center gap-1 font-medium">
                      <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
                      {personal.length === 1
                        ? '1 field is personal data'
                        : `${personal.length} fields are personal data`}
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <span className="block">
                    {!r.enabled
                      ? 'Paused'
                      : r.mode === 'test'
                        ? 'In test mode: sends nothing'
                        : 'On'}
                  </span>
                  <HealthLine health={r.health} className="mt-1" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The lane with its destination filter. */
export function LeavesLane({
  org,
  rows,
  exportHref,
}: {
  org: string;
  rows: LeaveRow[];
  exportHref: string;
}) {
  const [dest, setDest] = useState<Destination | ''>('');
  const kinds = [...new Set(rows.map((r) => r.destination))];
  const shown = dest ? rows.filter((r) => r.destination === dest) : rows;
  return (
    <section
      aria-labelledby="leaves-heading"
      className="flex flex-col gap-3"
      data-testid="leaves-lane"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 id="leaves-heading" className="text-heading-16 m-0">
            Leaves the system
          </h2>
          <p className="text-muted-foreground text-copy-13 m-0">
            Every outside destination, the fields it sends and which are personal data. Addresses
            show their host only.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            <span className="text-label-13 text-muted-foreground">Destination</span>
            <select
              className={toolbarSelectClass}
              value={dest}
              onChange={(e) => setDest(e.target.value as Destination | '')}
            >
              <option value="">All destinations</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {DESTINATION_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <Link
            href={exportHref}
            // opening the export logs it (docs/05 §4): never fetch it ahead of a click
            prefetch={false}
            className="border-line hover:bg-soft bg-background-100 text-label-14 inline-flex h-[40px] items-center rounded-md border px-3.5 font-medium transition-colors duration-150"
          >
            Export data-flow record
          </Link>
        </div>
      </div>
      <LeavesTable org={org} rows={shown} />
    </section>
  );
}
