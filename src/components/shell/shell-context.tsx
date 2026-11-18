'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

// UI state shared by the top bar, the rail, the side panel, the phone bottom bar and the phone menu sheet.
type Shell = {
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  inboxOpen: boolean;
  setInboxOpen: (open: boolean) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  focusSearch: () => void;
  /** The side panel is collapsed (the rail stays, the page stretches); Ctrl+B, remembered in this browser. */
  sideCollapsed: boolean;
  toggleSide: () => void;
};

const ShellContext = createContext<Shell | null>(null);

const SIDE_KEY = 'side-collapsed';

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const focusSearch = useCallback(() => searchRef.current?.focus(), []);
  const toggleSide = useCallback(() => setSideCollapsed((c) => !c), []);

  useEffect(() => {
    let saved = false;
    try {
      saved = localStorage.getItem(SIDE_KEY) === '1';
    } catch {}
    setSideCollapsed(saved);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.side = sideCollapsed ? 'collapsed' : 'open';
    try {
      localStorage.setItem(SIDE_KEY, sideCollapsed ? '1' : '0');
    } catch {}
  }, [sideCollapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
        const t = e.target as HTMLElement | null;
        if (t?.isContentEditable) return;
        e.preventDefault();
        setSideCollapsed((c) => !c);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo(
    () => ({
      menuOpen,
      setMenuOpen,
      inboxOpen,
      setInboxOpen,
      searchRef,
      focusSearch,
      sideCollapsed,
      toggleSide,
    }),
    [menuOpen, inboxOpen, focusSearch, sideCollapsed, toggleSide],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): Shell {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell outside ShellProvider');
  return ctx;
}
