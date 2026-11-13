// Local design-comparison data: the board design's "Risk register" (folder "Risk and controls") with the same groups,
// columns, items, owners, comment counts and score history, in its own workspace, plus the design's other folders
// and sheet names so the side menu has the same shape. Used to compare the Table page with the design like for like
// (pixel diffs and computed styles). Safe to run repeatedly: an existing workspace with this slug is left as it is.
// Run: pnpm tsx --env-file-if-exists=.env.local scripts/seed-risk-register.ts
// Options (environment): SEED_WORKSPACE=<slug> (default meridian-risk). Refuses non-local Supabase.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { generateKeyBetween } from 'fractional-indexing';
import { z } from 'zod';
import type { Database } from '../src/lib/database.types';
import { parseTemplate } from '../src/lib/templates/schema';
import { importTemplate } from '../src/server/templates/importer';

const env = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    SEED_WORKSPACE: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,47}$/)
      .default('meridian-risk'),
  })
  .parse(process.env);

const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
if (!['127.0.0.1', 'localhost'].includes(host)) {
  console.error(`Refusing to seed ${host}: this script is for local Supabase only.`);
  process.exit(1);
}

const db = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function check<T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  if (r.data === null || r.data === undefined) throw new Error(`${what}: no data returned`);
  return r.data;
}

const TIME_ZONE = 'Europe/London';

// The design's people (initials → name, job role) and the colour of their avatar.
const PEOPLE = [
  { ref: 'maria', key: 'MP', name: 'Maria Pereira', job: 'Compliance manager', color: 'grey' },
  { ref: 'james', key: 'JO', name: 'James Okafor', job: 'Head of IT', color: 'yellow' },
  { ref: 'tom', key: 'TK', name: 'Tom Kirby', job: 'HSE manager', color: 'green' },
  { ref: 'sofia', key: 'SL', name: 'Sofia Lindqvist', job: 'Quality manager', color: 'blue' },
  { ref: 'aisha', key: 'AE', name: 'Aisha Evans', job: 'Operations director', color: 'yellow' },
  { ref: 'rafael', key: 'RB', name: 'Rafael Bianchi', job: 'Site lead, Bradford', color: 'grey' },
  { ref: 'daniel', key: 'DH', name: 'Daniel Hughes', job: 'Finance director', color: 'blue' },
] as const;

