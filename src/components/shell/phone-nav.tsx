'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Inbox, Menu } from 'lucide-react';
import { Dialog, DialogDescription, DialogTitle, SheetContent } from '@/components/ui/dialog';
import { SideMenu, type SideMenuProps } from './side-menu';
import { useShell } from './shell-context';

// navy bar, white icons and words; the current page on --brand-soft with navy words (docs/18 §4, C10)
const cell =
  'my-2 mx-1.5 flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl text-12 font-semibold text-white focus-visible:outline-white aria-[current=page]:bg-brand-soft aria-[current=page]:text-navy';

/**
 * Phones (< 760 px, docs/05 §5) in the Keptrow look: the navy bottom bar (Home, My work, Menu) and the full side panel as a full-height --panel
 * sheet over a scrim. Search and the Inbox stay in the top bar, so each job has one control (owner decision 15 Nov 2026, UX-6).
 */
export function PhoneNav(props: Omit<SideMenuProps, 'onNavigate'>) {
  const { menuOpen, setMenuOpen } = useShell();
  const path = usePathname();
  const is = (p: string) => path.startsWith(`/${props.org}/${p}`);
  return (
    <>
      <nav aria-label="Bottom bar" className="bottom-bar">
        <Link
          href={`/${props.org}/home`}
          aria-current={is('home') ? 'page' : undefined}
          className={cell}
        >
          <Home className="size-5" aria-hidden />
          Home
        </Link>
        <Link
          href={`/${props.org}/my-work`}
          aria-current={is('my-work') ? 'page' : undefined}
          className={cell}
        >
          <Inbox className="size-5" aria-hidden />
          My work
        </Link>
        <button type="button" className={cell} onClick={() => setMenuOpen(true)}>
          <Menu className="size-5" aria-hidden />
          Menu
        </button>
      </nav>
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent className="bg-panel">
          <DialogTitle className="sr-only">Menu</DialogTitle>
          <DialogDescription className="sr-only">
            Sheets and pages of this workspace
          </DialogDescription>
          <SideMenu {...props} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Dialog>
    </>
  );
}
