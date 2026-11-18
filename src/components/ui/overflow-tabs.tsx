'use client';

import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

// The menu rule for tab bars (docs/18 §3, owner rule 18 Nov 2026): a bar of four or more tabs shows the first two,
// then "More ▾" with the rest. When the active tab sits in the menu, the trigger shows its name and the active
// underline. Hosts render the visible tabs themselves (links, role=tab buttons), so their semantics stay theirs.

export interface OverflowTab {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}

/** Which tabs show and which go into More: all of them up to `max` controls, else `max - 1` and the menu. */
export function splitTabs<T extends { id: string }>(
  tabs: readonly T[],
  activeId: string | null,
  opts: { max?: number; forceMenu?: boolean } = {},
): { visible: T[]; overflow: T[]; activeInMenu: T | null } {
  const max = opts.max ?? 3;
  if (tabs.length <= max && !opts.forceMenu)
    return { visible: [...tabs], overflow: [], activeInMenu: null };
  const keep = Math.max(1, max - 1);
  const visible = tabs.slice(0, keep);
  const overflow = tabs.slice(keep);
  return { visible, overflow, activeInMenu: overflow.find((t) => t.id === activeId) ?? null };
}

/** The look of an underline tab (docs/18 §5): 14 px uppercase, muted; navy words and a 3 px --brand line when active.
 * Shared by hosts and the trigger. */
export const underlineTab = (active: boolean) =>
  cn(
    'focus-visible:outline-focus text-tab relative flex h-11 items-center gap-[7px] rounded-sm px-px whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:-outline-offset-2',
    active
      ? 'text-navy after:absolute after:inset-x-0 after:-bottom-px after:h-[3px] after:bg-brand'
      : 'text-muted-foreground hover:text-navy',
  );

export function OverflowTabs<T extends OverflowTab>({
  tabs,
  active,
  onSelect,
  renderTab,
  label,
  max = 3,
  menuExtra,
  forceMenu = false,
  className,
  triggerRef,
  wrapTabs,
}: {
  tabs: readonly T[];
  active: string | null;
  onSelect(id: string): void;
  /** Renders one visible tab (a link, a role=tab button …). */
  renderTab(tab: T, active: boolean): React.ReactNode;
  /** Names the More menu for screen readers ("Views: more"). */
  label: string;
  max?: number;
  /** More items after the overflow tabs (New view, Customise tabs …). */
  menuExtra?: React.ReactNode;
  /** Show More even when every tab fits (it carries `menuExtra`). */
  forceMenu?: boolean;
  className?: string;
  triggerRef?: React.Ref<HTMLButtonElement>;
  /**
   * Wraps the visible tabs (a `role=tablist`): More ▾ then sits beside the list, not in it, since a tablist may own
   * only tabs (WAI-ARIA). Without it the tabs and More share one plain row.
   */
  wrapTabs?: (tabs: React.ReactNode) => React.ReactNode;
}) {
  const { visible, overflow, activeInMenu } = splitTabs(tabs, active, {
    max,
    forceMenu: forceMenu || !!menuExtra,
  });
  const Icon = activeInMenu?.icon;
  return (
    <div className={cn('flex min-w-0 items-center gap-[22px]', className)}>
      {(wrapTabs ?? ((x: React.ReactNode) => x))(
        visible.map((t) => (
          <span key={t.id} className="contents">
            {renderTab(t, t.id === active)}
          </span>
        )),
      )}
      {overflow.length || menuExtra ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            ref={triggerRef}
            // named by its words ("More", or the active tab it holds), which stands for the current tab
            aria-current={activeInMenu ? 'page' : undefined}
            data-testid="overflow-tabs-more"
            className={cn(underlineTab(!!activeInMenu), 'gap-1 px-1')}
          >
            {Icon ? <Icon className="size-[15px]" aria-hidden /> : null}
            {activeInMenu ? activeInMenu.label : 'More'}
            <ChevronDown className="size-[15px]" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56" aria-label={`${label}: more`}>
            {overflow.length ? (
              <DropdownMenuRadioGroup value={active ?? ''} onValueChange={onSelect}>
                {overflow.map((t) => {
                  const I = t.icon;
                  return (
                    <DropdownMenuRadioItem key={t.id} value={t.id}>
                      {I ? <I className="size-4" aria-hidden /> : null}
                      {t.label}
                    </DropdownMenuRadioItem>
                  );
                })}
              </DropdownMenuRadioGroup>
            ) : null}
            {overflow.length && menuExtra ? <DropdownMenuSeparator /> : null}
            {menuExtra}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
