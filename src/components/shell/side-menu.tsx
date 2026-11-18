'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronsUpDown,
  FileCheck2,
  ClipboardCheck,
  Home,
  Inbox,
  LayoutDashboard,
  Plus,
  SlidersHorizontal,
  Network,
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
import { AppIcon, type MenuApp } from '@/components/apps/app-icon';
import { iconClass, itemClass } from './menu-bits';
import { MenuRegisters } from './menu-registers';
import { MenuSheets } from './menu-sheets';
import { CreateButton, CreateSheetLink } from '@/components/create/create-provider';
import { useShell } from './shell-context';

// The side panel (docs/18 §4 look, docs/05 §2.1 content, owner decision 15 Nov 2026): the workspace name with a
// collapse ‹ (on phones the workspace switcher; on desktop it is in the top bar) and Create (editors and up), then four
// groups. Work: Home, My work and the installed packs' apps (docs/13). Registers: the shared registers' domains, then the workspace's own
// folders and sheets (menu-sheets.tsx: "+", "…" menus, rename, drag and drop). Reports: Dashboards, Evidence library,
// Audit outputs. Build (editors and up): Workflow, Automations, Design and Workspace admin (admins and owners). One
// search, in the top bar ("/"). 288 px on desktop beside the rail; on phones the same menu opens as a sheet from the
// bottom bar.
// Closed folders are remembered per browser.

export type Ws = { id: string; name: string; slug: string };

