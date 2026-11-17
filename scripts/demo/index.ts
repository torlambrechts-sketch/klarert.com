// The demo workspace: Meridian Components Ltd, a fictional precision-parts manufacturer (180 staff, Leeds and Tilburg),
// mid-way through ISO 9001 and ISO/IEC 27001 and earlier on with ISO 14001, ISO 45001, GDPR and NIS2. Built by
// `pnpm seed:demo` (scripts/seed.ts --demo), which owns the service role (CLAUDE.md rule 6) and hands it here.
//
// The service role is used only for what the seed has always done: people (auth users, profiles, the demo login's
// password, blocking the others from signing in), memberships, teams, job roles, entity and sites, and looking rows
// up. Everything else is written by the app's own server commands, as the person named in the content: the workspace
// itself (createWorkspace), pack installs and framework adoption, items and their history, links, files, approvals,
// the library decisions, the own framework, automations switched to live, a management review and the date checks.
// So the activity log and its hash chains, coverage, the SoA, dashboards and run logs are the real ones.
//
// Repeatable: a workspace with the demo address is refused unless DEMO_RESET=1, which moves the old one aside (a new
// address, renamed "retired demo", its members removed) and builds a fresh one. The activity log is append-only, so a
// workspace is never deleted.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import { demoClock, todayIn, type DemoClock } from './clock';
import { readLibraries, writeContent, writeLibrary, type Built } from './build';
import { coreContent, coreLinks } from './content/core';
import { ehsContent } from './content/ehs';
import { ismsContent } from './content/isms';
import { libraryPlans } from './content/library';
import { OWN_FRAMEWORK, OWN_STATUS, ownFrameworkDraft } from './content/own-framework';
import { privacyContent } from './content/privacy';
import { qualityContent } from './content/quality';
import { DEMO_EMAIL, JOB_ROLES, PEOPLE, person } from './people';
import { sessions } from './session';
import { makeWriter, type Writer } from './writer';

type Db = SupabaseClient<Database>;

export const DEMO = {
  slug: 'meridian-demo',
  name: 'Meridian Components Ltd',
  timeZone: 'Europe/London',
  entities: [
    { name: 'Meridian Components Ltd', country: 'GB', sites: ['Leeds'] },
    { name: 'Meridian Components B.V.', country: 'NL', sites: ['Tilburg'] },
  ],
};

/** Pack installs, in order: the key, the level (Recommended unless Everything shows more) and settings. */
const INSTALLS: { key: string; level?: string; settings?: Record<string, string> }[] = [
  { key: 'core', level: 'full' },
  { key: 'iso-9001', level: 'full' },
  { key: 'iso-27001' },
  { key: 'iso-14001', level: 'full' },
  { key: 'iso-45001', level: 'full' },
  { key: 'gdpr', level: 'full' },
  { key: 'nis2', settings: { country: 'nl' } },
  { key: 'supplier-management' },
];
/** Sheets the packs install restricted (personal data): who is listed on them, as editors (docs/02 §16). */
const RESTRICTED: Record<string, ('grace' | 'tomasz' | 'priya')[]> = {
  'Environmental communications': ['grace'],
  'Health surveillance': ['grace'],
  'Data subject requests': ['tomasz'],
  'Personal data breaches': ['tomasz'],
  'Consent records': ['tomasz'],
};
/** Packs whose automations are switched to live; the others stay in test mode (docs/04 §14). */
const LIVE = ['core', 'iso-9001', 'supplier-management'];

/** Coverage the demo aims for, whole percent (the smoke test checks the result lands near them). */
export const TARGETS: Record<string, number> = {
  'iso-9001@2015': 70,
  'iso-27001@2022': 55,
};

export interface DemoEnv {
  url: string;
  anonKey: string;
  /** The demo login's password (DEMO_PASSWORD). */
  password: string;
  /** Move an existing demo workspace aside and build a new one. */
  reset: boolean;
  /** Today for the demo's dates (DEMO_TODAY), else today in Europe/London. */
  today?: string;
}

