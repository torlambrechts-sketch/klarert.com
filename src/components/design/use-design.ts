'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { readDesignAction } from '@/app/[org]/design/actions';
import type { DesignRead } from '@/server/design/read';

// The Design read (docs/05 §3.8) as server state: the configuration a sheet's flow is derived from. Refreshed after
// every save in the side window, so health, provenance and the list follow the change.

export const designKey = (org: string, sheetId: string | null) => ['design', org, sheetId] as const;

export function useDesign(org: string, sheetId: string | null) {
  return useQuery({
    queryKey: designKey(org, sheetId),
    queryFn: async (): Promise<DesignRead> => {
      const r = await readDesignAction({ org, sheetId });
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useRefreshDesign(org: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['design', org] });
}
