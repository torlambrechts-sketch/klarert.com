'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

// UI state shared by the top bar, the phone bottom bar and the phone menu sheet.
type Shell = {
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  inboxOpen: boolean;
  setInboxOpen: (open: boolean) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  focusSearch: () => void;
};

const ShellContext = createContext<Shell | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const focusSearch = useCallback(() => searchRef.current?.focus(), []);
  const value = useMemo(
    () => ({ menuOpen, setMenuOpen, inboxOpen, setInboxOpen, searchRef, focusSearch }),
    [menuOpen, inboxOpen, focusSearch],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): Shell {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell outside ShellProvider');
  return ctx;
}
