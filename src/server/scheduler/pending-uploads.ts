import 'server-only';
import { stalePendingUploads, type PendingUpload } from '@/engine/files';
import type { Db } from '@/lib/sheet-query';

// Abandoned uploads (docs/02 §8, security review 9.1 item 2): the browser put the object in the bucket but the tab
// closed before confirmUpload, so no `files` row holds it. Once an hour the scheduler (service role, CLAUDE.md rule 6)
// lists those older than an hour (stale_pending_uploads, 0067) and removes them through the Storage API, which deletes
// the object and its storage.objects row. There is no pending row elsewhere: `files` is written only on confirmation.

const BUCKET = 'files';
/** At most this many per run (the cron route has 60 seconds); the rest go on the next hour. */
const PER_RUN = 500;
const PER_REMOVE = 100;

export interface PendingCleanup {
  orgId: string;
  removed: number;
  failed: number;
}

/** Remove abandoned uploads, oldest first; one summary per workspace that had any. */
export async function removeStalePendingUploads(db: Db, now: Date): Promise<PendingCleanup[]> {
  const { data, error } = await db.rpc('stale_pending_uploads', {
    p_before: now.toISOString(),
    p_limit: PER_RUN,
  });
  if (error) throw new Error(error.message);
  const candidates: PendingUpload[] = (data ?? []).map((r) => ({
    orgId: r.org_id,
    path: r.name,
    writtenAt: r.written_at,
  }));
  const out: PendingCleanup[] = [];
  for (const [orgId, paths] of stalePendingUploads(candidates, now)) {
    const summary: PendingCleanup = { orgId, removed: 0, failed: 0 };
    for (let i = 0; i < paths.length; i += PER_REMOVE) {
      const batch = paths.slice(i, i + PER_REMOVE);
      const { data: gone, error: e } = await db.storage.from(BUCKET).remove(batch);
      if (e) summary.failed += batch.length;
      else {
        summary.removed += gone?.length ?? 0;
        summary.failed += batch.length - (gone?.length ?? 0);
      }
    }
    out.push(summary);
  }
  return out;
}
