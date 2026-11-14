import 'server-only';
import { cache } from 'react';
import { inboxRows, type ApprovalInstance, type InboxRow } from '@/engine/approvals';
import { fetchDirectory } from '@/lib/sheet-query';
import {
  DECISION_COLUMNS,
  INSTANCE_COLUMNS,
  toDecision,
  toInstance,
} from '@/server/approvals/rows';
import { getSession } from '@/server/auth';

// "Needs my approval" (docs/05 §4 My work): the approvals waiting for the signed-in person, under their own session
// and RLS (an instance is read only where its sheet is). Overdue first, then the oldest.

/** At most this many waiting approvals are listed. */
export const MAX_APPROVALS = 200;

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export const getMyApprovals = cache(async (orgId: string): Promise<InboxRow[] | null> => {
  const session = await getSession();
  if (!session) return null;
  const db = session.supabase;
  const me = session.user.id;
  const rows = must(
    await db
      .from('workflow_instances')
      .select(INSTANCE_COLUMNS)
      .eq('org_id', orgId)
      .eq('status', 'in_progress')
      .contains('step_approvers', [me])
      .order('step_started_at')
      .limit(MAX_APPROVALS),
  );
  const instances = rows.map(toInstance).filter((x): x is ApprovalInstance => !!x);
  if (instances.length === 0) return [];
  const itemIds = [...new Set(instances.map((i) => i.itemId))];
  const [decisions, items, directory] = await Promise.all([
    db
      .from('workflow_decisions')
      .select(DECISION_COLUMNS)
      .in(
        'instance_id',
        instances.map((i) => i.id),
      )
      .then(must),
    db
      .from('items')
      .select('id, sheet_id, display_id, name, archived_at, sheets(name, settings)')
      .in('id', itemIds)
      .then(must),
    fetchDirectory(db, orgId),
  ]);
  const live = new Map(items.filter((i) => !i.archived_at).map((i) => [i.id, i]));
  return inboxRows(
    instances,
    decisions.map(toDecision),
    me,
    {
      item: (id) => {
        const it = live.get(id);
        return it ? { displayId: it.display_id, name: it.name, sheetId: it.sheet_id } : undefined;
      },
      sheetName: (sheetId) =>
        [...live.values()].find((i) => i.sheet_id === sheetId)?.sheets?.name ?? 'Sheet',
      isRegister: (sheetId) =>
        (
          [...live.values()].find((i) => i.sheet_id === sheetId)?.sheets?.settings as
            { register?: string } | null | undefined
        )?.register === 'documents',
    },
    { people: new Map(directory.people.map((p) => [p.id, p])), now: new Date() },
  );
});
