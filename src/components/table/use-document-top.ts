'use client';

import { useLayoutEffect, useState } from 'react';

/**
 * An element's distance from the top of the document. The Table's rows scroll with the page (one scrollbar, as the
 * design's board does), so its row virtualiser follows the window and needs to know where the rows start.
 */
export function useDocumentTop(ref: React.RefObject<HTMLElement | null>): number {
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setTop(Math.round(el.getBoundingClientRect().top + window.scrollY));
    update();
    // the header and toolbar above can change height (wrapping, banners)
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [ref]);
  return top;
}
