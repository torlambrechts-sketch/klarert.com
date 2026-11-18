'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GlobalSearch } from './global-search';
import { Inbox } from './inbox';
import { Logo } from './logo';
import { WorkspaceSwitcher, type Ws } from './side-menu';
import { useShell } from './shell-context';

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

// The top bar (docs/18 §4, docs/05 §2.3): white, 69 px. The logo in a 288 px slot, the 44 px search pill, then the
// workspace switcher, the Inbox bell and the user pill. Phones keep Search, the Inbox and the avatar (docs/05 §5);
// the workspace switcher is in the menu sheet there.
export function TopBar({
  current,
  workspaces,
  me,
  canManage,
  timeZone,
}: {
  current: Ws;
  workspaces: Ws[];
  me: { id: string; displayName: string; initials: string; color: string; email: string };
  canManage: boolean;
  timeZone: string;
}) {
  const { focusSearch } = useShell();
  useSlashToSearch(focusSearch);
  const first = me.displayName.split(/\s+/)[0] ?? me.displayName;
  return (
    <header className="top-bar border-line bg-surface sticky top-0 z-30 flex h-[69px] items-center gap-3 border-b px-4 min-[640px]:gap-6 min-[640px]:px-6 print:hidden">
      <Logo href={`/${current.slug}/home`} />

      <GlobalSearch org={current.slug} />

      <div className="ml-auto flex shrink-0 items-center gap-1 min-[640px]:gap-3">
        <div className="desk-only">
          <WorkspaceSwitcher current={current} workspaces={workspaces} variant="top" />
        </div>
        <Inbox org={current.slug} orgId={current.id} userId={me.id} timeZone={timeZone} />

        <DropdownMenu>
          <DropdownMenuTrigger
            className="border-brand text-brand hover:bg-panel flex h-11 shrink-0 items-center gap-2.5 rounded-full border pr-1.5 pl-1.5 font-medium transition-colors duration-150 min-[640px]:pr-5"
            aria-label={`${me.initials}: account menu for ${me.displayName}`}
          >
            <span
              aria-hidden
              className="bg-brand-soft text-navy text-label-13 flex size-8 items-center justify-center rounded-full font-semibold"
            >
              {me.initials}
            </span>
            <span aria-hidden className="text-nav max-w-[10rem] truncate max-[639.98px]:hidden">
              {first}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuLabel className="flex flex-col">
              <span>{me.displayName}</span>
              <span className="text-muted-foreground text-label-12 font-normal">{me.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/account?next=${encodeURIComponent(`/${current.slug}`)}`}>
                Your account
              </Link>
            </DropdownMenuItem>
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
