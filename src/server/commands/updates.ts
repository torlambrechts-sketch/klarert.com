import 'server-only';
import { mentionedUserIds, parseMentions, type MentionCandidate } from '@/engine/mentions';
import { deleteUpdateInput, editUpdateInput, postUpdateInput } from '@/lib/schemas/panel';
import type { Database } from '@/lib/database.types';
import type { Db } from '@/lib/sheet-query';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { withOrg } from './context';

// Updates (docs/01 FR-28, FR-36): people post on an item and @mention people or job roles. Mentions are read back
// from the body with the same parser the composer uses; a job role reaches everyone whose job title is that role.
// Notifications are written by notify_mention (author-only, same workspace), so no service role is needed here.
// The author may edit or delete their update for 15 minutes; the database logs both on the item's chain.

export type UpdateRow = Database['public']['Tables']['item_updates']['Row'];
export type UpdateResult = { update: UpdateRow; notified: number };

/** People and job roles of the workspace as mention candidates, and who holds each role. */
async function mentionDirectory(db: Db, orgId: string) {
  const [members, roles] = await Promise.all([
    db.from('memberships').select('user_id, job_title, profiles(display_name)').eq('org_id', orgId),
    db.from('job_roles').select('id, name').eq('org_id', orgId),
  ]);
  const people = (members.data ?? []).filter((m) => m.profiles);
  const candidates: MentionCandidate[] = [
    ...people.map((m) => ({
      kind: 'person' as const,
      id: m.user_id,
      name: m.profiles!.display_name,
    })),
    ...(roles.data ?? []).map((r) => ({ kind: 'role' as const, id: r.id, name: r.name })),
  ];
  const roleName = new Map((roles.data ?? []).map((r) => [r.id, r.name.trim().toLowerCase()]));
  const holders = (roleId: string) =>
    people
      .filter((m) => m.job_title && m.job_title.trim().toLowerCase() === roleName.get(roleId))
      .map((m) => m.user_id);
  return { candidates, holders };
}

async function mentionsOf(db: Db, orgId: string, body: string, authorId: string) {
  const dir = await mentionDirectory(db, orgId);
  return mentionedUserIds(parseMentions(body, dir.candidates), dir.holders, authorId);
}

async function notify(db: Db, updateId: string, userIds: string[]): Promise<Result<number>> {
  if (userIds.length === 0) return ok(0);
  const { data, error } = await db.rpc('notify_mention', {
    p_update: updateId,
    p_user_ids: userIds,
  });
  return error ? fromDbError(error) : ok(data ?? 0);
}

export async function postUpdate(input: unknown): Promise<Result<UpdateResult>> {
  const p = postUpdateInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, user }) => {
      const { data: item } = await supabase
        .from('items')
        .select('id, org_id, archived_at')
        .eq('id', v.itemId)
        .maybeSingle();
      if (!item || item.org_id !== orgId || item.archived_at)
        return fail('not_found', 'This item no longer exists or was archived.');
      const mentions = await mentionsOf(supabase, orgId, v.body, user.id);
      const { data, error } = await supabase
        .from('item_updates')
        .insert({
          org_id: orgId,
          item_id: v.itemId,
          author_id: user.id,
          kind: 'update',
          body: v.body,
          mentions,
        })
        .select('*')
        .single();
      if (error) return fromDbError(error);
      const n = await notify(supabase, data.id, mentions);
      if (!n.ok) return n;
      return ok({ update: data, notified: n.data });
    },
    'postUpdate',
  );
}

export async function editUpdate(input: unknown): Promise<Result<UpdateResult>> {
  const p = editUpdateInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, user }) => {
      const { data: before } = await supabase
        .from('item_updates')
        .select('id, org_id, mentions')
        .eq('id', v.updateId)
        .maybeSingle();
      if (!before || before.org_id !== orgId) return fail('not_found', 'This update was deleted.');
      const mentions = await mentionsOf(supabase, orgId, v.body, user.id);
      const { data, error } = await supabase.rpc('edit_update', {
        p_update: v.updateId,
        p_body: v.body,
        p_mentions: mentions,
      });
      if (error) return fromDbError(error);
      // only people the edit newly mentions hear about it
      const n = await notify(
        supabase,
        v.updateId,
        mentions.filter((id) => !before.mentions.includes(id)),
      );
      if (!n.ok) return n;
      return ok({ update: data, notified: n.data });
    },
    'editUpdate',
  );
}

export async function deleteUpdate(input: unknown): Promise<Result<{ id: string }>> {
  const p = deleteUpdateInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId }) => {
      const { data: row } = await supabase
        .from('item_updates')
        .select('id, org_id')
        .eq('id', v.updateId)
        .maybeSingle();
      if (!row || row.org_id !== orgId) return fail('not_found', 'This update was deleted.');
      const { error } = await supabase.rpc('delete_update', { p_update: v.updateId });
      return error ? fromDbError(error) : ok({ id: v.updateId });
    },
    'deleteUpdate',
  );
}
