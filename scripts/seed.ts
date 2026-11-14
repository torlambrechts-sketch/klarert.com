// Local seed (docs/02 §11): people from templates/first-sheet.json, the Meridian workspace, teams, job roles, entity,
// sites, the first folder, and the template's two sheets with items, links and automations (the importer, M10).
// Safe to run repeatedly: nothing is duplicated.
// Run: pnpm seed   (reads .env.local; refuses non-local Supabase unless SEED_ALLOW_REMOTE=1)
// Options (environment): SEED_WORKSPACE=<slug> and SEED_WORKSPACE_NAME=<name> seed another workspace with the same
// people (the first-sheet e2e test uses a fresh one per run); SEED_SHEETS=0 leaves it empty (docs/07 Part A).
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
  })
  .parse(process.env);

const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
if (!['127.0.0.1', 'localhost'].includes(host) && env.SEED_ALLOW_REMOTE !== '1') {
  console.error(
    `Refusing to seed ${host}. Set SEED_ALLOW_REMOTE=1 to seed a hosted project on purpose.`,
  );
  process.exit(1);
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
  // the pack catalogue (docs/11): the repository's packs, each version written once
  // and each framework's library pack, then the requirement catalogue (docs/12)
  const frameworks = repoFrameworks();
  const catalogue = await syncCatalogue(db, [...repoPacks(), ...frameworkPacks(frameworks)]);
  const library = await syncFrameworks(db, frameworks, repoCrosswalks());
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

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
