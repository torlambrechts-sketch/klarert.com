'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** The element in the top bar that holds the page's breadcrumb. */
export const CRUMB_SLOT = 'shell-crumb';

/**
 * Renders the page's breadcrumb in the slim top bar (docs/05 §2): "Folder / Sheet" and a badge, as the design's
 * board strip does. Nothing renders until the top bar is mounted, and nothing on phones (the slot is hidden there).
 */
export function ShellCrumb({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById(CRUMB_SLOT)), []);
  return slot ? createPortal(children, slot) : null;
}
