import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { releaseHold } from '@/server/automations/holds';

// Rows whose person never finished them (closed the tab): release holds idle for 2 minutes and run their automations
// as the person who edited them. Called by the scheduler with the service-role client.

const IDLE_MS = 2 * 60 * 1000;

export async function releaseIdleHolds(db: SupabaseClient<Database>, now: Date): Promise<number> {
  const { data, error } = await db
    .from('items')
    .select('id, org_id, sheet_id')
    .lt('held_at', new Date(now.getTime() - IDLE_MS).toISOString())
    .limit(200);
  if (error) throw new Error(error.message);
  let released = 0;
  for (const it of data ?? []) {
    const r = await releaseHold(
      db,
      { id: it.id, sheetId: it.sheet_id, orgId: it.org_id },
      { userId: null },
    );
    if (r) released += 1;
  }
  return released;
}
