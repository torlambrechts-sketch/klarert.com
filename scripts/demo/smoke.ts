// Smoke test of the demo workspace on the local stack (pnpm seed:demo:check): builds it again with `pnpm seed:demo`
// (DEMO_RESET=1), then checks what a visitor would see. Not part of CI: it needs the local Supabase stack.
//   - the coverage of ISO 9001:2015 and ISO/IEC 27001:2022 lands near the targets (scripts/demo/index.ts TARGETS)
//   - every adopted framework reports a coverage
//   - the demo login signs in with its password; the other people cannot sign in
//   - the activity log of a nonconformity verifies as intact
// Run: pnpm seed:demo:check   (reads .env.local; local Supabase only)
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import { DEMO_EMAIL, PEOPLE } from './people';

const TOLERANCE = 5;
const TARGETS: Record<string, number> = { 'iso-9001@2015': 70, 'iso-27001@2022': 55 };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  console.error('The demo smoke test runs on the local stack only.');
  process.exit(1);
}

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

async function main() {
  const run = spawnSync('pnpm', ['seed:demo'], {
    env: { ...process.env, DEMO_RESET: '1' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = run.stdout.split('\n').find((l) => l.startsWith('DEMO_RESULT '));
  if (run.status !== 0 || !line) {
    console.error(
      run.stdout
        .split('\n')
        .filter((l) => !l.startsWith('{'))
        .join('\n'),
    );
    console.error(run.stderr);
    throw new Error('pnpm seed:demo failed.');
  }
  const result = JSON.parse(line.slice('DEMO_RESULT '.length)) as {
    slug: string;
    coverage: { framework: string; title: string; percent: number | null; text: string }[];
    warnings: string[];
  };

  for (const [fw, target] of Object.entries(TARGETS)) {
    const c = result.coverage.find((x) => x.framework === fw);
    check(
      !!c && c.percent !== null && Math.abs(c.percent - target) <= TOLERANCE,
      `${c?.title ?? fw}: ${c?.percent ?? 'no'}% covered, target ${target}% ± ${TOLERANCE}`,
    );
  }
  check(
    result.coverage.length >= 8,
    `${result.coverage.length} adopted frameworks report coverage`,
  );
  check(
    result.coverage.every((c) => c.percent !== null),
    'every adopted framework has requirements in scope',
  );
  check(
    result.warnings.length === 0,
    `no change refused by a status rule (${result.warnings.length})`,
  );

  const password = process.env.DEMO_PASSWORD || 'meridian-demo-local';
  const anon = () =>
    createClient<Database>(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const demo = anon();
  const signedIn = await demo.auth.signInWithPassword({ email: DEMO_EMAIL, password });
  check(!signedIn.error, `the demo login signs in (${DEMO_EMAIL})`);
  for (const p of PEOPLE.filter((x) => x.email !== DEMO_EMAIL)) {
    const otp = await anon().auth.signInWithPassword({ email: p.email, password });
    check(!!otp.error, `${p.name} cannot sign in`);
  }

  const { data: org } = await demo.from('orgs').select('id').eq('slug', result.slug).single();
  check(!!org, `the demo login is a member of /${result.slug}`);
  const { data: nc } = await demo
    .from('items')
    .select('id, name')
    .eq('org_id', org!.id)
    .like('name', 'NC-2026-019%')
    .single();
  if (nc) {
    const { data: chain, error } = await demo.rpc('verify_activity_chain', { p_chain_key: nc.id });
    const ok = !error && (chain as { ok?: boolean } | null)?.ok === true;
    check(ok, `the activity log of ${nc.name} verifies as intact`);
  } else check(false, 'NC-2026-019 exists');

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nThe demo workspace is as expected.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