export type SideMenuProps = {
  org: string;
  current: Ws;
  workspaces: Ws[];
  nav: Nav;
  canEdit: boolean;
  canManage: boolean;
  myWorkCount: number;
  /** Apps of the installed packs the person's role may see (docs/13). */
  apps?: MenuApp[];
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
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  trailing?: React.ReactNode;
  onNavigate?: () => void;
  testId?: string;
  className?: string;
}) {
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

export function WorkspaceSwitcher({
  current,
  workspaces,
  variant = 'panel',
}: {
  current: Ws;
  workspaces: Ws[];
  /** top: navy words and a chevron in the top bar; panel: the phone menu sheet's first row. */
  variant?: 'top' | 'panel';
}) {
  return (
    <DropdownMenu>
      {variant === 'top' ? (
        <DropdownMenuTrigger className="text-navy hover:bg-panel text-body flex h-11 max-w-[16rem] items-center gap-2 rounded-full px-3 font-medium transition-colors duration-150">
          <span className="min-w-0 truncate">{current.name}</span>
          <ChevronDown className="size-4 shrink-0" aria-hidden />
          <span className="sr-only">Switch workspace</span>
        </DropdownMenuTrigger>
      ) : (
        <DropdownMenuTrigger className="text-navy hover:bg-brand-soft flex h-11 w-full items-center gap-2.5 rounded-md px-4 text-left outline-offset-[-3px]">
          <span className="text-panel-title min-w-0 flex-1 truncate">{current.name}</span>
          <ChevronsUpDown className="size-4 shrink-0" aria-hidden />
          <span className="sr-only">Switch workspace</span>
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent align="start" className="min-w-60">
        <DropdownMenuLabel className="text-muted-foreground text-12 font-medium">
          Your workspaces
        </DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} asChild>
            <Link href={`/${w.slug}`} className="flex items-center gap-2">
              <span
                aria-hidden
                className="bg-ink text-primary-foreground text-12 flex size-[28px] shrink-0 items-center justify-center rounded-full font-medium"
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

/** A group of the side menu (docs/05 §2.1): its heading, then its rows. */
function Group({
  id,
  title,
  children,
  after,
  separator = true,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  /** More rows after the group's own list (Work: the apps, their own list "Apps"). */
  after?: React.ReactNode;
  separator?: boolean;
}) {
  return (
    <>
      <section aria-labelledby={id} className={cn('flex flex-col', separator && 'mt-2')}>
        <h2 id={id} className="text-section-label px-4 pt-4 pb-1">
          {title}
        </h2>
        <ul className="flex flex-col gap-px">{children}</ul>
        {after}
      </section>
    </>
  );
}

export function SideMenu({
  org,
  current,
  workspaces,
  nav,
  canEdit,
  canManage,
  myWorkCount,
  apps = [],
  onNavigate,
}: SideMenuProps) {
  const path = usePathname();
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  useEffect(() => setClosed(readClosed()), []);

  const activeSheet = path.match(new RegExp(`^/${org}/s/([0-9a-f-]{36})`))?.[1] ?? null;
  const is = (p: string) => path === `/${org}/${p}` || path.startsWith(`/${org}/${p}/`);

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
  const empty = nav.registers.length === 0 && nav.folders.length === 0 && nav.unfiled.length === 0;
  // "New sheet" opens Create at the Sheet card (docs/05 §4 Create): one way to make a sheet
  const newSheet =
    canEdit && !empty ? (
      <ul className="flex flex-col gap-px">
        <li>
          <CreateSheetLink org={org} onNavigate={onNavigate} className={itemClass}>
            <Plus className={iconClass} aria-hidden />
            <span data-side-text className="min-w-0 flex-1 truncate">
              New sheet
            </span>
          </CreateSheetLink>
        </li>
      </ul>
    ) : null;
  // ids per menu: the desktop menu and the phone sheet can both be in the page
  const ids = onNavigate ? 'menu-phone' : 'menu';

  return (
    <nav aria-label="Side menu" className="flex h-full flex-col px-4 pt-7 pb-6">
      {onNavigate ? (
        <WorkspaceSwitcher current={current} workspaces={workspaces} />
      ) : (
        <PanelHead name={current.name} />
      )}
      {/* Create: editors, admins and owners, the same check as Build (owner decision 15 Nov 2026) */}
      {canEdit ? (
        <CreateButton onOpen={onNavigate} className="mt-3 mb-1" />
      ) : (
        <div aria-hidden className="h-2" />
      )}

      <div className="flex min-h-0 flex-1 [scrollbar-width:thin] flex-col overflow-x-hidden overflow-y-auto">
        {/* Work: Home, My work and the installed packs' apps (docs/13) */}
        <Group
          id={`${ids}-work`}
          title="Work"
          separator={false}
          after={
            apps.length ? (
              <ul className="mt-px flex flex-col gap-px" aria-label="Apps">
                {apps.map((a) => (
                  <NavLink
                    key={a.key}
                    href={`/${org}/apps/${a.key}/${a.screen}`}
                    label={a.title}
                    icon={<AppIcon icon={a.icon} className={iconClass} />}
                    active={is(`apps/${a.key}`)}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            ) : null
          }
        >
          <NavLink
            href={`/${org}/home`}
            label="Home"
            icon={<Home className={iconClass} aria-hidden />}
            active={is('home')}
            onNavigate={onNavigate}
          />
          <NavLink
            href={`/${org}/my-work`}
            label="My work"
            icon={<Inbox className={iconClass} aria-hidden />}
            active={is('my-work')}
            onNavigate={onNavigate}
            trailing={
              myWorkCount > 0 ? (
                <span className="text-muted-foreground text-13 font-medium">
                  {myWorkCount}
                  <span className="sr-only"> waiting</span>
                </span>
              ) : null
            }
          />
        </Group>

        {/* Registers: the shared registers' domains, then the workspace's own folders and sheets (docs/05 §2.1) */}
        <section aria-labelledby={`${ids}-registers`} className="flex flex-col">
          <MenuSheets
            title="Registers"
            headingId={`${ids}-registers`}
            lead={
              <MenuRegisters
                org={org}
                registers={nav.registers}
                activeSheet={activeSheet}
                isClosed={(id) => closed.has(id)}
                toggle={toggle}
                onNavigate={onNavigate}
              />
            }
            org={org}
            nav={nav}
            activeSheet={activeSheet}
            isClosed={(id) => closed.has(id)}
            toggle={toggle}
            setOpen={setOpen}
            canEdit={canEdit}
            canManage={canManage}
            onNavigate={onNavigate}
          />
          {newSheet}
        </section>

        {/* Reports: every role, auditors included */}
        <Group id={`${ids}-reports`} title="Reports">
          <NavLink
            href={`/${org}/dashboards`}
            label="Dashboards"
            icon={<LayoutDashboard className={iconClass} aria-hidden />}
            active={is('dashboards')}
            onNavigate={onNavigate}
          />
          <NavLink
            href={`/${org}/evidence`}
            label="Evidence library"
            icon={<FileCheck2 className={iconClass} aria-hidden />}
            active={is('evidence')}
            onNavigate={onNavigate}
          />
          <NavLink
            href={`/${org}/audit`}
            label="Audit outputs"
            icon={<ClipboardCheck className={iconClass} aria-hidden />}
            active={is('audit')}
            onNavigate={onNavigate}
          />
        </Group>

        {/* Build: editors, admins and owners; Workspace admin: admins and owners. Viewers and auditors never see it. */}
        {canEdit ? (
          <Group id={`${ids}-build`} title="Build">
            <NavLink
              href={`/${org}/workflow`}
              label="Workflow"
              icon={<Workflow className={iconClass} aria-hidden />}
              active={is('workflow')}
              onNavigate={onNavigate}
            />
            <NavLink
              href={`/${org}/automations`}
              label="Automations"
              icon={<Zap className={iconClass} aria-hidden />}
              active={is('automations')}
              onNavigate={onNavigate}
            />
            <NavLink
              href={`/${org}/design`}
              label="Design"
              icon={<Network className={iconClass} aria-hidden />}
              active={is('design')}
              onNavigate={onNavigate}
            />
            {canManage ? (
              <NavLink
                href={`/${org}/settings`}
                label="Workspace admin"
                icon={<SlidersHorizontal className={iconClass} aria-hidden />}
                active={is('settings')}
                onNavigate={onNavigate}
              />
            ) : null}
          </Group>
        ) : null}
      </div>
    </nav>
  );
}

/** The panel's title (docs/18 §4): the workspace name, 20 px navy, and the collapse ‹ (Ctrl+B). */
function PanelHead({ name }: { name: string }) {
  const { toggleSide } = useShell();
  return (
    <div className="flex items-center justify-between gap-2 pl-4">
      <p className="text-panel-title text-navy m-0 min-w-0 truncate">{name}</p>
      <button
        type="button"
        onClick={toggleSide}
        aria-expanded
        aria-label="Collapse side menu"
        title="Collapse side menu (Ctrl+B)"
        className="text-navy hover:bg-brand-soft flex size-9 shrink-0 items-center justify-center rounded-full transition-colors duration-150"
      >
        <ChevronLeft className="size-5" aria-hidden />
      </button>
    </div>
  );
}
