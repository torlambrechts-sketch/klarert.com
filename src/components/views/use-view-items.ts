'use client';

import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { filterItemIdsAction } from '@/app/[org]/s/view-actions';
import { resolveFieldType } from '@/engine/fields/resolve';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Item } from '@/engine/types';
import {
  applyView,
  CLIENT_FILTER_LIMIT,
  sortComparator,
  splitConditions,
} from '@/engine/views/apply';
import type { ViewConfig } from '@/engine/views/config';

/**
 * The items a view shows: the second panel's group, the view's conditions (AND), the sheet search, the sort.
 * Sheets above 2 000 items ask the server for the matching ids (docs/03 §4); conditions on calculated columns and
 * the search still run here. Until the server answers, everything runs here (the items are loaded anyway).
 */
export function useViewItems(input: {
  org: string;
  data: SheetData;
  ctx: Ctx;
  config: ViewConfig;
  search: string;
  onlyGroup: string | null;
}) {
  const { org, data, ctx, config, search, onlyGroup } = input;
  const large = data.items.length > CLIENT_FILTER_LIMIT;
  const valid = useMemo(() => splitConditions(config.filters, ctx).valid, [config.filters, ctx]);
  const server = useQuery({
    queryKey: ['filter-ids', data.sheet.id, valid, data.items.length],
    enabled: large && valid.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async () => {
      const r = await filterItemIdsAction({ org, sheetId: data.sheet.id, conditions: valid });
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });
  const computedFilter = valid.some((c) => {
    const f = ctx.fieldsByKey.get(c.fieldKey);
    return !!f && resolveFieldType(f.type)?.storage === 'computed';
  });

  const items = useMemo(() => {
    const base = onlyGroup ? data.items.filter((i: Item) => i.groupId === onlyGroup) : data.items;
    const fromServer = large && valid.length > 0 && server.data && !server.isPlaceholderData;
    return applyView({
      items: base,
      fields: data.fields,
      ctx,
      conditions: fromServer
        ? server.data!.clientOnly.map((i) => valid[i]!).filter(Boolean)
        : valid,
      sort: config.sort,
      search,
      serverIds: fromServer ? new Set(server.data!.ids) : null,
    });
  }, [
    data.items,
    data.fields,
    onlyGroup,
    large,
    valid,
    server.data,
    server.isPlaceholderData,
    ctx,
    config.sort,
    search,
  ]);

  const compare = useMemo(
    () => (config.sort.length ? sortComparator(config.sort, ctx) : null),
    [config.sort, ctx],
  );

  return {
    items,
    compare,
    /** Large sheet with a filter on a calculated column: say it applies to loaded items. */
    computedNotice: large && computedFilter,
    filtered: valid.length > 0 || search.trim() !== '',
  };
}
