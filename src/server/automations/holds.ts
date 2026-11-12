import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { runAutomations, valueEvents, type Actor, type AutomationEvent } from './index';

// Edit holds (0015_item_edit_holds.sql): while a person edits a row its automations wait. Releasing the hold runs them
// once against the final values: item_created for a new row, else one value change per field that differs from the
// values at the start of the edit. Used by the finishItem command and by the scheduler for abandoned holds.

type Db = SupabaseClient<Database>;
type Snapshot = { created?: boolean; values?: Record<string, unknown>; by?: string | null };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface Released {
  messages: string[];
  /** Names of the automations that ran, for the "Ran: …" toast. */
  ran: string[];
}

export async function releaseHold(
  db: Db,
  item: { id: string; sheetId: string; orgId: string },
  who: { userId: string | null; workspace?: string },
): Promise<Released | null> {
  const { data, error } = await db.rpc('release_item', { p_item: item.id });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const snap = data as Snapshot;
  const userId = who.userId ?? snap.by ?? null;
  const actor: Actor = userId ? { kind: 'user', id: userId } : { kind: 'system', id: null };
  // a new row runs item_created first, then one value change per field that differs from the values it was
  // created with (so "Owner becomes …" still fires for a new row); an existing row only the value changes
  const { data: row } = await db.from('items').select('values').eq('id', item.id).maybeSingle();
  const before = snap.values ?? {};
  const after = (row?.values ?? {}) as Record<string, unknown>;
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => !same(before[k], after[k]),
  );
  const events: AutomationEvent[] = [
    ...(snap.created
      ? [{ type: 'item.created' as const, sheetId: item.sheetId, itemId: item.id, actor }]
      : []),
    ...valueEvents(
      { sheetId: item.sheetId, id: item.id, values: before },
      { values: after },
      changed,
      actor,
    ),
  ];
  const out = await runAutomations(events, {
    orgId: item.orgId,
    userId,
    workspace: who.workspace,
    starter: actor,
  });
  const ids = [...new Set(out.runs.map((r) => r.automationId))];
  let ran: string[] = [];
  if (ids.length) {
    const { data: names } = await db.from('automations').select('id, name').in('id', ids);
    ran = (names ?? []).map((a) => a.name);
  }
  return { messages: out.messages, ran };
}
