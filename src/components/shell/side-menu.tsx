'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Check,
  ChevronRight,
  ChevronsUpDown,
  Folder,
  Home,
  Inbox,
  Plus,
  Search,
  SlidersHorizontal,
  Zap,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Nav, NavSheet } from '@/server/repositories/sheets';

// The side menu (docs/05 §2.1): workspace switcher, "Find" to filter the menu, Home and My work, one collapsible
// section per folder with its sheets, then Automations and Workspace admin. 256 px on desktop; on phones the same
// menu opens as a sheet from the bottom bar. Closed folders are remembered per browser.

export type Ws = { id: string; name: string; slug: string };

export type SideMenuProps = {
  org: string;
  current: Ws;
  workspaces: Ws[];
  nav: Nav;
  canEdit: boolean;
  canManage: boolean;
  myWorkCount: number;
  onNavigate?: () => void;
};

export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

const CLOSED_KEY = 'cos.menu.closed';

function readClosed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(CLOSED_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeClosed(ids: Set<string>) {
  try {
    if (ids.size === 0) window.localStorage.removeItem(CLOSED_KEY);
    else window.localStorage.setItem(CLOSED_KEY, JSON.stringify([...ids]));
  } catch {
    // not remembered; the toggle still works for this page view
  }
}

const itemClass =
  'flex h-[34px] w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[14px] text-ink-2 outline-offset-[-2px] hover:bg-nav-hover hover:text-ink aria-[current=page]:bg-nav-active aria-[current=page]:font-medium aria-[current=page]:text-ink';

function NavLink({
  href,
  label,
  icon,
  active,
  trailing,
  onNavigate,
  testId,
  className,
  hidden,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  trailing?: React.ReactNode;
  onNavigate?: () => void;
  testId?: string;
  className?: string;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
        data-testid={testId}
        className={cn(itemClass, 'group/item', className)}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing}
      </Link>
    </li>
  );
}

const iconClass =
  'text-muted-foreground group-hover/item:text-ink group-aria-[current=page]/item:text-ink size-4 shrink-0';

function SheetCode({ code }: { code: string }) {
  return (
    <span
      aria-hidden
      className="border-line text-ink-2 flex h-5 min-w-6 shrink-0 items-center justify-center rounded-[5px] border bg-white px-1 font-mono text-[10.5px] font-medium tracking-tight"
    >
      {code}
    </span>
  );
}

function WorkspaceSwitcher({ current, workspaces }: { current: Ws; workspaces: Ws[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="hover:bg-soft flex h-[38px] w-full items-center gap-2.5 rounded-md px-2 text-left outline-offset-[-2px]">
        <span
          aria-hidden
          className="bg-ink text-primary-foreground flex size-[22px] shrink-0 items-center justify-center rounded-full text-[9.5px] font-semibold"
        >
          {initialsOf(current.name)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{current.name}</span>
        <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">Switch workspace</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-medium">
          Your workspaces
        </DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} asChild>
            <Link href={`/${w.slug}`} className="flex items-center gap-2">
              <span
                aria-hidden
                className="bg-ink text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
              >
                {initialsOf(w.name)}
              </span>
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
  );
}

/** Focus "Find" with F unless the person is typing somewhere. */
function useFindKey(input: React.RefObject<HTMLInputElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'f' && e.key !== 'F') || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [input, enabled]);
}

