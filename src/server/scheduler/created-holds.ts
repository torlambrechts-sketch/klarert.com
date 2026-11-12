import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { runAutomations } from '@/server/automations';

// A new row whose person never left it (closed the tab): release its item_created hold after 10 minutes and run the
// automations then, as the person who created it. Called by the scheduler with the service-role client.

const STALE_MS = 10 * 60 * 1000;

export async function releaseStaleHolds(db: SupabaseClient<Database>, now: Date): Promise<number> {
  const { data, error } = await db
    .from('items')
    .select('id, org_id, sheet_id, created_by')
    .lt('created_pending_at', new Date(now.getTime() - STALE_MS).toISOString())
    .limit(200);
  if (error) throw new Error(error.message);
  let released = 0;
  for (const it of data ?? []) {
    const { data: mine } = await db.rpc('release_item_created', { p_item: it.id });
    if (!mine) continue;
    released += 1;
    const actor = it.created_by
      ? { kind: 'user' as const, id: it.created_by }
      : { kind: 'system' as const, id: null };
    await runAutomations([{ type: 'item.created', sheetId: it.sheet_id, itemId: it.id, actor }], {
      orgId: it.org_id,
      userId: it.created_by,
      starter: actor,
    });
  }
  return released;
}
