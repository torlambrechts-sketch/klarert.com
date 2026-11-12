'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, Menu, Plus } from 'lucide-react';
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
import { initialsOf } from './rail';
import { useShell } from './shell-context';

type Ws = { id: string; name: string; slug: string };

function Logo({ name }: { name: string }) {
  return (
    <span
      className="bg-ink text-yel flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-extrabold"
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}

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
  const { setMenuOpen, focusSearch } = useShell();
  useSlashToSearch(focusSearch);
  return (
    <header className="border-line sticky top-0 z-30 flex h-[58px] items-center gap-2 border-b bg-white px-3 sm:gap-3 sm:px-4">
      <button
        type="button"
        className="phone-only hover:bg-soft flex size-9 shrink-0 items-center justify-center rounded-md"
        aria-label="Open menu"
        onClick={() => setMenuOpen(true)}
      >
        <Menu className="size-5" aria-hidden />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger className="hover:bg-soft flex shrink-0 items-center gap-2 rounded-md px-1.5 py-1 font-semibold">
          <Logo name={current.name} />
          <span className="desk-only max-w-[22vw] truncate">{current.name}</span>
          <ChevronDown className="desk-only size-4" aria-hidden />
          <span className="sr-only">Switch workspace</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuLabel>Your workspaces</DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem key={w.id} asChild>
              <Link href={`/${w.slug}`} className="flex items-center gap-2">
                <Logo name={w.name} />
                <span className="flex-1 truncate">{w.name}</span>
                {w.id === current.id ? <Check className="size-4" aria-label="Current" /> : null}
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/onboarding" className="flex items-center gap-2">
              <Plus className="size-4" aria-hidden /> New workspace
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <GlobalSearch org={current.slug} />

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <Inbox org={current.slug} orgId={current.id} userId={me.id} timeZone={timeZone} />

        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ background: `var(--label-${me.color}, var(--label-blue))` }}
            aria-label={`Account menu for ${me.displayName}`}
          >
            {me.initials}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuLabel className="flex flex-col">
              <span>{me.displayName}</span>
              <span className="text-muted-foreground text-xs font-normal">{me.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {canManage ? (
              <DropdownMenuItem asChild>
                <Link href={`/${current.slug}/settings`}>Workspace settings</Link>
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
