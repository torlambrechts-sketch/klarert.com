import 'server-only';
import { z } from 'zod';
import {
  likePattern,
  MAX_QUERY,
  normaliseQuery,
  rankSearch,
  type ItemHit,
  type SearchResults,
} from '@/engine/search';
import { invalid, ok, type Result } from '@/server/result';
import { withOrg } from './context';

// Global search (docs/01 FR-5, docs/05 §2.3): sheets by name, items by display id or name, items by person. Runs with
// the person's client, so RLS decides what is found. Only sheet names, item names, display ids and people names are
// matched: values (and so protected values) are never searched.

const input = z.object({
  org: z.string().min(1).max(40),
  q: z.string().max(200),
});

const CANDIDATES = 30;
const PEOPLE = 5;

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export async function search(raw: unknown): Promise<Result<SearchResults>> {
  const p = input.safeParse(raw);
  if (!p.success) return invalid(p.error);
  const q = normaliseQuery(p.data.q).slice(0, MAX_QUERY);
  if (!q) return ok({ sheets: [], items: [] });
  return withOrg(
    p.data.org,
    'member',
    async ({ supabase: db, orgId }) => {
      const like = likePattern(q);
      const [sheets, byName, byId, people] = await Promise.all([
        db.from('sheets').select('id, name').eq('org_id', orgId).is('archived_at', null).then(must),
        db
          .from('items')
          .select('id, sheet_id, display_id, name')
          .eq('org_id', orgId)
          .is('archived_at', null)
          .ilike('name', like)
          .order('updated_at', { ascending: false })
          .limit(CANDIDATES)
          .then(must),
        db
          .from('items')
          .select('id, sheet_id, display_id, name')
          .eq('org_id', orgId)
          .is('archived_at', null)
          .ilike('display_id', like)
          .order('display_id')
          .limit(CANDIDATES)
          .then(must),
        db
          .from('memberships')
          .select('user_id, profiles!inner(display_name)')
          .eq('org_id', orgId)
          .ilike('profiles.display_name', like)
          .limit(PEOPLE)
          .then(must),
      ]);
      const sheetName = new Map(sheets.map((s) => [s.id, s.name]));
      const names = new Map(people.map((m) => [m.user_id, m.profiles.display_name]));
      const viaPeople =
        names.size === 0
          ? []
          : must(
              await db.rpc('items_for_people', {
                p_org: orgId,
                p_people: [...names.keys()],
                p_limit: CANDIDATES,
              }),
            );
      const hit = (
        r: { id: string; sheet_id: string; display_id: string; name: string },
        person?: string,
      ): ItemHit[] => {
        const s = sheetName.get(r.sheet_id);
        return s === undefined
          ? []
          : [
              {
                id: r.id,
                sheetId: r.sheet_id,
                sheetName: s,
                displayId: r.display_id,
                name: r.name,
                ...(person ? { person } : {}),
              },
            ];
      };
      const items = [
        ...byId.flatMap((r) => hit(r)),
        ...byName.flatMap((r) => hit(r)),
        ...viaPeople.flatMap((r) => {
          const text = JSON.stringify(r.values ?? {});
          const who = [...names].find(([id]) => text.includes(id))?.[1];
          return hit(r, who);
        }),
      ];
      return ok(rankSearch(q, sheets, items));
    },
    'search',
  );
}
