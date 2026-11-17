// Local seed (docs/02 §11): people from templates/first-sheet.json, the Meridian workspace, teams, job roles, entity,
// sites, the first folder, and the template's two sheets with items, links and automations (the importer, M10).
// Safe to run repeatedly: nothing is duplicated.
// Run: pnpm seed   (reads .env.local; refuses non-local Supabase unless SEED_ALLOW_REMOTE=1)
// Options (environment): SEED_WORKSPACE=<slug> and SEED_WORKSPACE_NAME=<name> seed another workspace with the same
// people (the first-sheet e2e test uses a fresh one per run); SEED_SHEETS=0 leaves it empty (docs/07 Part A).
//
// The demo workspace: `pnpm seed:demo` (this file with --demo, run with scripts/demo/runtime.cjs preloaded) writes the
// catalogue and then builds Meridian Components Ltd at /meridian-demo (scripts/demo/index.ts, docs/17-demo-workspace.md)
// instead of the first-sheet workspace. DEMO_PASSWORD is the demo login's password: required for a non-local
// Supabase, `meridian-demo-local` by default on the local stack. DEMO_RESET=1 moves an existing demo workspace aside
// and builds a new one; DEMO_TODAY=YYYY-MM-DD dates the content from another day (default: today, Europe/London).
// The demo login is a read-only viewer; DEMO_ADMIN_EMAIL with DEMO_ADMIN_PASSWORD (both or neither) adds the owner's
// own admin login. `pnpm seed:demo:purge` (this file with --demo-purge) removes the retired copies DEMO_RESET leaves
// (scripts/demo/purge.ts, migration 0078), so the nightly rebuild (.github/workflows/demo-nightly.yml) leaves one.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '../src/lib/database.types';
import { parseTemplate } from '../src/lib/templates/schema';
import { repoPacks } from '../src/lib/packs/catalogue';
import { frameworkPacks, repoCrosswalks, repoFrameworks } from '../src/lib/frameworks/catalogue';
import { syncFrameworks } from '../src/server/frameworks/catalogue';
import { syncCatalogue } from '../src/server/packs/install';
import { importTemplate } from '../src/server/templates/importer';
import { DEMO_SLUG } from './demo/slug';

const env = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    SEED_ALLOW_REMOTE: z.string().optional(),
    SEED_WORKSPACE: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,47}$/)
      .default('meridian'),
    SEED_WORKSPACE_NAME: z.string().min(1).max(120).optional(),
    SEED_SHEETS: z.enum(['0', '1']).default('1'),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20).optional(),
    DEMO_PASSWORD: z.string().optional(),
    DEMO_RESET: z.enum(['0', '1']).default('0'),
    DEMO_TODAY: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    DEMO_ADMIN_EMAIL: z.string().optional(),
    DEMO_ADMIN_PASSWORD: z.string().optional(),
  })
  .parse(process.env);

const DEMO = process.argv.includes('--demo');
const PURGE = process.argv.includes('--demo-purge');

const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
if (!['127.0.0.1', 'localhost'].includes(host) && env.SEED_ALLOW_REMOTE !== '1') {
  console.error(
    `Refusing to seed ${host}. Set SEED_ALLOW_REMOTE=1 to seed a hosted project on purpose.`,
  );
  process.exit(1);
}

const LOCAL_DEMO_PASSWORD = 'meridian-demo-local';
let demoPassword = '';
if (DEMO) {
  const local = ['127.0.0.1', 'localhost'].includes(host);
  demoPassword = env.DEMO_PASSWORD || (local ? LOCAL_DEMO_PASSWORD : '');
  if (!demoPassword) {
    console.error(
      'Set DEMO_PASSWORD: the demo login needs a password of its own on a hosted project.',
    );
    process.exit(1);
  }
  if (demoPassword.length < 12) {
    console.error('DEMO_PASSWORD must be at least 12 characters.');
    process.exit(1);
  }
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error('Set NEXT_PUBLIC_SUPABASE_ANON_KEY: the demo is written by signed-in people.');
    process.exit(1);
  }
  if (!(globalThis as { __demoCookieJar?: unknown }).__demoCookieJar) {
    console.error('Run the demo with `pnpm seed:demo` (it preloads scripts/demo/runtime.cjs).');
    process.exit(1);
  }
}

let demoAdmin: { email: string; password: string } | undefined;
if (DEMO) {
  const email = env.DEMO_ADMIN_EMAIL?.trim() ?? '';
  const password = env.DEMO_ADMIN_PASSWORD ?? '';
  if (!!email !== !!password) {
    console.error(
      'Set both DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD for the admin login, or neither.',
    );
    process.exit(1);
  }
  if (email) {
    if (!z.email().safeParse(email).success) {
      console.error('DEMO_ADMIN_EMAIL is not an email address.');
      process.exit(1);
    }
    if (password.length < 12) {
      console.error('DEMO_ADMIN_PASSWORD must be at least 12 characters.');
      process.exit(1);
    }
    demoAdmin = { email, password };
  }
}

