'use client';

import { useMemo } from 'react';
import { sheetCtx, withParent, type SheetData } from '@/engine/sheet-data';
import type { Ctx } from '@/engine/types';
import {
  useSheetActions,
  useSheetQuery,
  useSheetRealtime,
  type SheetActions,
} from '@/components/grid/use-sheet';

// The sub-items of an open sheet (docs/02 §12): the hidden child sheet as a sheet of its own in the TanStack cache
// (its own realtime channel, the same optimistic write actions), and its Ctx with the parents loaded.

export interface SubitemsState {
  data: SheetData;
  ctx: Ctx;
  actions: SheetActions;
}

export interface SubitemsHandle {
  /** null while the sheet has no sub-items or they are loading. */
  state: SubitemsState | null;
  loading: boolean;
  error: Error | null;
  refetch(): void;
}

export function useSubitems(
  org: string,
  childSheetId: string | null,
  parent: SheetData | undefined,
  env: { now: Date; timeZone: string; userId: string; isAdmin: boolean },
): SubitemsHandle {
  const id = childSheetId ?? '00000000-0000-0000-0000-000000000000';
  const query = useSheetQuery(id, !!childSheetId);
  const actions = useSheetActions(org, id);
  useSheetRealtime(childSheetId, actions.pending);
  const data = childSheetId ? query.data : undefined;
  const ctx = useMemo(
    () =>
      data
        ? sheetCtx(withParent(data, parent), {
            ...env,
            newId: (p) => `${p}${Math.random().toString(36).slice(2, 8)}`,
          })
        : null,
    // env is spread: its fields are the dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, parent, env.now, env.timeZone, env.userId, env.isAdmin],
  );
  return {
    state: data && ctx ? { data, ctx, actions } : null,
    loading: !!childSheetId && query.isPending,
    error: childSheetId && query.isError ? query.error : null,
    refetch: () => void query.refetch(),
  };
}
