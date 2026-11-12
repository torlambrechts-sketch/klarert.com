import 'server-only';
import type { Item } from '@/engine/types';
import { searchItemsInput, verifyActivityInput } from '@/lib/schemas/panel';
import { ITEM_COLUMNS, toItem } from '@/lib/sheet-rows';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { withOrg } from './context';

// Reads the item panel asks the server for: the audit check (FR-40) and the link picker's search (docs/03 link).

export type VerifyResult =
  | { ok: true; entries: number; lastHash: string | null }
  | { ok: false; entries: number; firstBadId: number };

/** Recompute the item's hash chain with verify_activity_chain. */
export async function verifyActivity(input: unknown): Promise<Result<VerifyResult>> {
  const p = verifyActivityInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId }) => {
      const { data: item } = await supabase
        .from('items')
        .select('id, org_id')
        .eq('id', v.itemId)
        .maybeSingle();
      if (!item || item.org_id !== orgId) return fail('not_found', 'This item no longer exists.');
      const { data, error } = await supabase.rpc('verify_activity_chain', { p_chain_key: item.id });
      if (error) return fromDbError(error);
      const r = (data ?? {}) as {
        ok?: boolean;
        entries?: number;
        last_hash?: string;
        first_bad_id?: number;
      };
      return ok(
        r.ok
          ? { ok: true, entries: r.entries ?? 0, lastHash: r.last_hash ?? null }
          : { ok: false, entries: r.entries ?? 0, firstBadId: r.first_bad_id ?? 0 },
      );
    },
    'verifyActivity',
  );
}

/** Items of a sheet whose display id or name contains the query (link picker), newest ids last. */
export async function searchItems(input: unknown): Promise<Result<{ items: Item[] }>> {
  const p = searchItemsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId }) => {
      const { data: sheet } = await supabase
        .from('sheets')
        .select('id, org_id')
        .eq('id', v.sheetId)
        .maybeSingle();
      if (!sheet || sheet.org_id !== orgId)
        return fail('not_found', 'This sheet no longer exists.');
      let q = supabase
        .from('items')
        .select(ITEM_COLUMNS)
        .eq('sheet_id', v.sheetId)
        .is('archived_at', null)
        .order('seq')
        .limit(20);
      // PostgREST filter syntax: strip the characters that would break or widen the or() expression
      const s = v.query
        .trim()
        .replace(/[%,()*\\:."]/g, ' ')
        .trim();
      if (s) q = q.or(`name.ilike.%${s}%,display_id.ilike.%${s}%`);
      const { data, error } = await q;
      if (error) return fromDbError(error);
      return ok({ items: (data ?? []).map(toItem) });
    },
    'searchItems',
  );
}