export interface DemoResult {
  slug: string;
  coverage: { framework: string; title: string; percent: number | null; text: string }[];
  warnings: string[];
  counts: Record<string, number>;
}

function log(line: string) {
  console.log(`  · ${line}`);
}

async function people(admin: Db, password: string) {
  const ids = new Map<string, string>();
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const p of PEOPLE) {
    const existing = data.users.find((u) => u.email?.toLowerCase() === p.email);
    let id = existing?.id;
    if (!id) {
      const created = await admin.auth.admin.createUser({
        email: p.email,
        email_confirm: true,
        ...(p.email === DEMO_EMAIL ? { password } : {}),
      });
      if (created.error) throw new Error(`user ${p.email}: ${created.error.message}`);
      id = created.data.user.id;
    } else {
      // the seed signs in as each person to write their part: lift the block of an earlier run for now
      const r = await admin.auth.admin.updateUserById(id, {
        ban_duration: 'none',
        ...(p.email === DEMO_EMAIL ? { password } : {}),
      });
      if (r.error) throw new Error(`user ${p.email}: ${r.error.message}`);
    }
    const pr = await admin
      .from('profiles')
      .upsert({ id, display_name: p.name, initials: p.initials, color: p.color });
    if (pr.error) throw new Error(`profile ${p.email}: ${pr.error.message}`);
    ids.set(p.ref, id);
  }
  return ids;
}

/** Nobody but the demo login signs in: the others are blocked (for about 100 years) once their part is written. */
async function blockOthers(admin: Db, ids: Map<string, string>) {
  for (const p of PEOPLE) {
    if (p.email === DEMO_EMAIL) continue;
    const r = await admin.auth.admin.updateUserById(ids.get(p.ref)!, { ban_duration: '876000h' });
    if (r.error) throw new Error(`block ${p.email}: ${r.error.message}`);
  }
}

async function retire(admin: Db, orgId: string) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const r = await admin
    .from('orgs')
    .update({ slug: `${DEMO.slug}-retired-${stamp}`, name: `${DEMO.name} (retired demo ${stamp})` })
    .eq('id', orgId);
  if (r.error) throw new Error(`retire the old demo workspace: ${r.error.message}`);
  const m = await admin.from('memberships').delete().eq('org_id', orgId);
  if (m.error) throw new Error(`retire the old demo workspace's members: ${m.error.message}`);
}

async function structure(admin: Db, orgId: string, ids: Map<string, string>, c: DemoClock) {
  const ends = (days?: number) =>
    days === undefined ? null : new Date(`${c.day(days)}T17:00:00Z`).toISOString();
  const m = await admin.from('memberships').upsert(
    PEOPLE.map((p) => ({
      org_id: orgId,
      user_id: ids.get(p.ref)!,
      role: p.role === 'auditor' ? ('auditor' as never) : p.role,
      job_title: p.jobTitle,
      expires_at: ends(p.endsInDays),
    })),
    { onConflict: 'org_id,user_id' },
  );
  if (m.error) throw new Error(`memberships: ${m.error.message}`);
  const teams = await admin
    .from('teams')
    .upsert(
      [...new Set(PEOPLE.map((p) => p.team))].map((name) => ({ org_id: orgId, name })),
      { onConflict: 'org_id,name' },
    )
    .select('id, name');
  if (teams.error) throw new Error(`teams: ${teams.error.message}`);
  const teamId = new Map(teams.data.map((t) => [t.name, t.id]));
  const tm = await admin.from('team_members').upsert(
    PEOPLE.map((p) => ({ org_id: orgId, team_id: teamId.get(p.team)!, user_id: ids.get(p.ref)! })),
    { onConflict: 'team_id,user_id' },
  );
  if (tm.error) throw new Error(`team members: ${tm.error.message}`);
  const jr = await admin.from('job_roles').upsert(
    JOB_ROLES.map((name) => ({ org_id: orgId, name })),
    { onConflict: 'org_id,name' },
  );
  if (jr.error) throw new Error(`job roles: ${jr.error.message}`);
  for (const e of DEMO.entities) {
    const ent = await admin
      .from('entities')
      .insert({ org_id: orgId, name: e.name, country: e.country })
      .select('id')
      .single();
    if (ent.error) throw new Error(`entity: ${ent.error.message}`);
    const st = await admin
      .from('sites')
      .insert(e.sites.map((name) => ({ org_id: orgId, entity_id: ent.data.id, name })));
    if (st.error) throw new Error(`sites: ${st.error.message}`);
  }
}