const template = parseTemplate(
  JSON.parse(readFileSync(new URL('../templates/first-sheet.json', import.meta.url), 'utf8')),
);

const COLORS = ['blue', 'teal', 'orange', 'purple', 'green', 'pink'] as const;
const WORKSPACE = {
  name:
    env.SEED_WORKSPACE_NAME ??
    (env.SEED_WORKSPACE === 'meridian'
      ? 'Meridian Components Ltd'
      : `Workspace ${env.SEED_WORKSPACE}`),
  slug: env.SEED_WORKSPACE,
  time_zone: 'Europe/London',
};
const ENTITY = { name: 'Meridian Components Ltd', country: 'GB', sites: ['Leeds', 'Bradford'] };

const db = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function check<T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  if (r.data === null || r.data === undefined) throw new Error(`${what}: no data returned`);
  return r.data;
}

function maybe<T>(
  r: { data: T | null; error: { message: string } | null },
  what: string,
): T | null {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

async function userId(email: string): Promise<string> {
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  const existing = data.users.find((u) => u.email?.toLowerCase() === email);
  if (existing) return existing.id;
  const created = await db.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw new Error(`create user ${email}: ${created.error.message}`);
  return created.data.user.id;
}

async function main() {
  if (PURGE) return purge();
  // the pack catalogue (docs/11): the repository's packs, each version written once
  // and each framework's library pack, then the requirement catalogue (docs/12)
  const frameworks = repoFrameworks();
  const catalogue = await syncCatalogue(db, [...repoPacks(), ...frameworkPacks(frameworks)]);
  const library = await syncFrameworks(db, frameworks, repoCrosswalks());
  if (DEMO) return demo(catalogue.added.length, library.added.length);
  const people = [];
  for (const [i, p] of template.people.entries()) {
    const id = await userId(p.email);
    maybe(
      await db.from('profiles').upsert({
        id,
        display_name: p.name,
        initials: p.initials,
        color: COLORS[i % COLORS.length]!,
      }),
      `profile ${p.email}`,
    );
    people.push({ ...p, id });
  }

  const org = check(
    await db.from('orgs').upsert(WORKSPACE, { onConflict: 'slug' }).select('id').single(),
    'workspace',
  );

  maybe(
    await db.from('memberships').upsert(
      people.map((p) => ({ org_id: org.id, user_id: p.id, role: p.role, job_title: p.jobRole })),
      { onConflict: 'org_id,user_id' },
    ),
    'memberships',
  );

  const teamNames = [...new Set(people.map((p) => p.team))];
  const teams = check(
    await db
      .from('teams')
      .upsert(
        teamNames.map((name) => ({ org_id: org.id, name })),
        { onConflict: 'org_id,name' },
      )
      .select('id, name'),
    'teams',
  );
  const teamId = new Map(teams.map((t) => [t.name, t.id]));
  maybe(
    await db.from('team_members').upsert(
      people.map((p) => ({ org_id: org.id, team_id: teamId.get(p.team)!, user_id: p.id })),
      { onConflict: 'team_id,user_id' },
    ),
    'team members',
  );

  const roleNames = [...new Set(people.map((p) => p.jobRole))];
  maybe(
    await db.from('job_roles').upsert(
      roleNames.map((name) => ({ org_id: org.id, name })),
      { onConflict: 'org_id,name' },
    ),
    'job roles',
  );

  // entities and sites have no natural unique key: look up by name before inserting
  const lookup = await db
    .from('entities')
    .select('id')
    .eq('org_id', org.id)
    .eq('name', ENTITY.name)
    .maybeSingle();
  if (lookup.error) throw new Error(`entity lookup: ${lookup.error.message}`);
  const existingEntity = lookup.data;
  let entityId = existingEntity?.id;
  if (!entityId) {
    const inserted = await db
      .from('entities')
      .insert({ org_id: org.id, name: ENTITY.name, country: ENTITY.country })
      .select('id')
      .single();
    if (inserted.error) throw new Error(`entity: ${inserted.error.message}`);
    entityId = inserted.data.id;
  }
  const sites = check(
    await db.from('sites').select('name').eq('entity_id', entityId),
    'sites lookup',
  );
  const missing = ENTITY.sites.filter((s) => !sites.some((x) => x.name === s));
  if (missing.length) {
    maybe(
      await db
        .from('sites')
        .insert(missing.map((name) => ({ org_id: org.id, entity_id: entityId, name }))),
      'sites',
    );
  }

  const folderLookup = await db
    .from('folders')
    .select('id')
    .eq('org_id', org.id)
    .eq('name', template.folder)
    .maybeSingle();
  if (folderLookup.error) throw new Error(`folder lookup: ${folderLookup.error.message}`);
  const folder = folderLookup.data;
  if (!folder)
    check(
      await db
        .from('folders')
        .insert({ org_id: org.id, name: template.folder, position: 'a0' })
        .select('id')
        .single(),
      'folder',
    );

  let sheetsLine = 'no sheets (SEED_SHEETS=0)';
  if (env.SEED_SHEETS === '1') {
    const outcome = await importTemplate(db, template, { orgId: org.id, now: new Date() });
    sheetsLine =
      outcome.status === 'exists'
        ? `sheets from ${template.id} already there`
        : `${outcome.counts.sheets} sheets, ${outcome.counts.fields} fields, ${outcome.counts.items} items, ` +
          `${outcome.counts.links} links, ${outcome.counts.automations} automations from ${template.id}`;
  }

  console.log(
    `Seeded ${WORKSPACE.name} (/${WORKSPACE.slug}): ${people.length} people, ${teams.length} teams, ` +
      `${roleNames.length} job roles, 1 entity, ${ENTITY.sites.length} sites, folder "${template.folder}", ` +
      `${sheetsLine}. Packs in the catalogue: ${[...catalogue.added, ...catalogue.unchanged].length}` +
      `${catalogue.added.length ? ` (${catalogue.added.length} new)` : ''}. Frameworks: ` +
      `${library.added.length + library.revised.length + library.unchanged.length + library.statusUpdated.length}` +
      `${library.added.length ? ` (${library.added.length} new)` : ''}` +
      `${library.statusUpdated.length ? ` (${library.statusUpdated.length} with a new edition status)` : ''}, ${library.crosswalks} cross-walks.`,
  );
  console.log(
    `Sign in as ${people.map((p) => `${p.email} (${p.role})`).join(', ')} — magic links arrive in Mailpit.`,
  );
}

async function demo(newPacks: number, newFrameworks: number) {
  const { seedDemo, TARGETS } = await import('./demo/index');
  const started = Date.now();
  const r = await seedDemo(db, {
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    password: demoPassword,
    reset: env.DEMO_RESET === '1',
    today: env.DEMO_TODAY,
    admin: demoAdmin,
  });
  console.log(
    `Built the demo workspace /${r.slug} in ${Math.round((Date.now() - started) / 1000)} s ` +
      `(${r.counts.items} items, ${r.counts.packs} packs; catalogue: ${newPacks} new packs, ${newFrameworks} new frameworks).`,
  );
  for (const f of r.coverage)
    console.log(
      `  ${f.title}: ${f.text}${TARGETS[f.framework] !== undefined ? ` (target about ${TARGETS[f.framework]}%)` : ''}`,
    );
  if (r.warnings.length) {
    console.log(
      `${r.warnings.length} changes were refused by a status rule and left as they were:`,
    );
    for (const w of r.warnings) console.log(`  - ${w}`);
  }
  console.log(
    `Sign in as demo@meridian.example (viewer) with ${env.DEMO_PASSWORD ? 'DEMO_PASSWORD' : `the local password ${LOCAL_DEMO_PASSWORD}`}` +
      `${demoAdmin ? ', or as the admin login (DEMO_ADMIN_EMAIL) with DEMO_ADMIN_PASSWORD' : ''}.`,
  );
  // a machine-readable last line for the smoke test (scripts/demo/smoke.ts)
  console.log(`DEMO_RESULT ${JSON.stringify(r)}`);
}

/** Removes the retired demo copies (scripts/demo/purge.ts); fails when one marked as a demo copy could not go. */
async function purge() {
  const { purgeRetired } = await import('./demo/purge');
  const r = await purgeRetired(db);
  for (const p of r.purged)
    console.log(
      `Purged /${p.slug}: ${p.items} items, ${p.activity} log entries, ${p.files} files.`,
    );
  for (const k of r.kept) console.log(`Kept /${k.slug}: ${k.reason}.`);
  const live = await db.from('orgs').select('slug').like('slug', `${DEMO_SLUG}%`);
  if (live.error) throw new Error(live.error.message);
  console.log(
    `${r.purged.length} retired demo copies purged. Demo workspaces now: ${live.data.map((o) => `/${o.slug}`).join(', ') || 'none'}.`,
  );
  if (r.kept.some((k) => !k.reason.startsWith('not marked'))) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
