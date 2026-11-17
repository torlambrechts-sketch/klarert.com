// Purging retired copies of the demo workspace (docs/17 The live demo). `pnpm seed:demo` with DEMO_RESET=1 renames the
// live copy aside (`meridian-demo-retired-<time>`, members removed) and builds a new one; this removes the retired ones,
// so the nightly rebuild leaves one live demo workspace. Run by `pnpm seed:demo:purge` (scripts/seed.ts --demo-purge),
// which owns the service role (CLAUDE.md rule 6) and hands it here.
//
// For each retired copy: its stored files are removed through the Storage API (Storage refuses SQL deletes), then
// `purge_demo_workspace` (0078) deletes the workspace and everything in it. The database refuses anything that is not
// marked as a demo copy (settings.demo, set by the seed only) or still has members, whatever this script asks.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import { DEMO_SLUG, RETIRED_PREFIX } from './slug';

type Db = SupabaseClient<Database>;

const BUCKET = 'files';
const PER_REMOVE = 100;

export interface PurgeResult {
  purged: { slug: string; items: number; activity: number; files: number }[];
  /** Copies left in place, with the reason (a later run tries again). */
  kept: { slug: string; reason: string }[];
}

/** Removes every retired demo copy; the live one at /meridian-demo is never touched. */
export async function purgeRetired(admin: Db): Promise<PurgeResult> {
  const { data, error } = await admin
    .from('orgs')
    .select('id, slug, settings, created_at')
    .like('slug', `${RETIRED_PREFIX}%`)
    .order('created_at');
  if (error) throw new Error(`look-up: ${error.message}`);
  const out: PurgeResult = { purged: [], kept: [] };
  for (const o of data ?? []) {
    if (o.slug === DEMO_SLUG) continue;
    const settings = (o.settings ?? {}) as { demo?: unknown };
    if (settings.demo !== true) {
      out.kept.push({ slug: o.slug, reason: 'not marked as a demo copy (built before 0078)' });
      continue;
    }
    const files = await admin.from('files').select('storage_path').eq('org_id', o.id);
    if (files.error) throw new Error(`files of /${o.slug}: ${files.error.message}`);
    const paths = [...new Set((files.data ?? []).map((f) => f.storage_path).filter(Boolean))];
    let failed = 0;
    for (let i = 0; i < paths.length; i += PER_REMOVE) {
      const batch = paths.slice(i, i + PER_REMOVE);
      const r = await admin.storage.from(BUCKET).remove(batch);
      if (r.error) failed += batch.length;
    }
    if (failed) {
      // the rows would go and leave the objects behind with nothing pointing at them: try again next time
      out.kept.push({ slug: o.slug, reason: `${failed} stored files could not be removed` });
      continue;
    }
    const r = await admin.rpc('purge_demo_workspace', { p_org: o.id });
    if (r.error) {
      out.kept.push({ slug: o.slug, reason: r.error.message });
      continue;
    }
    const d = r.data as { items: number; activity: number; files: number };
    out.purged.push({ slug: o.slug, items: d.items, activity: d.activity, files: d.files });
  }
  return out;
}
