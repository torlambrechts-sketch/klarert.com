'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SheetData } from '@/engine/sheet-data';
import type { Json } from '@/engine/types';
import {
  groupChanges,
  TREND_MAX_POINTS,
  trendFields,
  trendSince,
  type TrendChange,
} from '@/engine/values/trend';
import { createClient } from '@/lib/supabase/client';

// The history behind the Table's trend lines: the sheet's value.changed entries for its trend fields (risk scores,
// numbers with meter bands) over the last twelve months, in one read under the person's RLS. Loaded after the sheet
// so the Table renders first; read again (debounced) when one of those values changes, by a commit or realtime.

/** At most this many entries per sheet; each item and field keeps its newest TREND_MAX_POINTS. */
const LIMIT = 5000;
const DEBOUNCE = 1500;

export const trendsKey = (sheetId: string) => ['sheet-trends', sheetId] as const;

export function useTrendHistory(data: SheetData, enabled: boolean) {
  const db = useMemo(() => createClient(), []);
  const qc = useQueryClient();
  const fields = useMemo(() => trendFields(data.fields), [data.fields]);
  const fieldIds = useMemo(() => fields.map((f) => f.id).sort(), [fields]);
  const sheetId = data.sheet.id;
  const on = enabled && fieldIds.length > 0;
  const q = useQuery({
    queryKey: [...trendsKey(sheetId), fieldIds.join(',')],
    enabled: on,
    queryFn: async () => {
      const r = await db
        .from('activity_log')
        .select('item_id, field_id, at, old_value, new_value')
        .eq('sheet_id', sheetId)
        .eq('action', 'value.changed')
        .in('field_id', fieldIds)
        .gte('at', trendSince(new Date()))
        .order('at', { ascending: false })
        .limit(LIMIT);
      if (r.error) throw new Error(r.error.message);
      const rows: TrendChange[] = (r.data ?? []).flatMap((x) =>
        x.item_id && x.field_id
          ? [
              {
                itemId: x.item_id,
                fieldId: x.field_id,
                at: x.at,
                oldValue: x.old_value as Json | null,
                newValue: x.new_value as Json | null,
              },
            ]
          : [],
      );
      return groupChanges(rows, TREND_MAX_POINTS);
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // the trend fields' current values: when one changes, the log has a new entry to read
  const signature = useMemo(() => {
    if (!on) return '';
    let s = '';
    for (const item of data.items)
      for (const id of fieldIds) {
        const v = item.values[id];
        if (v !== undefined && v !== null) s += `${item.id}:${id}:${JSON.stringify(v)};`;
      }
    return s;
  }, [on, data.items, fieldIds]);
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!on) return;
    const first = seen.current === null;
    if (seen.current === signature) return;
    seen.current = signature;
    if (first) return;
    const t = setTimeout(
      () => void qc.invalidateQueries({ queryKey: trendsKey(sheetId) }),
      DEBOUNCE,
    );
    return () => clearTimeout(t);
  }, [signature, on, qc, sheetId]);

  return q.data ?? null;
}
