'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Bell, Check, ChevronDown, Menu, Plus, Search } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
}: {
  current: Ws;
  workspaces: Ws[];
  me: { displayName: string; initials: string; color: string; email: string };
  canManage: boolean;
}) {
  const { setMenuOpen, inboxOpen, setInboxOpen, searchRef, focusSearch } = useShell();
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

      {/* Search: the box is here; results arrive with M9 (docs/06). */}
      <form
        role="search"
        className="relative min-w-0 flex-1 sm:max-w-[520px]"
        onSubmit={(e) => e.preventDefault()}
      >
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden
        />
        <input
          ref={searchRef}
          type="search"
          aria-label="Search sheets, items and people"
          placeholder="Search sheets, items and people"
          className="border-line bg-soft h-9 w-full rounded-[10px] border pr-8 pl-8 text-[13.5px] outline-none focus:bg-white focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
        />
        <kbd
          className="text-muted-foreground border-line desk-only pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-white px-1.5 font-mono text-[11px]"
          aria-hidden
        >
          /
        </kbd>
      </form>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <Popover open={inboxOpen} onOpenChange={setInboxOpen}>
          <PopoverTrigger
            className="hover:bg-soft flex h-9 items-center gap-1.5 rounded-md px-2 font-semibold"
            aria-label="Inbox"
          >
            <Bell className="size-[18px]" aria-hidden />
            <span className="desk-only">Inbox</span>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(340px,calc(100vw-24px))]">
            <h2 className="font-bold">Inbox</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Nothing here yet. Notifications and requests for you will show here.
            </p>
          </PopoverContent>
        </Popover>

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
