import 'server-only';
import { z } from 'zod';
import { fromDbError, invalid, ok, type Result } from '@/server/result';
import { withOrg } from './context';

// The inbox (docs/01 FR-36, docs/05 §2.3): mark one, some or all of my notifications in a workspace read. People may
// change read_at of their own notifications and nothing else (0012); requests are marked done by the database when
// the person changes the item.

const markReadInput = z.object({
  org: z.string().min(1).max(40),
  /** Omitted: all unread notifications of this workspace. */
  ids: z.array(z.uuid()).min(1).max(100).optional(),
});

export async function markNotificationsRead(raw: unknown): Promise<Result<{ marked: number }>> {
  const p = markReadInput.safeParse(raw);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId, user }) => {
      let q = supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('user_id', user.id)
        .is('read_at', null);
      if (v.ids) q = q.in('id', v.ids);
      const { data, error } = await q.select('id');
      if (error) return fromDbError(error);
      return ok({ marked: data?.length ?? 0 });
    },
    'markNotificationsRead',
  );
}

const orgInput = z.object({ org: z.string().min(1).max(40) });

/**
 * The person opened an item's activity log: one of Home's Getting started steps (docs/05 §4). Kept on their own
 * account (auth user metadata), written once.
 */
export async function noteActivityLogOpened(raw: unknown): Promise<Result<null>> {
  const p = orgInput.safeParse(raw);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'member',
    async ({ supabase, user }) => {
      if ((user.user_metadata as { opened_activity_log?: unknown })?.opened_activity_log === true)
        return ok(null);
      const { error } = await supabase.auth.updateUser({ data: { opened_activity_log: true } });
      if (error) return fromDbError(error);
      return ok(null);
    },
    'noteActivityLogOpened',
  );
}
