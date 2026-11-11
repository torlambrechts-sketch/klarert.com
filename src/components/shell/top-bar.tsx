'use client';

import Link from 'next/link';
import { Check, ChevronDown, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Ws = { id: string; name: string; slug: string };

function Logo({ name }: { name: string }) {
  const letters = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <span
      className="bg-ink text-yel flex size-8 items-center justify-center rounded-md text-xs font-extrabold"
      aria-hidden
    >
      {letters}
    </span>
  );
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
  return (
    <header className="border-line sticky top-0 z-10 flex h-[58px] items-center justify-between gap-3 border-b bg-white px-4">
      <DropdownMenu>
        <DropdownMenuTrigger className="hover:bg-soft flex items-center gap-2 rounded-md px-1.5 py-1 font-semibold">
          <Logo name={current.name} />
          <span className="max-w-[40vw] truncate">{current.name}</span>
          <ChevronDown className="size-4" aria-hidden />
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

      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex size-9 items-center justify-center rounded-full text-xs font-bold text-white"
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
    </header>
  );
}
