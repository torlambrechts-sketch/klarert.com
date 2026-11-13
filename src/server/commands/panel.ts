import 'server-only';
import type { Item } from '@/engine/types';
import { searchItemsInput, verifyActivityInput } from '@/lib/schemas/panel';
import { likePattern } from '@/engine/search';
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

/**
 * Items of a sheet whose display id or name contains the query (link picker), newest ids last. With `library`, items
 * of every library sheet the person can read, also found by their reference number, with each sheet's name.
 */
export async function searchItems(
  input: unknown,
): Promise<Result<{ items: Item[]; sheetNames: Record<string, string> }>> {
  const p = searchItemsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId }) => {
      // PostgREST filter syntax: strip the characters that would break or widen the or() expression
      const s = v.query
        .trim()
        .replace(/[%,()*\\:."]/g, ' ')
        .trim();
      if (v.library) {
        const { data: libs, error: e1 } = await supabase
          .from('sheets')
          .select('id, name')
          .eq('org_id', orgId)
          .eq('is_library', true)
          .is('archived_at', null)
          .is('parent_sheet_id', null);
        if (e1) return fromDbError(e1);
        const ids = (libs ?? []).map((l) => l.id);
        if (ids.length === 0) return ok({ items: [], sheetNames: {} });
        const base = () =>
          supabase
            .from('items')
            .select(ITEM_COLUMNS)
            .in('sheet_id', ids)
            .is('archived_at', null)
            .order('sheet_id')
            .order('seq')
            .limit(30);
        // a reference number keeps its dots and brackets: matched on its own, as a literal
        const ref = v.query.trim();
        const [byText, byRef] = await Promise.all([
          s ? base().or(`name.ilike.%${s}%,display_id.ilike.%${s}%`) : base(),
          ref
            ? base().ilike('requirement_ref', `%#${likePattern(ref).slice(1, -1)}%`)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (byText.error) return fromDbError(byText.error);
        if (byRef.error) return fromDbError(byRef.error);
        const seen = new Set<string>();
        const items = [...(byRef.data ?? []), ...(byText.data ?? [])]
          .filter((r) => !seen.has(r.id) && seen.add(r.id))
          .slice(0, 30)
          .map(toItem);
        return ok({
          items,
          sheetNames: Object.fromEntries((libs ?? []).map((l) => [l.id, l.name])),
        });
      }
      const { data: sheet } = await supabase
        .from('sheets')
        .select('id, org_id, name')
        .eq('id', v.sheetId!)
        .maybeSingle();
      if (!sheet || sheet.org_id !== orgId)
        return fail('not_found', 'This sheet no longer exists.');
      let q = supabase
        .from('items')
        .select(ITEM_COLUMNS)
        .eq('sheet_id', v.sheetId!)
        .is('archived_at', null)
        .order('seq')
        .limit(20);
      if (s) q = q.or(`name.ilike.%${s}%,display_id.ilike.%${s}%`);
      const { data, error } = await q;
      if (error) return fromDbError(error);
      return ok({ items: (data ?? []).map(toItem), sheetNames: { [sheet.id]: sheet.name } });
    },
    'searchItems',
  );
}
