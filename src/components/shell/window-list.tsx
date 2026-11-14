'use client';

import { useCallback, useRef } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useDocumentTop } from '@/components/table/use-document-top';
import { cn } from '@/lib/utils';

/**
 * A list that can hold any number of rows: only the rows near the viewport are in the page (the rest keep their
 * height), and it scrolls with the page like the Table. Rows may wrap (phones), so each row is measured. Tabbing
 * through it scrolls the focused row into view, which brings the next rows into the page before they are reached.
 * Screen readers hear the row's place in the whole list (aria-posinset of aria-setsize).
 */
export function WindowList<T>({
  items,
  getKey,
  renderItem,
  estimateSize,
  overscan = 8,
  className,
  itemClassName,
  ...aria
}: {
  items: readonly T[];
  getKey(item: T): string;
  renderItem(item: T, index: number): React.ReactNode;
  /** A row's usual height in px (rows are measured once they are in the page). */
  estimateSize: number;
  overscan?: number;
  className?: string;
  itemClassName?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const top = useDocumentTop(ref);
  const v = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin: top,
    // the server render and the first browser render show the first screenful
    initialRect: { width: 0, height: 900 },
    getItemKey: useCallback((i: number) => getKey(items[i]!), [getKey, items]),
  });
  return (
    <ul
      ref={ref}
      {...aria}
      className={cn('relative m-0 list-none p-0', className)}
      style={{ height: v.getTotalSize() }}
    >
      {v.getVirtualItems().map((row) => (
        <li
          key={row.key}
          ref={v.measureElement}
          data-index={row.index}
          aria-setsize={items.length}
          aria-posinset={row.index + 1}
          className={cn('absolute top-0 left-0 w-full', itemClassName)}
          style={{ transform: `translateY(${row.start - v.options.scrollMargin}px)` }}
        >
          {renderItem(items[row.index]!, row.index)}
        </li>
      ))}
    </ul>
  );
}
