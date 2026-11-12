// A large sheet for the performance checks (M10, docs/01 §6: 10 000 items × 30 fields).
//   pnpm perf:sheet                       10 000 items in /meridian, signed in as maria@example.com (local Mailpit)
//   PERF_WORKSPACE=<slug> PERF_ITEMS=10000 PERF_EMAIL=… PERF_PASSWORD=… pnpm perf:sheet   (any project)
// Writes as the signed-in person (an editor): create_sheet, then create_items in chunks of 1 000 (the bulk RPC the CSV
// import uses), every item logged as "Generated". Prints the sheet's id and address as JSON on the last line.
import { randomUUID } from 'node:crypto';
import { generateNKeysBetween } from 'fractional-indexing';
import type { Json } from '../../src/lib/database.types';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import { perfEnv, signInForPerf } from './session';

const ITEMS = Number(process.env.PERF_ITEMS ?? 10_000);
const CHUNK = 1000;

const STATUS = [
  { id: 'opt_todo', label: 'Not started', color: 'grey' },
  { id: 'opt_wip', label: 'Working on it', color: 'orange' },
  { id: 'opt_stuck', label: 'Stuck', color: 'red' },
  { id: 'opt_done', label: 'Done', color: 'green', done: true },
];

/** 30 fields: the common types first, then text and number columns. */
function fieldSpecs() {
  const specs: { key: string; name: string; type: string; config: Record<string, Json> }[] = [
    { key: 'status', name: 'Status', type: 'status', config: { options: STATUS } },
    { key: 'owner', name: 'Owner', type: 'people', config: { multiple: false } },
    { key: 'due_date', name: 'Due date', type: 'date', config: { relative: true } },
    { key: 'severity', name: 'Severity', type: 'severity', config: {} },
    { key: 'score', name: 'Score', type: 'number', config: { unit: '', decimals: 0 } },
    { key: 'done', name: 'Checked', type: 'check', config: {} },
  ];
  for (let i = 1; specs.length < 30; i += 1)
    specs.push(
      i % 3 === 0
        ? {
            key: `amount_${i}`,
            name: `Amount ${i}`,
            type: 'number',
            config: { unit: '', decimals: 0 },
          }
        : { key: `note_${i}`, name: `Note ${i}`, type: 'text', config: {} },
    );
  return specs;
}

export async function generateSheet(
  items = ITEMS,
  signedIn?: { db: SupabaseClient<Database>; session: Session },
) {
  const started = Date.now();
  const { db, session } = signedIn ?? (await signInForPerf());
  const { data: org, error: e1 } = await db
    .from('orgs')
    .select('id')
    .eq('slug', perfEnv.WORKSPACE)
    .single();
  if (e1 || !org) throw new Error(`workspace ${perfEnv.WORKSPACE}: ${e1?.message ?? 'not found'}`);
  const { data: folder } = await db
    .from('folders')
    .select('id')
    .eq('org_id', org.id)
    .order('position')
    .limit(1)
    .maybeSingle();

  const sheetId = randomUUID();
  const groupId = randomUUID();
  const specs = fieldSpecs();
  const ids = Object.fromEntries(specs.map((f) => [f.key, randomUUID()]));
  const positions = generateNKeysBetween(null, null, specs.length);
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const prefix = `P${Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * 24)]).join('')}-`;
  const { error: e2 } = await db.rpc('create_sheet', {
    p: {
      sheet: {
        id: sheetId,
        org_id: org.id,
        folder_id: folder?.id ?? null,
        name: `Performance ${items.toLocaleString('en-GB')} ${new Date().toISOString().slice(0, 16)}`,
        item_label: 'Row',
        id_prefix: prefix,
        position: `z${Date.now().toString(36)}`,
      },
      groups: [{ id: groupId, name: 'All rows', color: 'blue', position: 'a0' }],
      fields: specs.map((f, i) => ({
        id: ids[f.key],
        key: f.key,
        name: f.name,
        type: f.type,
        position: positions[i],
        width: 130,
        config: f.config,
      })),
    } as unknown as Json,
  });
  if (e2) throw new Error(`create_sheet: ${e2.message}`);

  const keys = generateNKeysBetween(null, null, items);
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const severities = ['opt_low', 'opt_medium', 'opt_high', 'opt_critical'];
  for (let start = 0; start < items; start += CHUNK) {
    const rows = keys.slice(start, start + CHUNK).map((position, j) => {
      const n = start + j + 1;
      const values: Record<string, Json> = {
        [ids.status!]: STATUS[n % 4]!.id,
        [ids.owner!]: [session.user.id],
        [ids.due_date!]: day((n % 60) - 20),
        [ids.severity!]: severities[n % 4]!,
        [ids.score!]: n % 97,
      };
      for (const f of specs.slice(6, 12))
        values[ids[f.key]!] = f.type === 'number' ? n % 1000 : `${f.name} ${n}`;
      return { name: `Row ${String(n).padStart(5, '0')}`, position, values };
    });
    const { error } = await db.rpc('create_items', {
      p_sheet: sheetId,
      p_group: groupId,
      p_rows: rows as unknown as Json,
      p_note: 'Generated',
    });
    if (error) throw new Error(`create_items at ${start}: ${error.message}`);
  }
  return {
    sheetId,
    items,
    fields: specs.length,
    url: `${perfEnv.APP_URL}/${perfEnv.WORKSPACE}/s/${sheetId}?view=grid`,
    ms: Date.now() - started,
  };
}

if (process.argv[1] && /generate-sheet\.ts$/.test(process.argv[1])) {
  generateSheet()
    .then((r) => {
      console.error(
        `Created ${r.items.toLocaleString('en-GB')} items × ${r.fields} fields in ${r.ms} ms.`,
      );
      console.log(JSON.stringify(r));
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