const RISK_STATUS = [
  ['Identified', 'grey'],
  ['Assessed', 'blue'],
  ['In treatment', 'orange'],
  ['Awaiting acceptance', 'red'],
  ['Accepted', 'green'],
  ['Monitored', 'teal'],
] as const;
const DONE = new Set(['Accepted', 'Monitored']);
const TREAT = [
  ['Reduce', 'blue'],
  ['Accept', 'yellow'],
  ['Avoid', 'purple'],
  ['Transfer', 'navy'],
  ['Pursue', 'green'],
] as const;
const SITES = ['Leeds', 'Bradford', 'All sites'] as const;
const optId = (label: string) => `opt_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

type Row = [
  id: string,
  name: string,
  comments: number,
  owner: string,
  status: string,
  l: number,
  i: number,
  treat: string,
  res: number | '',
  ctrl: string,
  review: string,
  plan: string,
  site: string,
  cost: number | '',
];

// From the design's board data (compliance-os.js, board "risks"), in order.
const GROUPS: { name: string; color: string; rows: Row[] }[] = [
  {
    name: 'Information security · appetite 9',
    color: 'blue',
    rows: [
      [
        'R-014',
        'Ransomware encrypts production planning server',
        3,
        'JO',
        'In treatment',
        4,
        5,
        'Reduce',
        8,
        'A.8.13, A.8.7, A.8.8, A.5.30',
        '2027-01-15',
        '2026-10-01/2026-12-15',
        'Leeds',
        18000,
      ],
      [
        'R-021',
        'Staff reuse passwords on the supplier portal',
        1,
        'MP',
        'Accepted',
        3,
        4,
        'Reduce',
        6,
        'A.5.17, A.8.5',
        '2027-02-03',
        '2026-09-15/2026-10-30',
        'All sites',
        2500,
      ],
      [
        'R-009',
        'Customer drawings sent from personal email',
        0,
        'MP',
        'Monitored',
        3,
        3,
        'Reduce',
        4,
        'A.5.14, A.8.12, A.5.10',
        '2026-12-20',
        '2026-08-01/2026-09-30',
        'All sites',
        4000,
      ],
      [
        'R-035',
        'Cloud ERP outage stops order intake',
        2,
        'JO',
        'Assessed',
        2,
        4,
        'Transfer',
        8,
        'A.5.30',
        '2027-01-30',
        '2026-11-15/2027-02-15',
        'All sites',
        '',
      ],
    ],
  },
  {
    name: 'Health and safety · appetite 6',
    color: 'orange',
    rows: [
      [
        'R-005',
        'Hand injury at press line 3 during die change',
        2,
        'TK',
        'In treatment',
        3,
        4,
        'Reduce',
        6,
        'OP-04',
        '2026-11-30',
        '2026-10-10/2026-12-05',
        'Leeds',
        12500,
      ],
      [
        'R-018',
        'Forklift and pedestrian collision in dispatch',
        1,
        'TK',
        'Monitored',
        2,
        5,
        'Reduce',
        5,
        'OP-02, OP-03',
        '2027-01-12',
        '2026-08-01/2026-09-15',
        'Leeds',
        9000,
      ],
      [
        'R-027',
        'Noise exposure above 85 dB(A) in grinding cell',
        0,
        'RB',
        'Assessed',
        4,
        3,
        'Reduce',
        12,
        'OP-09',
        '2026-11-02',
        '2026-11-20/2027-01-31',
        'Bradford',
        '',
      ],
    ],
  },
  {
    name: 'Quality · appetite 8',
    color: 'purple',
    rows: [
      [
        'R-024',
        'Single-source supplier for anodising',
        4,
        'AE',
        'Awaiting acceptance',
        3,
        4,
        'Accept',
        12,
        'OP-12',
        '2026-12-01',
        '',
        'All sites',
        '',
      ],
      [
        'R-011',
        'Out-of-tolerance gauges used in final inspection',
        0,
        'SL',
        'Monitored',
        2,
        4,
        'Reduce',
        4,
        'OP-07',
        '2027-02-18',
        '2026-08-10/2026-09-30',
        'Leeds',
        3200,
      ],
      [
        'R-033',
        'Opportunity: automate first-article inspection reports',
        1,
        'SL',
        'Identified',
        4,
        3,
        'Pursue',
        '',
        '',
        '2027-03-31',
        '2027-01-10/2027-03-31',
        'Leeds',
        15000,
      ],
    ],
  },
  {
    name: 'Environment · appetite 8',
    color: 'green',
    rows: [
      [
        'R-016',
        'Coolant spill reaches surface drain',
        0,
        'TK',
        'Monitored',
        2,
        5,
        'Reduce',
        4,
        'OP-11',
        '2027-03-09',
        '2026-08-01/2026-09-15',
        'Bradford',
        6000,
      ],
      [
        'R-029',
        'Energy cost and Scope 2 emissions rise',
        1,
        'DH',
        'In treatment',
        4,
        3,
        'Reduce',
        8,
        'OP-14',
        '2027-02-28',
        '2026-09-01/2027-03-31',
        'All sites',
        42000,
      ],
    ],
  },
];

// The design's other boards, per folder, so the side menu has the same folders and sheets.
const FOLDERS: { name: string; sheets: [name: string, prefix: string][] }[] = [
  {
    name: 'Management system',
    sheets: [
      ['Documents and policies', 'DOC-'],
      ['Objectives and KPIs', 'OBJ-'],
      ['Legal register', 'LR-'],
      ['Competence and training', 'TR-'],
      ['Internal audits', 'IA-'],
      ['Management reviews', 'MR-'],
    ],
  },
  { name: 'Risk and controls', sheets: [] },
  {
    name: 'Operations',
    sheets: [
      ['Incidents', 'INC-'],
      ['Hazards (HIRA)', 'HZ-'],
      ['Environmental aspects', 'ASP-'],
      ['Nonconformities and CAPA', 'NC-'],
      ['Actions', 'ACT-'],
    ],
  },
  {
    name: 'Privacy and security',
    sheets: [
      ['Processing activities', 'PA-'],
      ['Data-subject requests', 'DSR-'],
      ['Breaches and NIS2', 'BR-'],
    ],
  },
  { name: 'Suppliers', sheets: [['Supplier register', 'SUP-']] },
  { name: 'Your sheets', sheets: [['Permit-to-work', 'PTW-']] },
];
// The starting tabs per sheet (sheets.settings.tabs): the other built-in views stay hidden in More. All open on Table.
const tabsOf = (...refs: string[]) => refs.map((ref) => ({ ref }));
const TABS: Record<string, { ref: string }[]> = {
  'Risk register': tabsOf('table', 'kanban', 'insights'),
  Controls: tabsOf('table', 'insights'),
  'Statement of Applicability': tabsOf('table', 'insights'),
  'Nonconformities and CAPA': tabsOf('table', 'kanban', 'calendar'),
  Incidents: tabsOf('table', 'form', 'kanban'),
  'Internal audits': tabsOf('table', 'calendar'),
  'Supplier register': tabsOf('table', 'calendar'),
  'Competence and training': tabsOf('table', 'calendar'),
  'Documents and policies': tabsOf('table', 'calendar'),
  'Legal register': tabsOf('table', 'calendar'),
};

const RISK_SIBLINGS: [string, string][] = [
  ['Controls', 'CTL-'],
  ['Statement of Applicability', 'SOA-'],
  ['Assets', 'AS-'],
];

/** The design's score history: six points ending at the current value (its `spark` helper, same hash). */
function hh(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}
function history(seed: string, last: number): number[] {
  const h = parseInt(hh(seed), 16);
  const pts: number[] = [];
  let v = last + ((h % 7) - 1);
  for (let i = 0; i < 6; i++) {
    pts.unshift(Math.max(1, Math.min(25, Math.round(v))));
    v += ((h >> (i * 3)) % 5) - 1.5;
  }
  pts[5] = last;
  return pts;
}

async function userId(email: string): Promise<string> {
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  const existing = data.users.find((u) => u.email?.toLowerCase() === email);
  if (existing) return existing.id;
  const created = await db.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw new Error(`create user ${email}: ${created.error.message}`);
  return created.data.user.id;
}

function todayIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

async function main() {
  const existingOrg = await db
    .from('orgs')
    .select('id')
    .eq('slug', env.SEED_WORKSPACE)
    .maybeSingle();
  if (existingOrg.data) {
    console.log(`/${env.SEED_WORKSPACE} already exists: nothing changed.`);
    return;
  }

  const people = [];
  for (const p of PEOPLE) {
    const email = `${p.ref}@example.com`;
    const id = await userId(email);
    check(
      await db
        .from('profiles')
        .upsert({ id, display_name: p.name, initials: p.key, color: p.color })
        .select('id'),
      `profile ${email}`,
    );
    people.push({ ...p, id, email });
  }
  const byKey = new Map(people.map((p) => [p.key as string, p]));

  const org = check(
    await db
      .from('orgs')
      .insert({ name: 'Meridian Components Ltd', slug: env.SEED_WORKSPACE, time_zone: TIME_ZONE })
      .select('id')
      .single(),
    'workspace',
  );
  check(
    await db
      .from('memberships')
      .insert(
        people.map((p) => ({
          org_id: org.id,
          user_id: p.id,
          role: p.ref === 'maria' ? 'owner' : 'editor',
          job_title: p.job,
        })),
      )
      .select('user_id'),
    'memberships',
  );

  const now = new Date();
  const planEnv = {
    jobRoles: [],
    teams: [],
    orgId: org.id,
    people: people.map((p) => ({
      ref: p.ref,
      id: p.id,
      name: p.name,
      initials: p.key,
      color: p.color,
      email: p.email,
    })),
    today: todayIn(TIME_ZONE, now),
    now,
    timeZone: TIME_ZONE,
    newId: randomUUID,
  };

  let folderPos: string | null = null;
  let riskSheetId = '';
  for (const folder of FOLDERS) {
    folderPos = generateKeyBetween(folderPos, null);
    const folderId = check(
      await db
        .from('folders')
        .insert({ org_id: org.id, name: folder.name, position: folderPos })
        .select('id')
        .single(),
      `folder ${folder.name}`,
    ).id;
    const plain = (name: string, prefix: string, i: number) => ({
      ref: `s${i}`,
      name,
      itemLabel: 'Item',
      idPrefix: prefix,
      groups: [{ ref: 'g', name: 'Group', color: 'blue' }],
      fields: [],
      views: [{ name: 'Table', type: 'table', config: {} }],
      ...(TABS[name] ? { tabs: TABS[name] } : {}),
      items: [],
    });
    const sheets =
      folder.name === 'Risk and controls'
        ? [
            {
              ref: 'risks',
              name: 'Risk register',
              description:
                "All risks and opportunities in one register, one methodology per category. Locked columns are what the apps rely on; teal headings are this customer's own columns.",
              itemLabel: 'Item',
              idPrefix: 'R-',
              groups: GROUPS.map((g, i) => ({ ref: `g${i}`, name: g.name, color: g.color })),
              fields: [
                {
                  key: 'owner',
                  name: 'Owner',
                  type: 'people',
                  locked: true,
                  config: { multiple: false },
                },
                {
                  key: 'status',
                  name: 'Status',
                  type: 'status',
                  locked: true,
                  config: {
                    options: RISK_STATUS.map(([label, color]) => ({
                      id: optId(label),
                      label,
                      color,
                      ...(DONE.has(label) ? { done: true } : {}),
                    })),
                    default: optId('Identified'),
                  },
                },
                { key: 'likelihood', name: 'Likelihood', type: 'number', locked: true },
                { key: 'impact', name: 'Impact', type: 'number', locked: true },
                {
                  key: 'inherent',
                  name: 'Inherent',
                  type: 'number',
                  locked: true,
                  config: { bands: [4, 9, 15], higherIsBetter: false },
                },
                {
                  key: 'treatment',
                  name: 'Treatment',
                  type: 'dropdown',
                  locked: true,
                  config: {
                    options: TREAT.map(([label, color]) => ({ id: optId(label), label, color })),
                  },
                },
                {
                  key: 'residual',
                  name: 'Residual',
                  type: 'number',
                  locked: true,
                  config: { bands: [4, 9, 15], higherIsBetter: false },
                },
                { key: 'controls', name: 'Controls', type: 'text', locked: true },
                {
                  key: 'review_date',
                  name: 'Review date',
                  type: 'date',
                  locked: true,
                  config: { relative: true },
                },
                { key: 'plan', name: 'Treatment plan', type: 'timeline', locked: true },
                {
                  key: 'site',
                  name: 'Site',
                  type: 'dropdown',
                  config: {
                    options: SITES.map((label) => ({ id: optId(label), label, color: 'grey' })),
                  },
                },
                { key: 'cost', name: 'Treatment cost (€)', type: 'number' },
              ],
              views: [
                {
                  name: 'Table',
                  type: 'table',
                  config: {
                    hidden: [
                      'likelihood',
                      'impact',
                      'treatment',
                      'controls',
                      'plan',
                      'site',
                      'cost',
                    ],
                    summaries: { inherent: 'average', residual: 'average' },
                  },
                },
              ],
              tabs: TABS['Risk register'],
              items: [],
            },
            ...RISK_SIBLINGS.map(([n, p], i) => plain(n, p, i)),
          ]
        : folder.sheets.map(([n, p], i) => plain(n, p, i));
    const template = parseTemplate({
      id: `design-${folder.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      version: 1,
      folder: folder.name,
      sheets,
    });
    const outcome = await importTemplate(db, template, { ...planEnv, folderId });
    if (folder.name === 'Risk and controls') riskSheetId = outcome.sheetIds.risks!;
  }

  // Items with the design's display ids, owners, values, comment counts and score history.
  const fields = check(
    await db.from('fields').select('id, key').eq('sheet_id', riskSheetId),
    'risk fields',
  );
  const f = Object.fromEntries(fields.map((x) => [x.key, x.id])) as Record<string, string>;
  const groups = check(
    await db.from('groups').select('id, name').eq('sheet_id', riskSheetId),
    'risk groups',
  );
  let pos: string | null = null;
  for (const g of GROUPS) {
    const groupId = groups.find((x) => x.name === g.name)!.id;
    for (const r of g.rows) {
      const [
        displayId,
        name,
        comments,
        owner,
        status,
        l,
        i,
        treat,
        res,
        ctrl,
        review,
        plan,
        site,
        cost,
      ] = r;
      const seq = Number(displayId.slice(2));
      check(
        await db.from('sheets').update({ next_seq: seq }).eq('id', riskSheetId).select('id'),
        'next seq',
      );
      const person = byKey.get(owner)!;
      const values: Record<string, unknown> = {
        [f.owner!]: [person.id],
        [f.status!]: optId(status),
        [f.likelihood!]: l,
        [f.impact!]: i,
        [f.inherent!]: l * i,
        [f.treatment!]: optId(treat),
        [f.review_date!]: review,
        [f.site!]: optId(site),
      };
      if (res !== '') values[f.residual!] = res;
      if (ctrl) values[f.controls!] = ctrl;
      if (plan) {
        const [start, end] = plan.split('/');
        values[f.plan!] = { start, end };
      }
      if (cost !== '') values[f.cost!] = cost;
      pos = generateKeyBetween(pos, null);
      const item = check(
        await db
          .rpc('create_item', {
            p_sheet: riskSheetId,
            p_group: groupId,
            p_name: name,
            p_position: pos,
            p_values: values as never,
          })
          .single(),
        `item ${displayId}`,
      ) as { id: string };

      // score history: the design's six points, logged as value changes (oldest first)
      const scores: [string, number | ''][] = [
        ['inherent', l * i],
        ['residual', res],
      ];
      const log = [];
      for (const [key, last] of scores) {
        if (last === '') continue;
        const pts = history(displayId + (key === 'inherent' ? 'inh' : 'res'), last);
        for (let k = 1; k < pts.length; k++) {
          log.push({
            org_id: org.id,
            sheet_id: riskSheetId,
            item_id: item.id,
            chain_key: '',
            actor_kind: 'user',
            actor_id: person.id,
            action: 'value.changed',
            field_id: f[key]!,
            old_value: pts[k - 1]!,
            new_value: pts[k]!,
          });
        }
      }
      if (log.length) check(await db.from('activity_log').insert(log).select('id'), 'history');
      for (let c = 0; c < comments; c++) {
        check(
          await db
            .from('item_updates')
            .insert({
              org_id: org.id,
              item_id: item.id,
              author_id: people[c % people.length]!.id,
              body: `Update ${c + 1} on ${displayId}.`,
            })
            .select('id'),
          'update',
        );
      }
    }
  }
  check(
    await db.from('sheets').update({ next_seq: 36 }).eq('id', riskSheetId).select('id'),
    'next seq',
  );
  console.log(
    `Seeded /${env.SEED_WORKSPACE} (Meridian Components Ltd): Risk register ${riskSheetId} with 12 risks. ` +
      `Sign in as maria@example.com.`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
