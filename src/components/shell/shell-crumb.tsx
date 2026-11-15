'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** The element in the top bar that holds the page's breadcrumb. */
export const CRUMB_SLOT = 'shell-crumb';

/** Marks a side sheet that is drawn over the top bar (the item panel): the crumb ends before it. */
export const COVERS_TOP_BAR = 'data-covers-top-bar';

/**
 * Renders the page's breadcrumb in the slim top bar (docs/05 §2): "Folder / Sheet" and a badge, as the design's
 * board strip does. Nothing renders until the top bar is mounted, and nothing on phones (the slot is hidden there).
 * While a side sheet covers the right of the top bar (the item panel), the slot ends before its left edge, so the
 * crumb and its chips truncate in sight instead of being hidden under it.
 */
export function ShellCrumb({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // The top bar can mount after the page (a server redirect, as /[org]/dashboards makes) or be replaced: follow
    // the slot that is in the document now.
    const find = () => {
      const el = document.getElementById(CRUMB_SLOT);
      setSlot((s) => (s === el ? s : el));
    };
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!slot) return;
    const fit = () => {
      const cover = document.querySelector<HTMLElement>(`[${COVERS_TOP_BAR}]`);
      const c = cover?.getBoundingClientRect();
      slot.style.paddingRight = '';
      if (!c || c.width === 0) return;
      const over = slot.getBoundingClientRect().right - c.left;
      if (over > 0) slot.style.paddingRight = `${over + 12}px`;
    };
    fit();
    const observer = new MutationObserver(fit);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-wide', 'data-state'],
    });
    window.addEventListener('resize', fit);
    // the panel slides in: measure again once it has arrived
    document.addEventListener('animationend', fit, true);
    document.addEventListener('transitionend', fit, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
      document.removeEventListener('animationend', fit, true);
      document.removeEventListener('transitionend', fit, true);
      slot.style.paddingRight = '';
    };
  }, [slot]);
  return slot ? createPortal(children, slot) : null;
}
