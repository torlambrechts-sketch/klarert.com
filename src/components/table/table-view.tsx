'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Item } from '@/engine/types';
import type { ViewConfig } from '@/engine/views/config';
import { applyColumnFilters, applyQuickView, filterByKeys } from '@/engine/views/quick-filters';
import { missingRequired } from '@/engine/views/new-item';
import type { SheetActions } from '@/components/grid/use-sheet';
import { Button } from '@/components/ui/button';
import { useGrid, useGridStore } from '@/components/grid/grid-store';
import { Table } from './table';
import { TableCards } from './table-cards';
import { useUpdateSummaries } from './use-update-counts';
import type { SubitemsState } from '@/components/subitems/use-subitems';

// The Table view (docs/05 §3.1): the one view for working through a sheet's items as rows. Desktop and tablets get
// the virtualised table of group cards; phones (< 640 px) get item cards grouped the same way. Above both: the
// empty states. The toolbar's status and owner filters (UI state) apply here.

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
  /** The sheet's sub-items, when it has them (docs/02 §12). */
  sub?: SubitemsState | null;
  subMatches?: ReadonlyMap<string, ReadonlySet<string>>;
  onOpenSubitem?(item: Item): void;
  /** The item the item panel shows (its row is marked). */
  currentItemId?: string | null;
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
  const inScope = useMemo(
    () => (p.onlyGroup ? p.data.items.filter((i) => i.groupId === p.onlyGroup) : p.data.items),
    [p.data.items, p.onlyGroup],
  );
  const total = inScope.length;
  const quickView = useGrid((s) => s.quick);
  const colFilters = useGrid((s) => s.colFilters);
  const valueFilter = useGrid((s) => s.valueFilter);
  const missingOnly = useGrid((s) => s.missingOnly);
  const store = useGridStore();
  const updateCounts = useUpdateSummaries(p.data.sheet.id, p.data.sheet.orgId);
  const items = useMemo(() => {
    const quick = applyColumnFilters(applyQuickView(p.items, quickView, p.ctx), colFilters, p.ctx);
    const field = valueFilter && p.data.fields.find((f) => f.id === valueFilter.fieldId);
    const byValue = field ? filterByKeys(quick, field, new Set([valueFilter.key]), p.ctx) : quick;
    return missingOnly
      ? byValue.filter((i) => missingRequired(i, p.data.fields, p.ctx).length > 0)
      : byValue;
  }, [p.items, quickView, colFilters, valueFilter, missingOnly, p.data.fields, p.ctx]);
  const filtered = p.filtered || items.length !== p.items.length;
  // Export to CSV writes what the Table shows
  useEffect(() => {
    store.setState({ shownIds: items.map((i) => i.id) });
  }, [items, store]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {total === 0 ? (
        <Notice>
          No items yet.{' '}
          {p.canEdit ? (
            <Button type="button" variant="link" className="h-auto p-0" onClick={p.onNew}>
              Add the first one.
            </Button>
          ) : null}
        </Notice>
      ) : items.length === 0 && filtered ? (
        <Notice>
          No items match these filters.{' '}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={() => {
              p.onClearFilters();
              store.getState().clearToolbarFilters();
            }}
          >
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
          visibleItems={items}
          viewCompare={p.compare}
          comments={updateCounts}
          sub={p.sub ?? null}
          onOpenSubitem={p.onOpenSubitem}
        />
      ) : (
        <div className="flex min-h-[240px] flex-1 flex-col">
          <Table
            data={p.data}
            ctx={p.ctx}
            actions={p.actions}
            canEdit={p.canEdit}
            isAdmin={p.isAdmin}
            onlyGroup={p.onlyGroup}
            nameWidth={p.narrow ? 200 : 322}
            addFocusTick={p.addFocusTick}
            onOpenItem={p.onOpenItem}
            visibleItems={items}
            viewCompare={p.compare}
            config={p.config}
            setConfig={p.setConfig}
            updateCounts={updateCounts}
            sub={p.sub ?? null}
            subMatches={p.subMatches}
            onOpenSubitem={p.onOpenSubitem}
            currentItemId={p.currentItemId ?? null}
          />
        </div>
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-line text-label-14 flex flex-wrap items-center gap-1 rounded-lg border border-dashed px-4 py-3">
      {children}
    </div>
  );
}