export function SideMenu({
  org,
  current,
  workspaces,
  nav,
  canEdit,
  canManage,
  myWorkCount,
  onNavigate,
}: SideMenuProps) {
  const path = usePathname();
  const findRef = useRef<HTMLInputElement>(null);
  useFindKey(findRef, !onNavigate);
  const [find, setFind] = useState('');
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  useEffect(() => setClosed(readClosed()), []);

  const activeSheet = path.match(new RegExp(`^/${org}/s/([0-9a-f-]{36})`))?.[1] ?? null;
  const is = (p: string) => path === `/${org}/${p}` || path.startsWith(`/${org}/${p}/`);
  const q = find.trim().toLowerCase();
  const hit = (label: string) => !q || label.toLowerCase().includes(q);

  const sections = useMemo(
    () => [
      ...nav.folders.map((f) => ({ id: f.id, name: f.name, sheets: f.sheets })),
      ...(nav.unfiled.length > 0
        ? [{ id: 'unfiled', name: 'Other sheets', sheets: nav.unfiled }]
        : []),
    ],
    [nav],
  );
  const toggle = (id: string) =>
    setClosed((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeClosed(next);
      return next;
    });

  const sheetLink = (s: NavSheet) => (
    <NavLink
      key={s.id}
      href={`/${org}/s/${s.id}`}
      label={s.name}
      icon={<SheetCode code={s.code} />}
      active={s.id === activeSheet}
      onNavigate={onNavigate}
      testId={`rail-sheet-${s.code}`}
      className="h-8 px-2 text-[13.5px]"
    />
  );
  const newSheet =
    canEdit && hit('New sheet') ? (
      <NavLink
        href={`/${org}/s/new`}
        label="New sheet"
        icon={<Plus className={iconClass} aria-hidden />}
        active={path === `/${org}/s/new`}
        onNavigate={onNavigate}
        className="text-muted-foreground h-8 px-2 text-[13.5px]"
      />
    ) : null;
  const lastIndex = sections.length - 1;
  const anyPlatform = hit('Automations') || (canManage && hit('Workspace admin'));

  return (
    <nav aria-label="Side menu" className="flex h-full flex-col px-2 pt-2.5 pb-4">
      <WorkspaceSwitcher current={current} workspaces={workspaces} />
      <label className="border-line text-muted-foreground focus-within:border-faint my-2 mb-2.5 flex h-[34px] cursor-text items-center gap-2 rounded-md border bg-white pr-1.5 pl-2.5 focus-within:shadow-[0_0_0_3px_rgb(161_161_170/0.25)]">
        <Search className="size-4 shrink-0" aria-hidden />
        <input
          ref={findRef}
          type="search"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setFind('');
              e.currentTarget.blur();
            }
          }}
          placeholder="Find"
          aria-label="Find in menu"
          autoComplete="off"
          className="text-ink placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[14px] outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {onNavigate ? null : (
          <kbd
            aria-hidden
            className="border-line bg-subtle rounded border px-1.5 font-mono text-[11px] leading-[18px]"
          >
            F
          </kbd>
        )}
      </label>

      <div className="flex min-h-0 flex-1 [scrollbar-width:thin] flex-col overflow-x-hidden overflow-y-auto">
        <ul className="flex flex-col gap-px">
          <NavLink
            href={`/${org}/home`}
            label="Home"
            icon={<Home className={iconClass} aria-hidden />}
            active={is('home')}
            onNavigate={onNavigate}
            hidden={!hit('Home')}
          />
          <NavLink
            href={`/${org}/my-work`}
            label="My work"
            icon={<Inbox className={iconClass} aria-hidden />}
            active={is('my-work')}
            onNavigate={onNavigate}
            hidden={!hit('My work')}
            trailing={
              myWorkCount > 0 ? (
                <span className="border-crit-line bg-crit-soft text-crit-ink rounded-full border px-1.5 font-mono text-[11px] leading-[17px]">
                  {myWorkCount}
                  <span className="sr-only"> waiting</span>
                </span>
              ) : null
            }
          />
        </ul>

        <div className="bg-line mx-1 my-2.5 h-px" />
        {q ? null : (
          <h2 className="text-muted-foreground px-2.5 pb-1.5 text-xs font-medium">Sheets</h2>
        )}
        {sections.length === 0 ? <ul className="flex flex-col gap-px">{newSheet}</ul> : null}
        {sections.map((s, i) => {
          const sheets = s.sheets.filter((x) => hit(x.name) || hit(s.name));
          const extra = i === lastIndex ? newSheet : null;
          if (q && sheets.length === 0 && !extra) return null;
          const open = !!q || !closed.has(s.id) || sheets.some((x) => x.id === activeSheet);
          const listId = `menu-folder-${s.id}`;
          return (
            <section key={s.id} aria-labelledby={`${listId}-h`} className="flex flex-col">
              <h3 id={`${listId}-h`} className="m-0">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={listId}
                  onClick={() => toggle(s.id)}
                  className={cn(itemClass, 'group/item')}
                >
                  <Folder className={iconClass} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <ChevronRight
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
                className="border-line my-px mb-1 ml-[18px] flex flex-col gap-px border-l pl-2"
              >
                {sheets.map(sheetLink)}
                {extra}
              </ul>
            </section>
          );
        })}

        {anyPlatform ? (
          <>
            <div className="bg-line mx-1 my-2.5 h-px" />
            {q ? null : (
              <h2 className="text-muted-foreground px-2.5 pb-1.5 text-xs font-medium">Platform</h2>
            )}
            <ul className="flex flex-col gap-px">
              <NavLink
                href={`/${org}/automations`}
                label="Automations"
                icon={<Zap className={iconClass} aria-hidden />}
                active={is('automations')}
                onNavigate={onNavigate}
                hidden={!hit('Automations')}
              />
              {canManage ? (
                <NavLink
                  href={`/${org}/settings`}
                  label="Workspace admin"
                  icon={<SlidersHorizontal className={iconClass} aria-hidden />}
                  active={is('settings')}
                  onNavigate={onNavigate}
                  hidden={!hit('Workspace admin')}
                />
              ) : null}
            </ul>
          </>
        ) : null}
        {q &&
        !anyPlatform &&
        !hit('Home') &&
        !hit('My work') &&
        sections.every((s) => !s.sheets.some((x) => hit(x.name)) && !hit(s.name)) ? (
          <p className="text-muted-foreground px-2.5 py-2 text-[13px]">Nothing matches.</p>
        ) : null}
      </div>
    </nav>
  );
}
