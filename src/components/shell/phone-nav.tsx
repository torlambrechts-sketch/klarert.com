'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Inbox, Menu } from 'lucide-react';
import { Dialog, DialogDescription, DialogTitle, SheetContent } from '@/components/ui/dialog';
import { SideMenu, type SideMenuProps } from './side-menu';
import { useShell } from './shell-context';

const cell =
  'flex min-h-11 flex-col items-center justify-center gap-0.5 text-label-12 font-medium text-muted-foreground outline-offset-[-3px] aria-[current=page]:text-ink';

/**
 * Phones (< 760 px, docs/05 §5): the bottom bar (Home, My work, Menu) and the full side menu as a left sheet over a
 * scrim. Search and the Inbox stay in the top bar, so each job has one control (owner decision 15 Nov 2026, UX-6).
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
        <SheetContent className="bg-sidebar">
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
