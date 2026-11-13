// Installs an OLDER version of a catalogue pack into a seeded workspace (the local stack, service role), so the
// upgrade spec has something to update. The app only ever installs the newest version; this stands in for a workspace
// that installed the pack before the new version shipped. Run by tests/e2e/pack-upgrades.spec.ts through tsx:
//   tsx tests/e2e/install-pack-version.ts <workspace slug> <pack key> <version> [level]
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { planInstall, writeInstall } from '@/server/packs/install';
import { readPackVersion } from '@/server/packs/upgrade';

async function main() {
  const [slug, key, version, level] = process.argv.slice(2);
  if (!slug || !key || !version) throw new Error('usage: <slug> <pack key> <version> [level]');
  const db = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: org } = await db.from('orgs').select('id').eq('slug', slug).single();
  if (!org) throw new Error(`no workspace ${slug}`);
  const pack = await readPackVersion(db, key, version);
  if (!pack) throw new Error(`no pack ${key} ${version}`);
  const plan = await planInstall(db, org.id, pack, {
    userId: randomUUID(),
    now: new Date(),
    newId: randomUUID,
    level: level ?? null,
  });
  if (plan.state !== 'ready') throw new Error(plan.preview.conflicts.join('\n'));
  const r = await writeInstall(db, org.id, plan);
  if (!r.ok) throw new Error(r.error.message);
  process.stdout.write(JSON.stringify({ installId: r.data.installId, refMap: r.data.refMap }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
