'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronsLeft, ChevronsRight, Home, Inbox, Plus, Settings, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Nav, NavSheet } from '@/server/repositories/sheets';
import { PREFS, usePref } from './prefs';

export type RailProps = {
  org: string;
  workspaceName: string;
  nav: Nav;
  canEdit: boolean;
  canManage: boolean;
  myWorkCount: number;
  /** Phone menu sheet: always expanded, no pin. */
  expanded?: boolean;
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

function Item({
  href,
  label,
  active,
  square,
  badge,
  onNavigate,
  testId,
}: {
  href: string;
  label: string;
  active: boolean;
  square: React.ReactNode;
  badge?: React.ReactNode;
  onNavigate?: () => void;
  testId?: string;
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      data-testid={testId}
      className="group/item relative flex h-12 shrink-0 items-center gap-3 rounded-[10px] px-[18px] outline-offset-[-2px] hover:bg-black/5"
    >
      <span
        className={cn(
          'relative flex size-10 shrink-0 items-center justify-center rounded-[10px] text-[12px] font-extrabold',
          active ? 'bg-ink text-yel' : 'text-ink bg-white/45',
        )}
      >
        {square}
        {badge}
      </span>
      <span
        className={cn('rail-label truncate text-[13.5px]', active ? 'font-bold' : 'font-semibold')}
      >
        {label}
      </span>
    </Link>
  );
}

function SheetLinks({
  org,
  sheets,
  activeId,
  onNavigate,
}: {
  org: string;
  sheets: NavSheet[];
  activeId: string | null;
  onNavigate?: () => void;
}) {
  return sheets.map((s) => (
    <li key={s.id}>
      <Item
        href={`/${org}/s/${s.id}`}
        label={s.name}
        active={s.id === activeId}
        square={<span aria-hidden>{s.code}</span>}
        onNavigate={onNavigate}
        testId={`rail-sheet-${s.code}`}
      />
    </li>
  ));
}

export function Rail({
  org,
  workspaceName,
  nav,
  canEdit,
  canManage,
  myWorkCount,
  expanded,
  onNavigate,
}: RailProps) {
  const path = usePathname();
  const [pinned, togglePin] = usePref(PREFS.railPinned);
  const activeSheet = path.match(new RegExp(`^/${org}/s/([0-9a-f-]{36})`))?.[1] ?? null;
  const is = (p: string) => path === `/${org}/${p}` || path.startsWith(`/${org}/${p}/`);
  const sections = [
    ...nav.folders.map((f) => ({ id: f.id, name: f.name, sheets: f.sheets })),
    ...(nav.unfiled.length > 0
      ? [{ id: 'unfiled', name: 'Other sheets', sheets: nav.unfiled }]
      : []),
  ];
  const lastIndex = sections.length - 1;
  const newSheet = canEdit ? (
    <li>
      <Item
        href={`/${org}/s/new`}
        label="New sheet"
        active={path === `/${org}/s/new`}
        square={<Plus className="size-4" aria-hidden />}
        onNavigate={onNavigate}
      />
    </li>
  ) : null;

  return (
    <nav
      aria-label="Side menu"
      className="rail flex flex-col py-3"
      data-expanded={expanded ? '' : undefined}
    >
      {/* top block */}
      <div className="flex flex-col gap-0.5 px-0">
        <Link
          href={`/${org}/home`}
          title={workspaceName}
          onClick={onNavigate}
          className="mb-2 flex h-12 shrink-0 items-center gap-3 px-[18px]"
        >
          <span
            className="bg-ink text-yel flex size-10 shrink-0 items-center justify-center rounded-[10px] text-[13px] font-extrabold"
            aria-hidden
          >
            {initialsOf(workspaceName)}
          </span>
          <span className="rail-label truncate text-[14px] font-extrabold">{workspaceName}</span>
        </Link>
        <Item
          href={`/${org}/home`}
          label="Home"
          active={is('home')}
          square={<Home className="size-[18px]" aria-hidden />}
          onNavigate={onNavigate}
        />
        <Item
          href={`/${org}/my-work`}
          label="My work"
          active={is('my-work')}
          square={<Inbox className="size-[18px]" aria-hidden />}
          onNavigate={onNavigate}
          badge={
            myWorkCount > 0 ? (
              <span className="bg-crit absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-bold text-white">
                {myWorkCount}
                <span className="sr-only"> waiting</span>
              </span>
            ) : null
          }
        />
      </div>

      {/* folders */}
      <div className="rail-sep mx-4 my-2" />
      <div className="flex min-h-0 flex-1 [scrollbar-width:none] flex-col overflow-x-hidden overflow-y-auto">
        {sections.length === 0 ? <ul className="flex flex-col gap-0.5">{newSheet}</ul> : null}
        {sections.map((s, i) => (
          <section key={s.id} aria-labelledby={`rail-section-${s.id}`} className="flex flex-col">
            {i > 0 ? <div className="rail-sep mx-4 my-2" /> : null}
            <h2
              id={`rail-section-${s.id}`}
              className="rail-label truncate px-5 pt-1 pb-1 text-[10.5px] font-bold tracking-wide text-[#6B5B26] uppercase"
            >
              {s.name}
            </h2>
            <ul className="flex flex-col gap-0.5">
              <SheetLinks
                org={org}
                sheets={s.sheets}
                activeId={activeSheet}
                onNavigate={onNavigate}
              />
              {i === lastIndex ? newSheet : null}
            </ul>
          </section>
        ))}
      </div>

      {/* bottom block */}
      <div className="rail-sep mx-4 my-2" />
      <div className="flex flex-col gap-0.5">
        <Item
          href={`/${org}/automations`}
          label="Automations"
          active={is('automations')}
          square={<Zap className="size-[18px]" aria-hidden />}
          onNavigate={onNavigate}
        />
        {canManage ? (
          <Item
            href={`/${org}/settings`}
            label="Settings"
            active={is('settings')}
            square={<Settings className="size-[18px]" aria-hidden />}
            onNavigate={onNavigate}
          />
        ) : null}
        {expanded ? null : (
          <button
            type="button"
            onClick={togglePin}
            aria-pressed={pinned}
            title="Keep menu open"
            className="flex h-12 shrink-0 items-center gap-3 rounded-[10px] px-[18px] text-left outline-offset-[-2px] hover:bg-black/5"
          >
            <span className="flex size-10 shrink-0 items-center justify-center" aria-hidden>
              {pinned ? (
                <ChevronsLeft className="size-[18px]" />
              ) : (
                <ChevronsRight className="size-[18px]" />
              )}
            </span>
            <span className="rail-label text-[13.5px] font-semibold">Keep menu open</span>
          </button>
        )}
      </div>
    </nav>
  );
}
