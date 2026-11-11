'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { PREFS, usePref } from './prefs';

/** The second panel: 240 px, collapsible to 36 px, remembered (docs/05 §2.2). Hidden on phones. */
export function PanelFrame({ children }: { children: React.ReactNode }) {
  const [collapsed, toggle] = usePref(PREFS.panelCollapsed);
  return (
    <aside className="panel-col flex flex-col" aria-label="Page menu">
      <div className="flex h-[42px] shrink-0 items-center justify-end px-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand page menu' : 'Collapse page menu'}
          title={collapsed ? 'Expand page menu' : 'Collapse page menu'}
          className="hover:bg-yel/60 flex size-7 items-center justify-center rounded-md"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden />
          )}
        </button>
      </div>
      <div className="panel-body min-h-0 flex-1 overflow-y-auto pb-6">{children}</div>
    </aside>
  );
}
