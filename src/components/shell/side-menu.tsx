'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Check,
  ChevronsUpDown,
  FileCheck2,
  Home,
  Inbox,
  LayoutDashboard,
  Plus,
  Search,
  SlidersHorizontal,
  PanelLeft,
  Workflow,
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
import type { Nav } from '@/server/repositories/sheets';
import { iconClass, itemClass } from './menu-bits';
import { MenuSheets } from './menu-sheets';

// The side menu (docs/05 §2.1): workspace switcher, "Find" to filter the menu, Home and My work, Insights (Dashboards,
// Evidence library), one collapsible section per folder with its sheets (menu-sheets.tsx: "+", "…" menus, rename,
// drag and drop), then Workflow, Automations and Workspace admin. 256 px on desktop; on phones the same
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
        title={label}
      >
        {icon}
        <span data-side-text className="min-w-0 flex-1 truncate">
          {label}
        </span>
        {trailing ? <span data-side-trailing>{trailing}</span> : null}
      </Link>
    </li>
  );
}

function WorkspaceSwitcher({ current, workspaces }: { current: Ws; workspaces: Ws[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="hover:bg-soft flex h-[38px] w-full items-center gap-[9px] rounded-md px-2 text-left outline-offset-[-2px]">
        <span
          aria-hidden
          className="bg-ink text-primary-foreground text-label-9.5 flex size-[22px] shrink-0 items-center justify-center rounded-full font-semibold"
        >
          {initialsOf(current.name)}
        </span>
        <span data-side-text className="text-label-14 min-w-0 flex-1 truncate font-medium">
          {current.name}
        </span>
        <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">Switch workspace</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60">
        <DropdownMenuLabel className="text-muted-foreground text-label-12 font-medium">
          Your workspaces
        </DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} asChild>
            <Link href={`/${w.slug}`} className="flex items-center gap-2">
              <span
                aria-hidden
                className="bg-ink text-primary-foreground text-label-12 flex size-[28px] shrink-0 items-center justify-center rounded-full font-medium"
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

  const toggle = (id: string) =>
    setClosed((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeClosed(next);
      return next;
    });
  const setOpen = (id: string) =>
    setClosed((was) => {
      if (!was.has(id)) return was;
      const next = new Set(was);
      next.delete(id);
      writeClosed(next);
      return next;
    });
  const empty = nav.folders.length === 0 && nav.unfiled.length === 0;
  const newSheet =
    canEdit && !empty && hit('New sheet') ? (
      <ul className="flex flex-col gap-px">
        <NavLink
          href={`/${org}/s/new`}
          label="New sheet"
          icon={<Plus className={iconClass} aria-hidden />}
          active={path === `/${org}/s/new`}
          onNavigate={onNavigate}
          className="text-muted-foreground text-label-14 h-8 px-2"
        />
      </ul>
    ) : null;
  const anyInsights = hit('Dashboards') || hit('Evidence library');
  const anyPlatform =
    hit('Workflow') || hit('Automations') || (canManage && hit('Workspace admin'));

  return (
    <nav aria-label="Side menu" className="flex h-full flex-col px-2 pt-2.5 pb-4">
      <WorkspaceSwitcher current={current} workspaces={workspaces} />
      <label className="border-line text-muted-foreground focus-within:border-focus bg-background-100 my-2 mb-2.5 flex h-[34px] cursor-text items-center gap-2 rounded-md border pr-1.5 pl-2.5 focus-within:shadow-[0_0_0_3px_rgb(161_161_170/0.25)]">
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
          className="text-ink placeholder:text-muted-foreground text-label-14 min-w-0 flex-1 bg-transparent outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {onNavigate ? null : (
          <kbd
            aria-hidden
            className="border-line bg-subtle text-label-11-mono rounded-[4px] border px-[5px] leading-[18px]"
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
                <span className="border-line bg-background-100 text-muted-foreground text-label-11-mono rounded-full border px-1.5 leading-[17px]">
                  {myWorkCount}
                  <span className="sr-only"> waiting</span>
                </span>
              ) : null
            }
          />
        </ul>

        {anyInsights ? (
          <>
            <div className="bg-line mx-1 my-2.5 h-px shrink-0" />
            {q ? null : (
              <h2 className="text-muted-foreground text-label-12 px-2.5 pt-0.5 pb-1.5 font-medium">
                Insights
              </h2>
            )}
            <ul className="flex flex-col gap-px">
              <NavLink
                href={`/${org}/dashboards`}
                label="Dashboards"
                icon={<LayoutDashboard className={iconClass} aria-hidden />}
                active={is('dashboards')}
                onNavigate={onNavigate}
                hidden={!hit('Dashboards')}
              />
              <NavLink
                href={`/${org}/evidence`}
                label="Evidence library"
                icon={<FileCheck2 className={iconClass} aria-hidden />}
                active={is('evidence')}
                onNavigate={onNavigate}
                hidden={!hit('Evidence library')}
              />
            </ul>
          </>
        ) : null}

        <div className="bg-line mx-1 my-2.5 h-px shrink-0" />
        <MenuSheets
          org={org}
          nav={nav}
          activeSheet={activeSheet}
          q={q}
          hit={hit}
          isClosed={(id) => closed.has(id)}
          toggle={toggle}
          setOpen={setOpen}
          canEdit={canEdit}
          canManage={canManage}
          onNavigate={onNavigate}
        />
        {newSheet}

        {anyPlatform ? (
          <>
            <div className="bg-line mx-1 my-2.5 h-px shrink-0" />
            {q ? null : (
              <h2 className="text-muted-foreground text-label-12 px-2.5 pt-0.5 pb-1.5 font-medium">
                Platform
              </h2>
            )}
            <ul className="flex flex-col gap-px">
              <NavLink
                href={`/${org}/workflow`}
                label="Workflow"
                icon={<Workflow className={iconClass} aria-hidden />}
                active={is('workflow')}
                onNavigate={onNavigate}
                hidden={!hit('Workflow')}
              />
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
        !anyInsights &&
        !hit('Home') &&
        !hit('My work') &&
        [...nav.folders, { name: 'Other sheets', sheets: nav.unfiled }].every(
          (s) => !s.sheets.some((x) => hit(x.name)) && !hit(s.name),
        ) ? (
          <p className="text-muted-foreground text-copy-13 px-2.5 py-2">Nothing matches.</p>
        ) : null}
      </div>
      {onNavigate ? null : <CollapseToggle />}
    </nav>
  );
}

/** "Collapse" at the foot of the side menu (Ctrl+B or Cmd+B): icons only, remembered in this browser. */
function CollapseToggle() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    let saved = false;
    try {
      saved = localStorage.getItem('side-collapsed') === '1';
    } catch {}
    setCollapsed(saved);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.side = collapsed ? 'collapsed' : 'open';
    try {
      localStorage.setItem('side-collapsed', collapsed ? '1' : '0');
    } catch {}
  }, [collapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
        const t = e.target as HTMLElement | null;
        if (t?.isContentEditable) return;
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return (
    <button
      type="button"
      onClick={() => setCollapsed((c) => !c)}
      aria-expanded={!collapsed}
      aria-label={label}
      title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+B)`}
      className={cn(itemClass, 'text-muted-foreground mt-2 shrink-0')}
    >
      <PanelLeft className="size-4 shrink-0" aria-hidden />
      <span data-side-text>Collapse</span>
    </button>
  );
}
