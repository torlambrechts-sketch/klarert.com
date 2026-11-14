// Installs an OLDER version (or one with a level) of a catalogue pack into a seeded workspace (the local stack, service
// role), so the upgrade specs have something to update. The app only ever installs the newest version; this stands in
// for a workspace that installed the pack before the new version shipped. Run by tests/e2e/pack-upgrades.spec.ts and
// core-upgrade.spec.ts through tsx:
//   tsx tests/e2e/install-pack-version.ts <workspace slug> <pack key> <version> [level]
//
// The catalogue keeps every version ever written (docs/11 Upgrades), but the repository ships only the newest, so a
// database made from scratch (CI, `pnpm db:reset`) has no older versions. The versions these specs start from, and
// the ones they update to, are kept in tests/e2e/fixtures/catalogue (taken from the repository's history) and written
// to the catalogue here when it does not have them yet. A version the catalogue already has is left as it is.
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { frameworkToPack } from '@/engine/frameworks/pack';
import type { PackManifest } from '@/engine/packs/types';
import { parseFramework } from '@/lib/frameworks/schema';
import { packHash } from '@/lib/packs/hash';
import { parsePack } from '@/lib/packs/manifest';
import { planInstall, writeInstall } from '@/server/packs/install';
import { readPackVersion } from '@/server/packs/upgrade';

type Db = ReturnType<typeof createClient<Database>>;

const FIXTURES = join(__dirname, 'fixtures', 'catalogue');

/** The archived manifests: pack files (`<key>@<version>.json`) and framework files (`framework-…@<revision>.json`). */
function archived(): PackManifest[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const raw = JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')) as unknown;
      // the edition status fields came to the framework format after revision 1 (docs/12 Standards watch)
      return f.startsWith('framework-')
        ? parsePack(
            frameworkToPack(
              parseFramework({
                status: 'current',
                statusCheckedOn: '2026-11-13',
                ...(raw as object),
              }),
            ),
          )
        : parsePack(raw);
    });
}

/** Write the archived versions of a pack the catalogue does not have (parallel workers may race: ignore duplicates). */
async function ensureArchived(db: Db, key: string) {
  for (const m of archived().filter((p) => p.key === key)) {
    const { error } = await db.from('packs').upsert(
      {
        key: m.key,
        version: m.version,
        title: m.title,
        description: m.description,
        manifest: m as never,
        hash: packHash(m),
      } as never,
      { onConflict: 'key,version', ignoreDuplicates: true },
    );
    if (error) throw new Error(`archived pack ${m.key} ${m.version}: ${error.message}`);
  }
}

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
  await ensureArchived(db, key);
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
