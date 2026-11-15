'use client';

import Link from 'next/link';
import { ChevronRight, Library, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavFolder } from '@/server/repositories/sheets';
import { SheetCode, iconClass, itemClass } from './menu-bits';

// The shared registers' domains in the side menu (docs/05 §2.1), first under the one "Registers" heading (menu-sheets.tsx
// owns the heading, then the workspace's own folders follow): the domain folders of the shared registers (Management
// system, Risk and controls, Operations, Privacy and security, Suppliers) in order, each with its registers and the
// sheets standards put there. A domain without sheets is not shown. The domains are the packs' own: they are not
// renamed, moved or archived from the menu (Workspace admin › Packs does that).

export function MenuRegisters({
  org,
  registers,
  activeSheet,
  isClosed,
  toggle,
  onNavigate,
}: {
  org: string;
  registers: NavFolder[];
  activeSheet: string | null;
  isClosed: (id: string) => boolean;
  toggle: (id: string) => void;
  onNavigate?: () => void;
}) {
  const shown = registers.filter((d) => d.sheets.length > 0);
  if (!shown.length) return null;
  return (
    <div className="flex flex-col" data-testid="menu-registers">
      {shown.map((d) => {
        const open = !isClosed(d.id);
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
                        'text-muted-foreground text-label-13 h-8 cursor-default gap-[9px] px-2',
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
                        'group/item text-label-13 h-8 min-w-0 gap-[9px] px-2',
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
    </div>
  );
}
