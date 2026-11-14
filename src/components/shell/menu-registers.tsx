'use client';

import Link from 'next/link';
import { ChevronRight, Library, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavFolder } from '@/server/repositories/sheets';
import { SheetCode, iconClass, itemClass } from './menu-bits';

// "Registers" in the side menu (docs/05 §2.1): the domain folders of the Core registers (Management system, Risk and
// controls, Operations, Privacy and security, Suppliers) in order, each with its shared registers and the sheets
// add-ons put there. A domain without sheets is not shown. The domains are the packs' own: they are not renamed,
// moved or archived from the menu (Workspace admin › Packs does that).

export function MenuRegisters({
  org,
  registers,
  activeSheet,
  q,
  hit,
  isClosed,
  toggle,
  onNavigate,
}: {
  org: string;
  registers: NavFolder[];
  activeSheet: string | null;
  q: string;
  hit: (label: string) => boolean;
  isClosed: (id: string) => boolean;
  toggle: (id: string) => void;
  onNavigate?: () => void;
}) {
  const shown = registers
    .map((d) => ({ ...d, sheets: hit(d.name) ? d.sheets : d.sheets.filter((s) => hit(s.name)) }))
    .filter((d) => d.sheets.length > 0);
  if (!shown.length) return null;
  return (
    <section aria-labelledby="menu-registers-h" className="flex flex-col">
      <h2
        id="menu-registers-h"
        className={cn(
          'text-muted-foreground text-label-12 px-2.5 pt-0.5 pb-1.5 font-medium',
          q && 'sr-only',
        )}
      >
        Registers
      </h2>
      {shown.map((d) => {
        // while finding, every domain with a match is open
        const open = !!q || !isClosed(d.id);
        const listId = `menu-domain-${d.id}`;
        return (
          <section key={d.id} aria-labelledby={`${listId}-h`} className="flex flex-col">
            <h3 id={`${listId}-h`} className="m-0 flex min-w-0">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => toggle(d.id)}
                data-testid="menu-domain"
                className={cn(itemClass, 'group/item min-w-0 flex-1')}
              >
                <Library className={iconClass} aria-hidden />
                <span data-side-text className="min-w-0 flex-1 truncate">
                  {d.name}
                </span>
                <ChevronRight
                  data-side-text
                  className={cn(
                    'text-muted-foreground size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
                    open && 'rotate-90',
                  )}
                  aria-hidden
                />
              </button>
            </h3>
            <ul
              id={listId}
              hidden={!open}
              data-side-list
              className="border-line my-px mb-1 ml-[18px] flex flex-col gap-px border-l pl-2"
            >
              {d.sheets.map((s) =>
                s.noAccess ? (
                  <li key={s.id}>
                    <span
                      aria-disabled="true"
                      title="Restricted. Ask an owner to give you access."
                      className={cn(
                        itemClass,
                        'text-muted-foreground text-label-13.5 h-8 cursor-default gap-[9px] px-2',
                      )}
                    >
                      <SheetCode code={s.code} />
                      <span data-side-text className="min-w-0 flex-1 truncate">
                        {s.name}
                      </span>
                      <span
                        data-side-text
                        className="text-label-12 flex shrink-0 items-center gap-1"
                      >
                        <Lock className="size-3.5" aria-hidden /> Restricted
                      </span>
                    </span>
                  </li>
                ) : (
                  <li key={s.id}>
                    <Link
                      href={`/${org}/s/${s.id}`}
                      aria-current={s.id === activeSheet ? 'page' : undefined}
                      onClick={onNavigate}
                      title={s.name}
                      data-testid={`rail-sheet-${s.code}`}
                      className={cn(
                        itemClass,
                        'group/item text-label-13.5 h-8 min-w-0 gap-[9px] px-2',
                      )}
                    >
                      <SheetCode code={s.code} />
                      <span data-side-text className="min-w-0 flex-1 truncate">
                        {s.name}
                      </span>
                      {s.restricted ? (
                        <span
                          title="Restricted"
                          data-side-text
                          className="text-muted-foreground shrink-0"
                        >
                          <Lock className="size-3.5" aria-hidden />
                          <span className="sr-only">Restricted</span>
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