export async function seedDemo(admin: Db, env: DemoEnv): Promise<DemoResult> {
  const c = demoClock(env.today ?? todayIn(DEMO.timeZone, new Date()));
  console.log(`Building the demo workspace /${DEMO.slug} for ${c.today}.`);

  // the app's commands, loaded here so that the runtime (scripts/demo/runtime.cjs) is in place first
  const [
    onboarding,
    packs,
    frameworks,
    own,
    items,
    files,
    updates,
    approvals,
    bundles,
    audit,
    scheduler,
    access,
  ] = await Promise.all([
    import('../../src/server/commands/onboarding'),
    import('../../src/server/commands/packs'),
    import('../../src/server/commands/frameworks'),
    import('../../src/server/commands/own-frameworks'),
    import('../../src/server/commands/items'),
    import('../../src/server/commands/files'),
    import('../../src/server/commands/updates'),
    import('../../src/server/commands/approvals'),
    import('../../src/server/commands/bundles'),
    import('../../src/server/commands/audit'),
    import('../../src/server/commands/scheduler'),
    import('../../src/server/commands/access'),
  ]);

  const existing = await admin.from('orgs').select('id').eq('slug', DEMO.slug).maybeSingle();
  if (existing.error) throw new Error(`look-up: ${existing.error.message}`);
  if (existing.data) {
    if (!env.reset)
      throw new Error(
        `The demo workspace /${DEMO.slug} already exists. Run again with DEMO_RESET=1 to move it aside and build a new one ` +
          '(the activity log is append-only, so the old workspace is renamed, not deleted).',
      );
    await retire(admin, existing.data.id);
    log('moved the old demo workspace aside');
  }

  const ids = await people(admin, env.password);
  const who = sessions(admin, {
    url: env.url,
    anonKey: env.anonKey,
    passwords: { [DEMO_EMAIL]: env.password },
  });
  const hannah = person('hannah').email;
  await who.actAs(hannah);
  const ws = await onboarding.createWorkspace({
    name: DEMO.name,
    slug: DEMO.slug,
    timeZone: DEMO.timeZone,
  });
  if (!ws.ok) throw new Error(`create the workspace: ${ws.error.message}`);
  const org = await admin.from('orgs').select('id').eq('slug', DEMO.slug).single();
  if (org.error) throw new Error(org.error.message);
  const orgId = org.data.id;
  await structure(admin, orgId, ids, c);
  log(`${PEOPLE.length} people, ${DEMO.entities.length} entities`);

  const w: Writer = await makeWriter(admin, who, { slug: DEMO.slug, id: orgId }, {
    createItem: items.createItem,
    setValues: items.setValues,
    setLinks: items.setLinks,
    prepareUpload: files.prepareUpload,
    confirmUpload: files.confirmUpload,
    postUpdate: updates.postUpdate,
  } as never);
  await w.as(hannah);

  // ISO 9001:2015 first: Meridian is certified to it, then installs the ISO 9001 pack (which builds on the 2026
  // edition) to prepare the move
  const pa = w.must(
    await frameworks.previewAdoption({ org: DEMO.slug, framework: 'iso-9001', version: '2015' }),
    'preview ISO 9001:2015',
  );
  w.must(
    await frameworks.adoptFramework({
      org: DEMO.slug,
      framework: 'iso-9001',
      version: '2015',
      hash: pa.hash,
    }),
    'adopt ISO 9001:2015',
  );
  const installIds = new Map<string, string>();
  for (const i of INSTALLS) {
    const pv = w.must(
      await packs.previewPack({ org: DEMO.slug, key: i.key, level: i.level }),
      `preview ${i.key}`,
    );
    const r = w.must(
      await packs.installPack({
        org: DEMO.slug,
        key: i.key,
        level: i.level,
        hash: pv.hash,
        settings: i.settings,
      }),
      `install ${i.key}`,
    );
    installIds.set(i.key, r.installId);
  }
  // CAPA: the app on the Core registers (docs/13)
  const bd = w.must(
    await bundles.bundleDetails({ org: DEMO.slug, key: 'start-capa' }),
    'CAPA details',
  );
  w.must(
    await bundles.createBundle({
      org: DEMO.slug,
      key: 'start-capa',
      hash: (bd as { hash: string }).hash,
      name: 'CAPA',
      ownerId: ids.get('priya')!,
      reviewBy: c.day(180),
    }),
    'CAPA',
  );
  log(`installed ${INSTALLS.length} packs, ISO 9001:2015 and the CAPA app`);

  // the packs' example items make way for Meridian's own
  const examples = await admin
    .from('items')
    .select('id, sheet_id')
    .eq('org_id', orgId)
    .like('name', 'Example:%')
    .is('archived_at', null);
  const bySheet = new Map<string, string[]>();
  for (const e of examples.data ?? [])
    bySheet.set(e.sheet_id, [...(bySheet.get(e.sheet_id) ?? []), e.id]);
  for (const [sheetId, itemIds] of bySheet)
    w.must(
      await items.archiveItems({ org: DEMO.slug, sheetId, itemIds, archived: true }),
      'archive examples',
    );
  log(`archived ${examples.data?.length ?? 0} example items`);

  for (const [name, refs] of Object.entries(RESTRICTED)) {
    const s = await w.sheet(name);
    for (const ref of refs)
      w.must(
        await access.setAccessGrant({
          org: DEMO.slug,
          kind: 'sheet',
          targetId: s.id,
          userId: ids.get(ref)!,
          level: 'editor',
        }),
        `access to ${name}`,
      );
  }

  for (const key of LIVE)
    w.must(
      await packs.setPackAutomationsMode({
        org: DEMO.slug,
        installId: installIds.get(key)!,
        mode: 'live',
      }),
      `automations live: ${key}`,
    );

  const built: Built = { items: new Map(), libraries: await readLibraries(admin, w) };
  const commands = {
    bulkSetValues: items.bulkSetValues,
    submitForApproval: approvals.submitForApproval,
    decideApproval: approvals.decideApproval,
  };
  await writeContent(
    w,
    built,
    [
      ...coreContent(c),
      ...qualityContent(c),
      ...ismsContent(c),
      ...ehsContent(c),
      ...privacyContent(c),
    ],
    commands,
    coreLinks(),
  );
  log(`${built.items.size} items in the registers`);

  for (const plan of libraryPlans(c)) await writeLibrary(w, built, plan, c, commands);
  log('library decisions and evidence');

  // the customer's own requirements, mapped to ISO 9001:2015 (docs/12 Your own frameworks)
  await w.as(hannah);
  const draft = ownFrameworkDraft();
  const created = w.must(
    await own.createOwnFramework({
      org: DEMO.slug,
      title: OWN_FRAMEWORK.title,
      shortTitle: OWN_FRAMEWORK.shortTitle,
      kind: draft.kind,
      start: 'paste',
      requirements: draft.requirements,
    }),
    'own framework',
  );
  w.must(
    await own.publishOwnFramework({
      org: DEMO.slug,
      key: created.key,
      draft,
      source: OWN_FRAMEWORK.source,
      rightsConfirmed: true,
      expect: 'first',
    }),
    'publish the own framework',
  );
  const ownPreview = w.must(
    await frameworks.previewAdoption({ org: DEMO.slug, framework: created.key, version: '1' }),
    'preview the own framework',
  );
  w.must(
    await frameworks.adoptFramework({
      org: DEMO.slug,
      framework: created.key,
      version: '1',
      hash: ownPreview.hash,
    }),
    'adopt the own framework',
  );
  built.libraries = await readLibraries(admin, w);
  await writeLibrary(
    w,
    built,
    {
      framework: `${created.key}@1`,
      owner: 'priya',
      notApplicable: {},
      applicable: '*',
      ...OWN_STATUS,
      evidence: [
        {
          ref: 'P4',
          name: 'gauge-register-for-acme.pdf',
          lines: [
            'Gauge register extract for Acme parts',
            'All gauges in date, traceable to national standards.',
          ],
        },
        {
          ref: 'Q1',
          name: 'meridian-iso-9001-certificate.pdf',
          lines: [
            'ISO 9001:2015 certificate, Meridian Components Ltd',
            'Issued by an accredited certification body (fictional).',
          ],
          validInDays: 410,
        },
        {
          ref: 'P2',
          name: 'traceability-procedure-PR-018.pdf',
          lines: ['PR-018 Traceability', 'Bar batch to part to delivery note, kept for 10 years.'],
        },
        {
          ref: 'S1',
          name: 'approved-special-process-list.pdf',
          lines: [
            'Approved special processes for Acme parts',
            'Quenby Heat Treatment; Pennock Anodising (conditional).',
          ],
        },
      ],
      reviewedDaysAgo: 14,
    },
    c,
    commands,
  );
  log(`own framework "${OWN_FRAMEWORK.title}" published, adopted and mapped to ISO 9001:2015`);

  // the recent management review: inputs compiled by the app, then held and its decisions recorded
  await w.as(person('priya').email);
  const mr = w.must(
    await audit.createManagementReview({ org: DEMO.slug, from: c.month(-6, 1), to: c.day(-1) }),
    'management review',
  );
  const reviews = await w.sheet('Management reviews');
  const reviewItem = await admin
    .from('items')
    .select('id')
    .eq('sheet_id', mr.sheetId)
    .eq('display_id', mr.displayId)
    .single();
  if (reviewItem.data) {
    await w.as(hannah);
    await w.update(reviews, reviewItem.data.id, {
      chair: person('hannah').name,
      meeting_date: c.day(-8),
      status: 'Held',
      decisions:
        'Approve the move to ISO 9001:2026 before the surveillance audit. Add a second bar source. Fund mist extraction on lathes 2 and 5. Track the effectiveness of NC-2026-019 to the next review.',
      standards: ['All standards'],
    });
  }
  log('management review');

  // date-based automations run once now, as the nightly scheduler would (their run log)
  await w.as(hannah);
  const dc = await scheduler.runDateChecksNow({ org: DEMO.slug });
  if (!dc.ok) w.warnings.push(`date checks: ${dc.error.message}`);
  else log(dc.data.messages.join(' ') || 'date checks ran');

  await blockOthers(admin, ids);
  log('blocked sign-in for everyone but the demo login');

  // the coverage the Frameworks page shows
  const list = w.must(await frameworks.listFrameworks({ org: DEMO.slug }), 'frameworks');
  const coverage = list.frameworks
    .filter((f) => f.adopted)
    .map((f) => ({
      framework: `${f.key}@${f.version}`,
      title: f.title,
      percent: f.adopted!.coverage.percent,
      text: f.adopted!.coverageText,
    }));
  const counts = { items: built.items.size, packs: INSTALLS.length };
  return { slug: DEMO.slug, coverage, warnings: w.warnings, counts };
}
