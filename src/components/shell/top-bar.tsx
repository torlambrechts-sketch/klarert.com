'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Menu } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { solidVar } from '@/components/fields/shared';
import { GlobalSearch } from './global-search';
import { Inbox } from './inbox';
import { CRUMB_SLOT } from './shell-crumb';
import { useShell } from './shell-context';

type Ws = { id: string; name: string; slug: string };

/** Focus the search box with "/" unless the person is typing somewhere. */
function useSlashToSearch(focus: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus]);
}

export function TopBar({
  current,
  me,
  canManage,
  timeZone,
}: {
  current: Ws;
  me: { id: string; displayName: string; initials: string; color: string; email: string };
  canManage: boolean;
  timeZone: string;
}) {
  const { setMenuOpen, focusSearch } = useShell();
  useSlashToSearch(focusSearch);
  return (
    <header className="border-line bg-background-100 sticky top-0 z-30 flex h-[48px] items-center gap-2 border-b px-3 sm:gap-2.5 sm:px-[28px] print:hidden">
      <button
        type="button"
        className="phone-only hover:bg-soft flex size-9 shrink-0 items-center justify-center rounded-md"
        aria-label="Open menu"
        onClick={() => setMenuOpen(true)}
      >
        <Menu className="size-5" aria-hidden />
      </button>

      {/* the page's breadcrumb (folder / sheet and its badge) is rendered here by <ShellCrumb> */}
      <div id={CRUMB_SLOT} className="desk-only flex min-w-0 flex-1 items-center" />

      <GlobalSearch org={current.slug} />

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <Inbox org={current.slug} orgId={current.id} userId={me.id} timeZone={timeZone} />

        <DropdownMenu>
          <DropdownMenuTrigger
            className="text-label-12 flex size-7 shrink-0 items-center justify-center rounded-full font-semibold text-white"
            style={{ background: solidVar(me.color) }}
            aria-label={`${me.initials}: account menu for ${me.displayName}`}
          >
            {me.initials}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuLabel className="flex flex-col">
              <span>{me.displayName}</span>
              <span className="text-muted-foreground text-label-12 font-normal">{me.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {canManage ? (
              <DropdownMenuItem asChild>
                <Link href={`/${current.slug}/settings`}>Workspace admin</Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem asChild>
              <button type="submit" form="signout-form" className="w-full text-left">
                Sign out
              </button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <form id="signout-form" action="/auth/signout" method="post" hidden />
      </div>
    </header>
  );
}
