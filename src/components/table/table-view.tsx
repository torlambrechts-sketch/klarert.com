'use client';

import { useEffect, useState } from 'react';
import { Lock, X } from 'lucide-react';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Item } from '@/engine/types';
import type { ViewConfig } from '@/engine/views/config';
import type { SheetActions } from '@/components/grid/use-sheet';
import { Button } from '@/components/ui/button';
import { Table } from './table';
import { TableCards } from './table-cards';

// The Table view (docs/05 §3.1): the one view for working through a sheet's items as rows. Desktop and tablets get
// the virtualised table; phones (< 640 px) get cards grouped the same way. Above both: the dismissible hint and the
// empty states.

const HINT_KEY = 'table-hint-dismissed';
const PHONE = '(max-width: 639px)';

export interface TableViewProps {
  data: SheetData;
  ctx: Ctx;
  actions: SheetActions;
  canEdit: boolean;
  isAdmin: boolean;
  onlyGroup: string | null;
  /** Narrow screens (< 760 px): a narrower name column. */
  narrow: boolean;
  addFocusTick: number;
  onOpenItem(item: Item): void;
  /** The view's items: filtered, searched, sorted (all groups). */
  items: Item[];
  compare: ((a: Item, b: Item) => number) | null;
  filtered: boolean;
  onClearFilters(): void;
  /** Focus the first "+ Add". */
  onNew(): void;
  config: ViewConfig;
  setConfig(update: (c: ViewConfig) => ViewConfig): void;
}

function usePhone() {
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(PHONE).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const set = () => setPhone(mq.matches);
    set();
    mq.addEventListener('change', set);
    return () => mq.removeEventListener('change', set);
  }, []);
  return phone;
}

export function TableView(p: TableViewProps) {
  const phone = usePhone();
  const total = p.onlyGroup
    ? p.data.items.filter((i) => i.groupId === p.onlyGroup).length
    : p.data.items.length;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {phone ? null : <Hint />}
      {total === 0 ? (
        <Notice>
          No items yet.{' '}
          {p.canEdit ? (
            <Button type="button" variant="link" className="h-auto p-0" onClick={p.onNew}>
              Add the first one.
            </Button>
          ) : null}
        </Notice>
      ) : p.items.length === 0 && p.filtered ? (
        <Notice>
          No items match these filters.{' '}
          <Button type="button" variant="link" className="h-auto p-0" onClick={p.onClearFilters}>
            Clear filters
          </Button>
        </Notice>
      ) : null}
      {phone ? (
        <TableCards
          data={p.data}
          ctx={p.ctx}
          actions={p.actions}
          canEdit={p.canEdit}
          onlyGroup={p.onlyGroup}
          addFocusTick={p.addFocusTick}
          onOpenItem={p.onOpenItem}
          visibleItems={p.items}
          viewCompare={p.compare}
        />
      ) : (
        <div className="border-line flex min-h-[240px] flex-1 flex-col overflow-hidden rounded-[var(--radius-card)] border">
          <Table
            data={p.data}
            ctx={p.ctx}
            actions={p.actions}
            canEdit={p.canEdit}
            isAdmin={p.isAdmin}
            onlyGroup={p.onlyGroup}
            nameWidth={p.narrow ? 200 : 320}
            addFocusTick={p.addFocusTick}
            onOpenItem={p.onOpenItem}
            visibleItems={p.items}
            viewCompare={p.compare}
            config={p.config}
            setConfig={p.setConfig}
          />
        </div>
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-line text-cell flex flex-wrap items-center gap-1 rounded-[var(--radius-card)] border border-dashed px-4 py-3">
      {children}
    </div>
  );
}

function hintDismissed() {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function Hint() {
  // read on first render (the view renders on the client, after the sheet loads): no layout shift
  const [shown, setShown] = useState(() => typeof window !== 'undefined' && !hintDismissed());
  if (!shown) return null;
  return (
    <p className="text-muted-foreground text-meta flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>
        <b className="text-ink">Click a cell, then click again or press Enter to edit.</b> Click a
        name to open the item. <b className="text-ink">+</b> adds a column.{' '}
        <Lock className="inline size-3" aria-hidden />
        <span className="sr-only">Lock</span> kept by the app.
      </span>
      <button
        type="button"
        aria-label="Dismiss hint"
        className="hover:text-ink focus-visible:outline-focus rounded p-0.5 focus-visible:outline-2"
        onClick={() => {
          setShown(false);
          try {
            localStorage.setItem(HINT_KEY, '1');
          } catch {
            // blocked storage: hidden for this visit
          }
        }}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </p>
  );
}
