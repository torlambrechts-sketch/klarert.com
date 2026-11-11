// Local seed (docs/02 §11, M1): people from templates/first-sheet.json, the Meridian workspace, teams, job roles,
// entity, sites and the first folder. Sheets and items arrive with M10. Safe to run repeatedly.
// Run: pnpm seed   (reads .env.local; refuses non-local Supabase unless SEED_ALLOW_REMOTE=1)
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '../src/lib/database.types';

const env = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    SEED_ALLOW_REMOTE: z.string().optional(),
  })
  .parse(process.env);

const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
if (!['127.0.0.1', 'localhost'].includes(host) && env.SEED_ALLOW_REMOTE !== '1') {
  console.error(
    `Refusing to seed ${host}. Set SEED_ALLOW_REMOTE=1 to seed a hosted project on purpose.`,
  );
  process.exit(1);
}

const template = z
  .object({
    folder: z.string(),
    people: z.array(
      z.object({
        email: z.email(),
        name: z.string(),
        initials: z.string().max(3),
        jobRole: z.string(),
        team: z.string(),
        role: z.enum(['owner', 'admin', 'editor', 'viewer']),
      }),
    ),
  })
  .parse(
    JSON.parse(readFileSync(new URL('../templates/first-sheet.json', import.meta.url), 'utf8')),
  );

const COLORS = ['blue', 'teal', 'orange', 'purple', 'green', 'pink'] as const;
const WORKSPACE = { name: 'Meridian Components Ltd', slug: 'meridian', time_zone: 'Europe/London' };
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

  const folder = maybe(
    await db
      .from('folders')
      .select('id')
      .eq('org_id', org.id)
      .eq('name', template.folder)
      .maybeSingle(),
    'folder lookup',
  );
  if (!folder)
    maybe(
      await db.from('folders').insert({ org_id: org.id, name: template.folder, position: 'a0' }),
      'folder',
    );

  console.log(
    `Seeded ${WORKSPACE.name} (/${WORKSPACE.slug}): ${people.length} people, ${teams.length} teams, ` +
      `${roleNames.length} job roles, 1 entity, ${ENTITY.sites.length} sites, folder "${template.folder}".`,
  );
  console.log(
    `Sign in as ${people.map((p) => `${p.email} (${p.role})`).join(', ')} — magic links arrive in Mailpit.`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
