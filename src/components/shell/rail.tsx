'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tooltip } from 'radix-ui';
import {
  ClipboardCheck,
  FileCheck2,
  Home,
  Inbox,
  LayoutDashboard,
  Network,
  PanelLeft,
  Settings,
  SlidersHorizontal,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useShell } from './shell-context';

// The navy rail (docs/18 §4, owner decision 18 Nov 2026): the side-panel toggle, a separator, one button per
// destination of the docs/05 §2.1 menu groups for the roles that may see it, then Settings (your account) at the
// bottom. Sheets stay in the side panel. Every button has a name and a tooltip; the current one aria-current.

type Dest = { path: string; label: string; icon: LucideIcon; show: 'all' | 'edit' | 'manage' };

const DESTS: Dest[] = [
  // Work
  { path: 'home', label: 'Home', icon: Home, show: 'all' },
  { path: 'my-work', label: 'My work', icon: Inbox, show: 'all' },
  // Reports: every role, auditors included
  { path: 'dashboards', label: 'Dashboards', icon: LayoutDashboard, show: 'all' },
  { path: 'evidence', label: 'Evidence library', icon: FileCheck2, show: 'all' },
  { path: 'audit', label: 'Audit outputs', icon: ClipboardCheck, show: 'all' },
  // Build: editors, admins and owners; Workspace admin only admins and owners
  { path: 'workflow', label: 'Workflow', icon: Workflow, show: 'edit' },
  { path: 'automations', label: 'Automations', icon: Zap, show: 'edit' },
  { path: 'design', label: 'Design', icon: Network, show: 'edit' },
  { path: 'settings', label: 'Workspace admin', icon: SlidersHorizontal, show: 'manage' },
];

const btn =
  'flex size-12 shrink-0 items-center justify-center rounded-xl text-white transition-colors duration-150 hover:bg-brand-2 focus-visible:outline-white aria-[current=page]:bg-brand-soft aria-[current=page]:text-navy [&_svg]:size-6';

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={8}
          className="bg-navy text-13 shadow-menu z-50 rounded-md px-2.5 py-1.5 font-medium text-white"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Rail({
  org,
  canEdit,
  canManage,
}: {
  org: string;
  canEdit: boolean;
  canManage: boolean;
}) {
  const path = usePathname();
  const { sideCollapsed, toggleSide } = useShell();
  const is = (p: string) => path === `/${org}/${p}` || path.startsWith(`/${org}/${p}/`);
  const dests = DESTS.filter(
    (d) => d.show === 'all' || (d.show === 'edit' ? canEdit : canEdit && canManage),
  );
  const toggleLabel = sideCollapsed ? 'Expand side menu' : 'Collapse side menu';
  return (
    <Tooltip.Provider delayDuration={300}>
      <nav aria-label="Rail" className="rail-col">
        <Tip label={`${toggleLabel} (Ctrl+B)`}>
          <button
            type="button"
            onClick={toggleSide}
            aria-expanded={!sideCollapsed}
            aria-label={toggleLabel}
            className={cn(btn, 'border border-white/35')}
          >
            <PanelLeft aria-hidden />
          </button>
        </Tip>
        <div aria-hidden className="my-1 h-px w-8 shrink-0 bg-white/25" />
        <ul className="flex flex-col items-center gap-2.5">
          {dests.map(({ path: p, label, icon: Icon }) => (
            <li key={p}>
              <Tip label={label}>
                <Link
                  href={`/${org}/${p}`}
                  aria-label={label}
                  aria-current={is(p) ? 'page' : undefined}
                  className={btn}
                >
                  <Icon aria-hidden />
                </Link>
              </Tip>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex flex-col items-center gap-2.5">
          <Tip label="Settings">
            <Link
              href={`/account?next=${encodeURIComponent(`/${org}`)}`}
              aria-label="Settings"
              className={btn}
            >
              <Settings aria-hidden />
            </Link>
          </Tip>
        </div>
      </nav>
    </Tooltip.Provider>
  );
}
