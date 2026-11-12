'use client';

import { useMemo } from 'react';
import type { Ctx, Group, Item } from '@/engine/types';
import { virtualGroups } from '@/engine/views/group-by';
import { useGrid } from '@/components/grid/grid-store';

/**
 * The groups the Table (and the phone cards) show: the sheet's own, or virtual ones when "Group by" names a field.
 * Virtual groups are rebuilt from the visible items; moving rows between them and "+ Add" are off.
 */
export function useTableGroups(input: {
  groups: Group[];
  sheetId: string;
  ctx: Ctx;
  items: Item[];
  onlyGroup: string | null;
}) {
  const groupBy = useGrid((s) => s.groupBy);
  const { groups, sheetId, ctx, items, onlyGroup } = input;
  return useMemo(() => {
    const field = groupBy ? [...ctx.fieldsByKey.values()].find((f) => f.id === groupBy) : undefined;
    if (!field) return { groups, groupOf: undefined, virtual: false, onlyGroup };
    const v = virtualGroups(field, items, ctx, sheetId);
    return { groups: v.groups, groupOf: v.groupOf, virtual: true, onlyGroup: null };
  }, [groupBy, groups, sheetId, ctx, items, onlyGroup]);
}
