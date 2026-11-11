'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Home, Inbox, Menu, Search } from 'lucide-react';
import { Dialog, DialogDescription, DialogTitle, SheetContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Rail, type RailProps } from './rail';
import { useShell } from './shell-context';

const cell =
  'flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold outline-offset-[-3px]';

/** Phones (< 760 px): bottom bar and the full side menu as a left sheet over a scrim (docs/05 §5). */
export function PhoneNav(props: Omit<RailProps, 'expanded' | 'onNavigate'>) {
  const { menuOpen, setMenuOpen, setInboxOpen, focusSearch } = useShell();
  const path = usePathname();
  const is = (p: string) => path.startsWith(`/${props.org}/${p}`);
  return (
    <>
      <nav aria-label="Bottom bar" className="bottom-bar border-t border-black/10">
        <Link
          href={`/${props.org}/home`}
          aria-current={is('home') ? 'page' : undefined}
          className={cn(cell, is('home') && 'font-extrabold')}
        >
          <Home className="size-5" aria-hidden />
          Home
        </Link>
        <Link
          href={`/${props.org}/my-work`}
          aria-current={is('my-work') ? 'page' : undefined}
          className={cn(cell, is('my-work') && 'font-extrabold')}
        >
          <Inbox className="size-5" aria-hidden />
          My work
        </Link>
        <button type="button" className={cell} onClick={() => setMenuOpen(true)}>
          <Menu className="size-5" aria-hidden />
          Menu
        </button>
        <button type="button" className={cell} onClick={focusSearch}>
          <Search className="size-5" aria-hidden />
          Search
        </button>
        <button type="button" className={cell} onClick={() => setInboxOpen(true)}>
          <Bell className="size-5" aria-hidden />
          Inbox
        </button>
      </nav>
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent className="bg-yel">
          <DialogTitle className="sr-only">Menu</DialogTitle>
          <DialogDescription className="sr-only">
            Sheets and pages of this workspace
          </DialogDescription>
          <Rail {...props} expanded onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Dialog>
    </>
  );
}
